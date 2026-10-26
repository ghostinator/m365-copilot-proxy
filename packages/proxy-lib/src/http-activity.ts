import type { ApplicationKey } from "./api-keys.js";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR, getAvailableModels } from "@m365-copilot/core";
import { RequestSources, sourceAddress } from "./request-sources.js";
import { clientSoftware } from "./activity-schema.js";
import { diagnosticText, errorPayload } from "./error-diagnostics.js";
import { STATUS_CODES } from "node:http";
import packageInfo from "../package.json" with { type: "json" };

type Kind = "models" | "chat" | "health" | "other";
type Phase = "received" | "queued" | "preparing" | "upstream" | "streaming" | "completed" | "failed" | "cancelled";
export interface ActivityEvent {
  apiKeyId?: string | null;
  apiKeyLabel?: string | null;
  timeline?: { atMs: number; phase: string; model?: string | null }[];
  timelineTruncated?: boolean;
  diagnostic: { type: string; message: string; code?: string; stack?: string; phase: string } | null;
  clientAddress: string;
  clientSoftware: string;
  id: string; method: string; endpoint: string; source: "application" | "self-check";
  receivedAt: string; status: number | null; durationMs: number | null; phase: Phase;
  outcome: "pending" | "success" | "error" | "cancelled";
  model: string | null; servedModel: string | null; streamed: boolean | null;
  applicationStatus: number | null; responseBytes: number; firstByteMs: number | null;
  queueMs: number | null; upstreamAttempts: number; upstreamFailures: number;
}
export interface RequestTrace {
  (status: number): void;
  id: string;
  applicationKey(value: ApplicationKey | null): void;
  diagnostic(type: string, message: string, stack?: string, code?: string): void;
  errorBody(text: string): void;
  route(): string | null;
  chat(model: string, streamed: boolean): void;
  phase(value: Phase): void;
  admitted(): void;
  upstream(model: string): void;
  nextTurn(): void;
  upstreamFailed(): void;
  result(status: number): void;
  output(bytes: number): void;
}
const ignored = new Set(["/dashboard", "/dashboard-script", "/v1/proxy/status", "/v1/proxy/checks", "/v1/proxy/metrics", "/v1/proxy/storage-history", "/favicon.ico"]);
const endpoints: Record<string, Kind> = { "/v1/models": "models", "/v1/chat/completions": "chat", "/health": "health", "/health/live": "health", "/health/ready": "health", "/v1/proxy/model-check": "other", "/v1/responses": "chat", "/v1/messages": "chat", "/messages": "other" };

/** Bounded metadata only. No prompts, answers, headers, keys or query strings. */
export class HttpActivity {
  constructor(readonly sources = new RequestSources()) {}
  readonly instance = { id: randomUUID(), pid: process.pid, version: packageInfo.version, startedAt: new Date().toISOString() };
  private total = 0;
  private completed = 0;
  private failed = 0;
  private selfChecks = 0;
  private chat = { validated: 0, completed: 0, failed: 0, cancelled: 0, streamed: 0, nonStreamed: 0, upstreamAttempts: 0, upstreamFailures: 0, retries: 0 };
  private categories = { models: 0, chat: 0, health: 0, other: 0 };
  private durationBounds = [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300];
  private durationCounts = this.durationBounds.map(() => 0);
  private durationSum = 0;
  private recent: ActivityEvent[] = [];
  private activeRequests = new Map<string, ActivityEvent>();

