import { createHash, randomUUID } from "node:crypto";
import { abortable, ModelSession, positiveInt, type ModelSessionOptions } from "@m365-copilot/core";
import type { z } from "zod/v4";
import type { ChatCompletionRequest } from "./schemas.js";
type Body = z.infer<typeof ChatCompletionRequest>;
type Message = Body["messages"][number];

export function messageDigest(m: Message): string {
  return createHash("sha256").update(JSON.stringify({ role: m.role, content: m.content ?? null, tool_call_id: m.tool_call_id, name: m.name, tool_calls: m.tool_calls?.map(t => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })) })).digest("hex");
}
export interface ConversationState {
  session: ModelSession;
  sentMessageCount: number;
  lastAccessedAt: number;
  pendingNote: string | null;
  servedModel?: string;
  history: string[];
  reply?: string;
  identity: string;
}

/** One upstream account: serialize complete turns, including streamed production. */
export class SessionPool {
  private conversations = new Map<string, ConversationState>();
  private queue: Promise<void> = Promise.resolve();
  private waiting = 0;
  readonly shutdown = new AbortController();
  close() { this.shutdown.abort(new Error("Proxy is shutting down")); this.conversations.clear(); }
  constructor(private sessionOptions: ModelSessionOptions = {}) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal;
    signal = AbortSignal.any([signal, AbortSignal.timeout(positiveInt(process.env.M365_QUEUE_TIMEOUT_MS, 120_000))]);
    signal?.throwIfAborted();
    if (this.waiting >= positiveInt(process.env.M365_MAX_PENDING_REQUESTS, 32)) throw new Error("The proxy request queue is full");
    this.waiting++;
    const previous = this.queue;
    let unlock!: () => void;
    this.queue = new Promise<void>(r => { unlock = r; });
    try { await abortable(previous, signal); signal?.throwIfAborted(); }
    catch (e) { void previous.then(unlock); this.waiting--; throw e; }
    let released = false;
    return () => { if (!released) { released = true; this.waiting--; unlock(); } };
  }

  resolve(messages: Message[], tools?: Body["tools"], identity = ""): ConversationState {
    const now = Date.now();
    for (const [id, state] of this.conversations) if (now - state.lastAccessedAt > 30 * 60_000) this.conversations.delete(id);
    const toolSchemas = (tools ?? []).map(t => [t.function.name, t.function.parameters]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const scope = JSON.stringify([identity, toolSchemas]);
    const digests = messages.map(messageDigest);
    // Only the exact acknowledged prefix and assistant reply may continue a turn.
    const matches = [...this.conversations.values()].filter(s => s.identity === scope && s.sentMessageCount > 0 && digests.length > s.sentMessageCount && s.history.every((d, i) => d === digests[i]) && (!s.reply || digests[s.sentMessageCount] === s.reply));
    if (matches.length === 1) { matches[0].lastAccessedAt = now; return matches[0]; }
    // Ambiguous histories start fresh. Never guess which server-side state is right.
    const max = positiveInt(process.env.M365_MAX_SESSIONS, 128);
    while (this.conversations.size >= max) {
      const oldest = [...this.conversations].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0];
      this.conversations.delete(oldest[0]);
    }
    const state: ConversationState = { session: new ModelSession(this.sessionOptions), sentMessageCount: 0, lastAccessedAt: now, pendingNote: null, history: [], identity: scope };
    this.conversations.set(randomUUID(), state);
    return state;
  }

  acknowledge(state: ConversationState, messages: Message[], reply: Message): void {
    state.history = messages.map(messageDigest);
    state.reply = messageDigest(reply);
    state.sentMessageCount = messages.length;
    state.lastAccessedAt = Date.now();
  }
  get size() { return this.conversations.size; }
  get status() { return { sessions: this.conversations.size, pending: this.waiting }; }
}
