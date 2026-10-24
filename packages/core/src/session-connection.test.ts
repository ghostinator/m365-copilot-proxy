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
    send(text: string) { if (text.includes('"protocol"') && counts.mode !== 'handshake-stall') queueMicrotask(() => this.emit('message', Buffer.from('{}\x1e'))); }
  }
  return { default: FakeWebSocket };
});
import { CopilotSession } from './session.js';
const token = `x.${Buffer.from(JSON.stringify({ aud: 'offline', iss: 'offline', oid: 'offline', tid: 'offline', exp: 9999999999 })).toString('base64url')}.x`;
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); counts.mode = 'close'; counts.made = 0; });
describe('offline review: pre-handshake socket close', () => {
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