  begin(method: string, pathname: string, selfCheck = false, remoteAddress?: string, userAgent?: string): RequestTrace | null {
    if (ignored.has(pathname) || pathname === "/v1/proxy/operator" || pathname.startsWith("/v1/proxy/download/")) return null;
    const started = Date.now();
    const known = Object.hasOwn(endpoints, pathname);
    const kind = known ? endpoints[pathname] : "other";
    selfCheck = selfCheck && ((method === "GET" && (kind === "models" || kind === "health")) || (method === "POST" && pathname === "/v1/proxy/model-check"));
    const event: ActivityEvent = { timeline: [{ atMs: 0, phase: "received" }], timelineTruncated: false, diagnostic: null, clientSoftware: clientSoftware(userAgent), clientAddress: sourceAddress(remoteAddress), id: randomUUID(), method: /^(GET|POST|HEAD|OPTIONS|PUT|PATCH|DELETE)$/.test(method) ? method : "OTHER", endpoint: known ? pathname : "(other endpoint)", source: selfCheck ? "self-check" : "application", receivedAt: new Date(started).toISOString(), status: null, durationMs: null, phase: "received", outcome: "pending", model: null, servedModel: null, streamed: null, applicationStatus: null, responseBytes: 0, firstByteMs: null, queueMs: null, upstreamAttempts: 0, upstreamFailures: 0 };
    this.total++; if (selfCheck) this.selfChecks++;
    this.categories[kind]++;
    this.activeRequests.set(event.id, event);
    this.recent.push(event);
    if (this.recent.length > 100) this.recent.shift();
    let finished = false, validated = false, chatFinished = false, queuedAt = started, turnAttempts = 0;
    const knownModel = (model: string) => getAvailableModels().includes(model) ? model : "(custom model)";
    const mark = (phase: string, model?: string) => {
      const point = { atMs: Math.max(0, Date.now() - started), phase, ...(model ? { model: knownModel(model) } : {}) };
      if (event.timeline!.length < 128) event.timeline!.push(point);
      else { event.timelineTruncated = true; event.timeline![127] = point; }
    };
    const finishChat = (status: number) => {
      if (!validated || chatFinished) return;
      chatFinished = true;
      if (status === 499) this.chat.cancelled++;
      else if (status >= 400) this.chat.failed++;
      else this.chat.completed++;
    };
    const finish = (status: number) => {
      if (finished) return;
      finished = true;
      event.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;
      event.durationMs = Math.max(0, Date.now() - started);
      this.durationSum += event.durationMs / 1000;
      this.durationBounds.forEach((bound, i) => { if (event.durationMs! / 1000 <= bound) this.durationCounts[i]++; });
      const result = event.status >= 400 ? event.status : event.applicationStatus ?? event.status;
      finishChat(result);
      event.outcome = result === 499 ? "cancelled" : result >= 400 ? "error" : "success";
      if (result === 404) event.diagnostic = { type: "unsupported_endpoint", message: "No route matches this endpoint and method. Supported chat endpoints: POST /v1/chat/completions, /v1/responses, /v1/messages.", phase: event.phase };
      if (event.outcome !== "success" && !event.diagnostic) event.diagnostic = { type: result === 499 ? "client_disconnected" : "http_error", message: result === 499 ? "Client connection closed before the response completed. Check client timeout and network connectivity." : `${STATUS_CODES[result] ?? "Request failed"} (status ${result}). No additional error payload was supplied.`, phase: event.phase };
      event.phase = event.outcome === "cancelled" ? "cancelled" : event.outcome === "error" ? "failed" : "completed";
      mark(event.phase);
      this.completed++; if (event.outcome !== "success") this.failed++;
      this.activeRequests.delete(event.id);
      this.sources.record(event);
    };
    return Object.assign(finish, {
      id: event.id,
      applicationKey: (value: ApplicationKey | null) => { if (!finished) { event.apiKeyId = value?.id ?? null; event.apiKeyLabel = value?.label ?? null; } },
      diagnostic: (type: string, message: string, stack?: string, code?: string) => { if (finished) return; event.diagnostic = { type: diagnosticText(type, 200), message: diagnosticText(message), ...((stack ?? event.diagnostic?.stack) ? { stack: diagnosticText(stack ?? event.diagnostic?.stack, 16000) } : {}), ...(code ? { code: diagnosticText(code, 200) } : {}), phase: event.phase }; },
      errorBody: (text: string) => { if (finished || event.diagnostic) return; const error = errorPayload(text); if (error) event.diagnostic = { type: diagnosticText(error.type,200), message: diagnosticText(error.message), ...(error.code ? { code: diagnosticText(error.code,200) } : {}), phase: event.phase }; },
      route: () => event.servedModel,
      chat: (model: string, streamed: boolean) => { if (finished || validated) return; validated = true; event.model = knownModel(model); event.streamed = streamed; this.chat.validated++; if (streamed) this.chat.streamed++; else this.chat.nonStreamed++; },
      phase: (value: Phase) => { if (finished) return; event.phase = value; mark(value); if (value === "queued") queuedAt = Date.now(); },
      admitted: () => { if (finished) return; event.queueMs = Math.max(0, Date.now() - queuedAt); event.phase = "preparing"; mark("preparing"); },
      nextTurn: () => { turnAttempts = 0; },
      upstream: (model: string) => { if (finished) return; event.phase = "upstream"; event.servedModel = knownModel(model); mark("upstream", model); if (turnAttempts++ > 0) this.chat.retries++; event.upstreamAttempts++; this.chat.upstreamAttempts++; },
      upstreamFailed: () => { if (finished) return; event.upstreamFailures++; mark("upstream-failed"); this.chat.upstreamFailures++; },
      result: (status: number) => { if (finished || event.applicationStatus === 499) return; event.applicationStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500; },
      output: (bytes: number) => { if (finished || !Number.isFinite(bytes) || bytes <= 0) return; event.responseBytes += bytes; event.firstByteMs ??= Math.max(0, Date.now() - started); if (event.streamed && event.phase !== "streaming") { event.phase = "streaming"; mark("streaming"); } },
    });
  }

  snapshot() {
    const live = [...this.activeRequests.values()].map(event => ({ ...event, elapsedMs: Math.max(0, Date.now() - Date.parse(event.receivedAt)), timeline: event.timeline?.map(point => ({ ...point })) }));
    return { live, total: this.total, applicationRequests: this.total - this.selfChecks, selfChecks: this.selfChecks, active: this.total - this.completed, completed: this.completed, failed: this.failed, categories: { ...this.categories }, chats: { ...this.chat, active: this.chat.validated - this.chat.completed - this.chat.failed - this.chat.cancelled }, recent: this.recent.map(event => ({ ...event, timeline: event.timeline?.map(point => ({ ...point })) })).reverse() };
  }
  metricsSnapshot() {
    return { total: this.total, completed: this.completed, failed: this.failed, active: this.total - this.completed,
      applicationRequests: this.total - this.selfChecks, selfChecks: this.selfChecks, categories: { ...this.categories }, chats: { ...this.chat },
      duration: { count: this.completed, sum: this.durationSum, buckets: this.durationBounds.map((le, i) => ({ le, count: this.durationCounts[i] })) } };
  }
}
export const httpActivity = new HttpActivity(new RequestSources(CONFIG_DIR));

/** Preserve backpressure/cancellation; do not consume a streamed body early. */
export function trackHttpResponse(response: Response, finish: RequestTrace | null): Response {
  if (!finish) return response;
  response.headers.set("X-M365-Request-Id", finish.id);
  if (!response.body) { finish(response.status); return response; }
  const reader = response.body.getReader();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { finish(response.status); controller.close(); }
        else { finish.output(next.value.byteLength); controller.enqueue(next.value); }
      } catch (error) { finish.diagnostic("response_stream_error", error instanceof Error ? error.message : "Response stream failed", error instanceof Error ? error.stack : undefined); finish(502); controller.error(error); }
    },
    async cancel(reason) { finish(499); await reader.cancel(reason); },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
