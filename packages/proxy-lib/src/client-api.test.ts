import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
const fixture = vi.hoisted(() => ({ queue: [] as string[], runs: 0 }));
const sandbox = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm365-sdk-'));
  const prior = Object.fromEntries(['M365_DATA_DIR', 'M365_CACHE_FILE', 'M365_SECRETS_FILE'].map(key => [key, process.env[key]]));
  process.env.M365_DATA_DIR = root;
  process.env.M365_CACHE_FILE = path.join(root, 'absent-cache.json');
  process.env.M365_SECRETS_FILE = path.join(root, 'absent-secrets.json');
  return { root, prior };
});
vi.mock('./usage-observations.js', () => ({ recordUsageObservation: vi.fn() }));
vi.mock('@m365-copilot/core', async importActual => {
  const actual = await importActual<typeof import('@m365-copilot/core')>();
  class ModelSession {
    turnCount = 0;
    conversationId = crypto.randomUUID();
    reset() {}
    newConversation() { this.conversationId = crypto.randomUUID(); this.turnCount = 0; }
    async refreshAgent() { return false; }
    async run() {
      fixture.runs++; this.turnCount++;
      const text = fixture.queue.shift();
      if (text === undefined) throw new Error('Unexpected upstream call');
      return { fullText: text, hasContent: true, result: { value: 'Success' }, images: [],
        throttle: null, contentOrigin: 'Claude', messageType: null, scores: null, turnCount: this.turnCount,
        async *[Symbol.asyncIterator]() { yield text; } };
    }
  }
  return { ...actual, ModelSession, awaitTurnBudget: async () => ({ waitedMs: 0 }) };
});
import { createApp } from './index.js';
let app: ReturnType<typeof createApp>;
let openai: OpenAI;
let anthropic: Anthropic;
beforeEach(() => {
  vi.stubEnv('M365_API_KEY', 'client-test-key');
  vi.stubEnv('M365_NO_CONFAB_RETRY', '1');
  fixture.queue = []; fixture.runs = 0;
  app = createApp({ useAgent: false });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(new URL(request.url).origin).toBe('http://client.test');
    return app.fetch(request);
  };
  openai = new OpenAI({ apiKey: 'client-test-key', baseURL: 'http://client.test/v1', fetch, maxRetries: 0 });
  anthropic = new Anthropic({ apiKey: 'client-test-key', baseURL: 'http://client.test', fetch, maxRetries: 0 });
});
afterEach(() => { app.close(); vi.unstubAllEnvs(); });
afterAll(async () => {
  for (const [key, value] of Object.entries(sandbox.prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const { rmSync } = await import('node:fs');
  const { basename } = await import('node:path');
  if (!basename(sandbox.root).startsWith('m365-sdk-')) throw new Error('Unexpected sandbox path');
  rmSync(sandbox.root, { recursive: true, force: true });
});
describe('real SDK protocol conformance', () => {
  it('serves Responses JSON and native stream accumulation', async () => {
    fixture.queue.push('Hello', 'Stream hello');
    const json = await openai.responses.create({ model: 'claude-sonnet', input: 'Say hello', store: false });
    expect(json.output_text).toBe('Hello');
    const stream = openai.responses.stream({ model: 'claude-sonnet', input: 'Say hello', store: false });
    expect((await stream.finalResponse()).output_text).toBe('Stream hello');
    expect(fixture.runs).toBe(2);
  });
  it('serves Messages JSON and native stream accumulation using x-api-key', async () => {
    fixture.queue.push('Hello', 'Stream hello');
    const json = await anthropic.messages.create({ model: 'claude-sonnet', max_tokens: 100, messages: [{ role: 'user', content: 'Say hello' }] });
    expect(json.content).toEqual([{ type: 'text', text: 'Hello' }]);
    const stream = anthropic.messages.stream({ model: 'claude-sonnet', max_tokens: 100, messages: [{ role: 'user', content: 'Say hello' }] });
    expect((await stream.finalMessage()).content).toEqual([{ type: 'text', text: 'Stream hello' }]);
  });
  it('round trips Responses function calls with their exact call IDs', async () => {
    fixture.queue.push('```lookup\nalpha\n```', 'Found alpha');
    const tools: OpenAI.Responses.Tool[] = [{ type: 'function', name: 'lookup', description: 'Lookup a key', strict: true,
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false } }];
    const first = await openai.responses.create({ model: 'claude-sonnet', input: 'Lookup alpha', tools, store: false });
    const call = first.output.find(item => item.type === 'function_call');
    expect(call?.type).toBe('function_call');
    if (!call || call.type !== 'function_call') throw new Error('Missing call');
    expect(JSON.parse(call.arguments)).toEqual({ key: 'alpha' });
    const second = await openai.responses.create({ model: 'claude-sonnet', tools, store: false, input: [
      { role: 'user', content: 'Lookup alpha' }, call,
      { type: 'function_call_output', call_id: call.call_id, output: 'alpha found' },
    ] });
    expect(second.output_text).toBe('Found alpha');
  });
  it('rejects unsupported stateful semantics before an upstream call', async () => {
    await expect(openai.responses.create({ model: 'claude-sonnet', previous_response_id: 'not-stored', input: 'Hello' })).rejects.toMatchObject({ status: 400 });
    expect(fixture.runs).toBe(0);
  });
  it('round trips native Messages tool use and results', async () => {
    fixture.queue.push('```lookup\nalpha\n```', 'Found alpha');
    const tools: Anthropic.Tool[] = [{ name: 'lookup', input_schema: {
      type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false,
    } }];
    const first = await anthropic.messages.create({ model: 'claude-sonnet', max_tokens: 100, tools, messages: [{ role: 'user', content: 'Lookup alpha' }] });
    const call = first.content.find(item => item.type === 'tool_use');
    if (!call || call.type !== 'tool_use') throw new Error('Missing tool use');
    expect(call.input).toEqual({ key: 'alpha' });
    const second = await anthropic.messages.create({ model: 'claude-sonnet', max_tokens: 100, tools, messages: [
      { role: 'user', content: 'Lookup alpha' }, { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'alpha found' }] },
    ] });
    expect(second.content).toEqual([{ type: 'text', text: 'Found alpha' }]);
  });
  it('returns native authentication errors without reaching the model', async () => {
    const response = await app.fetch(new Request('http://client.test/v1/messages', {
      method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}',
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ type: 'error', error: { type: 'authentication_error' } });
    expect(fixture.runs).toBe(0);
  });
  it('accumulates streamed function arguments through both SDKs', async () => {
    fixture.queue.push('```lookup\nalpha\n```', '```lookup\nalpha\n```');
    const parameters = { type: 'object' as const, properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false };
    const response = await openai.responses.stream({ model: 'claude-sonnet', input: 'Lookup alpha', store: false,
      tools: [{ type: 'function', name: 'lookup', parameters, strict: true }],
    }).finalResponse();
    expect(response.output[0]).toMatchObject({ type: 'function_call', name: 'lookup' });
    if (response.output[0].type !== 'function_call') throw new Error('Missing function call');
    expect(JSON.parse(response.output[0].arguments)).toEqual({ key: 'alpha' });
    const message = await anthropic.messages.stream({ model: 'claude-sonnet', max_tokens: 100,
      messages: [{ role: 'user', content: 'Lookup alpha' }], tools: [{ name: 'lookup', input_schema: parameters }],
    }).finalMessage();
    expect(message.content[0]).toMatchObject({ type: 'tool_use', name: 'lookup', input: { key: 'alpha' } });
    expect(message.stop_reason).toBe('tool_use');
  });
  it('rejects invalid generated arguments as native errors without retry', async () => {
    fixture.queue.push('```edit\nenabled: "invalid"\ncount: 1\n```');
    await expect(anthropic.messages.create({ model: 'claude-sonnet', max_tokens: 100,
      messages: [{ role: 'user', content: 'Edit the flag' }], tools: [{ name: 'edit', input_schema: {
        type: 'object', properties: { enabled: { type: 'boolean' }, count: { type: 'integer' } }, required: ['enabled', 'count'],
      } }],
    })).rejects.toMatchObject({ status: 502, error: { type: 'error', error: { type: 'api_error', code: 'invalid_tool_arguments' } } });
    expect(fixture.runs).toBe(1);
  });
});
