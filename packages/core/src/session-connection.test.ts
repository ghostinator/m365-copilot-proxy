// Offline regression reproducer: a peer that closes before the SignalR handshake.
import { afterEach, describe, expect, it, vi } from 'vitest';
const counts = vi.hoisted(() => ({ made: 0, closed: 0, mode: 'close' }));
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    constructor() {
      super();
      counts.made++;
      queueMicrotask(() => { if (counts.mode === 'close') { counts.closed++; this.emit('close'); } else { this.readyState = 1; this.emit('open'); } });
    }
    close() { this.emit('close'); }
    terminate() { this.emit('close'); }
    send(text: string) {
      if (text.includes('"protocol"') && counts.mode !== 'handshake-stall') queueMicrotask(() => this.emit('message', Buffer.from('{}\x1e')));
      if (text.includes('"target":"chat"') && counts.mode.startsWith('native:')) queueMicrotask(() => {
        const [, contentOrigin, messageType] = counts.mode.split(':');
        const result = contentOrigin === 'BashExecutor'
          ? { stdout: 'remote fixture', stderr: '', exitCode: 0, status: 'Success' }
          : { executedCode: 'print("remote fixture")', stdout: 'remote fixture', stderr: '', exitCode: 0, status: 'Success', outputFiles: [] };
        const native = { author: 'bot', messageId: 'remote', contentOrigin, messageType,
          text: contentOrigin === 'CodeGenerator' ? 'print("remote fixture")' : JSON.stringify(result) };
        this.emit('message', Buffer.from(JSON.stringify({ type: 1, target: 'update', arguments: [{ messages: [native] }] }) + '\x1e'));
        this.emit('message', Buffer.from(JSON.stringify({ type: 2, item: { result: { value: 'Success' } } }) + '\x1e'));
      });
      if (text.includes('"target":"chat"') && counts.mode === 'cursor-preview') queueMicrotask(() => {
        const message = { author: 'bot', messageId: 'reply', text: 'c', adaptiveCards: [{ body: [{ text: '' }] }] };
        for (const argument of [
          { cursor: { j: "$['reply'].adaptiveCards[0].body[0].text", p: -1 }, messages: [message] },
          { writeAtCursor: 'c0ffee' },
          { messages: [{ ...message, text: 'c0ffee', adaptiveCards: [{ body: [{ text: 'c0ffee' }] }] }] },
        ]) this.emit('message', Buffer.from(JSON.stringify({ type: 1, target: 'update', arguments: [argument] }) + '\x1e'));
        this.emit('message', Buffer.from(JSON.stringify({ type: 2, item: { result: { value: 'Success' } } }) + '\x1e'));
      });
    }
  }
  return { default: FakeWebSocket };
});
import { CopilotSession } from './session.js';
import { parseToolCalls } from './tools.js';
const token = `x.${Buffer.from(JSON.stringify({ aud: 'offline', iss: 'offline', oid: 'offline', tid: 'offline', exp: 9999999999 })).toString('base64url')}.x`;
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); counts.mode = 'close'; counts.made = 0; });
describe('offline review: pre-handshake socket close', () => {
  it.each(['CodeInterpreter:Internal', 'CodeGenerator:GeneratedCode', 'CodeInterpreter:GeneratedCode', 'BashExecutor:Internal'])('does not turn native %s execution into local tool success', async shape => {
    counts.mode = `native:${shape}`;
    const stream = await new CopilotSession().chat(token, 'offline');
    let text = '';
    for await (const delta of stream) text += delta;
    expect(stream.fullText).toBe('');
    expect(text).toBe('');
    expect(parseToolCalls(stream.fullText).hasToolCalls).toBe(false);
    expect(stream.sawAction).toBe(false);
    expect(stream.contentOrigin).toBe(shape.split(':')[0]);
  });
  it('uses the cursor target rather than a duplicate preview token', async () => {
    counts.mode = 'cursor-preview';
    const stream = await new CopilotSession().chat(token, 'offline');
    let streamed = '';
    for await (const delta of stream) streamed += delta;
    expect(stream.fullText).toBe('c0ffee');
    expect(streamed).toBe('c0ffee');
  });
  it('rejects when a peer closes before the handshake', async () => {
    const claims = { aud: 'offline', iss: 'offline', oid: 'offline', tid: 'offline', exp: 9999999999 };
    const token = `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
    const chat = new CopilotSession().chat(token, 'offline');
    expect(counts.made).toBe(1);
    const result = await Promise.race([
      chat.then(() => 'resolved', () => 'rejected'),
      new Promise<string>(r => setTimeout(() => r('still pending'), 50)),
    ]);
    expect(result).toBe('rejected');
  });
  it('rejects a silent handshake at the deadline and clears its timers', async () => {
    vi.useFakeTimers(); counts.mode = 'handshake-stall';
    const pending = new CopilotSession().chat(token, 'offline');
    const rejection = expect(pending).rejects.toThrow('handshake timed out');
    await vi.advanceTimersByTimeAsync(30_001); await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a stalled turn instead of keeping SSE alive forever', async () => {
    vi.useFakeTimers(); counts.mode = 'turn-stall';
    const stream = await new CopilotSession().chat(token, 'offline');
    const rejection = expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('stalled');
    await vi.advanceTimersByTimeAsync(180_001); await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});
