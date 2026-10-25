import { beforeEach, expect, it, vi } from "vitest";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("./handler.js", () => ({ handleChatCompletion: handle }));
import { probeModel } from "./model-probes.js";
import type { SessionPool } from "./handler.js";
import { HttpActivity } from "./http-activity.js";

const pool = {} as SessionPool;
const reply = (content: string, tool_calls?: any[]) => Response.json({ choices: [{ message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) } }] });
const tokenOf = (body: any) => JSON.stringify(body.messages).match(/probe_[a-f0-9]+/)![0];
beforeEach(() => { handle.mockReset(); });

it("grades exact JSON and system instructions rather than accepting any successful reply", async () => {
  handle.mockImplementation(async body => reply(JSON.stringify({ ok: true, value: tokenOf(body) })));
  expect(await probeModel("json", "claude-sonnet", pool)).toMatchObject({ verdict: "passed", turns: 1 });
  handle.mockImplementation(async body => reply('```json\n'+JSON.stringify({ ok: true, value: tokenOf(body) })+'\n```'));
  expect(await probeModel("json", "claude-sonnet", pool)).toMatchObject({ verdict: "failed", status: 200 });
  handle.mockImplementation(async body => reply(tokenOf(body)));
  expect(await probeModel("instructions", "claude-sonnet", pool)).toMatchObject({ verdict: "passed" });
  handle.mockImplementation(async () => reply("DIFFERENT"));
  expect(await probeModel("instructions", "claude-sonnet", pool)).toMatchObject({ verdict: "failed" });
});

it("validates tool names and arguments without executing returned shell commands", async () => {
  handle.mockImplementation(async body => reply("", [{ id: "probe-call", type: "function", function: { name: body.tools[0].function.name, arguments: JSON.stringify(body.tools[0].function.name === "bash" ? { command: `printf '%s' '${tokenOf(body)}'` } : { token: tokenOf(body) }) } }]));
  expect(await probeModel("function-tool", "claude-sonnet", pool)).toMatchObject({ verdict: "passed" });
  expect(await probeModel("shell-tool", "claude-sonnet", pool)).toMatchObject({ verdict: "passed", turns: 1 });
  handle.mockImplementation(async () => reply("", [{ id: "bad", type: "function", function: { name: "bash", arguments: '{"command":"unexpected command"}' } }]));
  expect(await probeModel("shell-tool", "claude-sonnet", pool)).toMatchObject({ verdict: "failed" });
});

it("proves a tool result is read in the same conversation and scope, with no extra retry count", async () => {
  const activity = new HttpActivity(), trace = activity.begin("POST", "/v1/proxy/model-check", true)!;
  let conversation = "", choice = "";
  handle.mockImplementation(async (body, _pool, opts) => {
    opts.activity.chat(body.model, body.stream); opts.activity.upstream(body.model);
    if (body.messages.length === 1) {
      conversation = opts.conversationId; choice = body.tool_choice;
      return reply("", [{ id: "call", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `printf '%s' '${tokenOf(body)}'` }) } }]);
    }
    expect(opts.conversationId).toBe(conversation); expect(body.tool_choice).toBe(choice);
    expect(body.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call" });
    return reply(body.messages[2].content.match(/receipt_[a-f0-9]+/)[0]);
  });
  expect(await probeModel("tool-roundtrip", "claude-sonnet", pool, trace)).toMatchObject({ verdict: "passed", turns: 2 });
  trace(200);
  expect(activity.snapshot().chats).toMatchObject({ upstreamAttempts: 2, retries: 0 });
  activity.sources.close();
});

it("tests multi-turn recall in one conversation without revealing the token in the last user turn", async () => {
  let conversation = "";
  handle.mockImplementation(async (body, _pool, opts) => {
    if (body.messages.length === 1) { conversation = opts.conversationId; return reply("OK"); }
    expect(opts.conversationId).toBe(conversation);
    expect(body.messages.at(-1).content).not.toContain(tokenOf(body));
    return reply(tokenOf(body));
  });
  expect(await probeModel("multi-turn", "claude-sonnet", pool)).toMatchObject({ verdict: "passed", turns: 2 });
});

it("reads fragmented SSE frames, requires DONE, and reports application errors", async () => {
  const streamed = (text: string) => new Response(new ReadableStream({ start(controller) { for (let i = 0; i < text.length; i += 7) controller.enqueue(new TextEncoder().encode(text.slice(i, i + 7))); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
  handle.mockImplementation(async body => streamed('data: '+JSON.stringify({ choices: [{ delta: { content: tokenOf(body) } }] })+'\n\ndata: [DONE]\n\n'));
  expect(await probeModel("streaming", "claude-sonnet", pool)).toMatchObject({ verdict: "passed" });
  handle.mockImplementation(async () => streamed('data: {"choices":[{"delta":{"content":"A nonempty streamed reply"}}]}\n\ndata: [DONE]\n\n'));
  expect(await probeModel("streaming", "claude-sonnet", pool)).toMatchObject({ verdict: "passed" });
  handle.mockImplementation(async () => streamed('data: {"error":{"type":"rate_limit_error","message":"Throttled"}}\n\ndata: [DONE]\n\n'));
  expect(await probeModel("streaming", "claude-sonnet", pool)).toMatchObject({ verdict: "error", status: 429 });
  handle.mockImplementation(async body => streamed('data: '+JSON.stringify({ choices: [{ delta: { content: tokenOf(body) } }] })+'\n\n'));
  expect(await probeModel("streaming", "claude-sonnet", pool)).toMatchObject({ verdict: "failed" });
});
