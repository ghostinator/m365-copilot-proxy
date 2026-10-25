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
  diagnostic(type: string, message: string, stack?: string, code?: string): void;
  errorBody(text: string): void;
  route(): string | null;
  chat(model: string, streamed: boolean): void;
  phase(value: Phase): void;
  admitted(): void;
  upstream(model: string): void;
  upstreamFailed(): void;
  result(status: number): void;
  output(bytes: number): void;
}
const ignored = new Set(["/dashboard", "/dashboard-script", "/v1/proxy/status", "/v1/proxy/checks", "/favicon.ico"]);
const endpoints: Record<string, Kind> = { "/v1/models": "models", "/v1/chat/completions": "chat", "/health": "health", "/health/live": "health", "/health/ready": "health", "/v1/proxy/model-check": "other", "/v1/responses": "other", "/v1/messages": "other", "/messages": "other" };

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
  private recent: ActivityEvent[] = [];

  begin(method: string, pathname: string, selfCheck = false, remoteAddress?: string, userAgent?: string): RequestTrace | null {
    if (ignored.has(pathname)) return null;
    const started = Date.now();
    const known = Object.hasOwn(endpoints, pathname);
    const kind = known ? endpoints[pathname] : "other";
    selfCheck = selfCheck && ((method === "GET" && (kind === "models" || kind === "health")) || (method === "POST" && pathname === "/v1/proxy/model-check"));
    const event: ActivityEvent = { diagnostic: null, clientSoftware: clientSoftware(userAgent), clientAddress: sourceAddress(remoteAddress), id: randomUUID(), method: /^(GET|POST|HEAD|OPTIONS|PUT|PATCH|DELETE)$/.test(method) ? method : "OTHER", endpoint: known ? pathname : "(other endpoint)", source: selfCheck ? "self-check" : "application", receivedAt: new Date(started).toISOString(), status: null, durationMs: null, phase: "received", outcome: "pending", model: null, servedModel: null, streamed: null, applicationStatus: null, responseBytes: 0, firstByteMs: null, queueMs: null, upstreamAttempts: 0, upstreamFailures: 0 };
    this.total++; if (selfCheck) this.selfChecks++;
    this.categories[kind]++;
    this.recent.push(event);
    if (this.recent.length > 100) this.recent.shift();
    let finished = false, validated = false, chatFinished = false, queuedAt = started;
    const knownModel = (model: string) => getAvailableModels().includes(model) ? model : "(custom model)";
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
      const result = event.status >= 400 ? event.status : event.applicationStatus ?? event.status;
      finishChat(result);
      event.outcome = result === 499 ? "cancelled" : result >= 400 ? "error" : "success";
      if (result === 404) event.diagnostic = { type: "unsupported_endpoint", message: "No route matches this endpoint and method. Supported chat endpoint: POST /v1/chat/completions. Responses and Anthropic Messages APIs are not implemented.", phase: event.phase };
      if (event.outcome !== "success" && !event.diagnostic) event.diagnostic = { type: result === 499 ? "client_disconnected" : "http_error", message: result === 499 ? "Client connection closed before the response completed. Check client timeout and network connectivity." : result === 404 ? "No route matches this endpoint and method. Supported chat endpoint: POST /v1/chat/completions. Responses and Anthropic Messages APIs are not implemented." : `${STATUS_CODES[result] ?? "Request failed"} (status ${result}). No additional error payload was supplied.`, phase: event.phase };
      event.phase = event.outcome === "cancelled" ? "cancelled" : event.outcome === "error" ? "failed" : "completed";
      this.completed++; if (event.outcome !== "success") this.failed++;
      this.sources.record(event);
    };
    return Object.assign(finish, {
      id: event.id,
      diagnostic: (type: string, message: string, stack?: string, code?: string) => { if (finished) return; event.diagnostic = { type: diagnosticText(type, 200), message: diagnosticText(message), ...((stack ?? event.diagnostic?.stack) ? { stack: diagnosticText(stack ?? event.diagnostic?.stack, 16000) } : {}), ...(code ? { code: diagnosticText(code, 200) } : {}), phase: event.phase }; },
      errorBody: (text: string) => { if (finished || event.diagnostic) return; const error = errorPayload(text); if (error) event.diagnostic = { type: diagnosticText(error.type,200), message: diagnosticText(error.message), ...(error.code ? { code: diagnosticText(error.code,200) } : {}), phase: event.phase }; },
      route: () => event.servedModel,
      chat: (model: string, streamed: boolean) => { if (finished || validated) return; validated = true; event.model = knownModel(model); event.streamed = streamed; this.chat.validated++; if (streamed) this.chat.streamed++; else this.chat.nonStreamed++; },
      phase: (value: Phase) => { if (finished) return; event.phase = value; if (value === "queued") queuedAt = Date.now(); },
      admitted: () => { if (finished) return; event.queueMs = Math.max(0, Date.now() - queuedAt); event.phase = "preparing"; },
      upstream: (model: string) => { if (finished) return; event.phase = "upstream"; event.servedModel = knownModel(model); if (event.upstreamAttempts > 0) this.chat.retries++; event.upstreamAttempts++; this.chat.upstreamAttempts++; },
      upstreamFailed: () => { if (finished) return; event.upstreamFailures++; this.chat.upstreamFailures++; },
      result: (status: number) => { if (finished || event.applicationStatus === 499) return; event.applicationStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500; },
      output: (bytes: number) => { if (finished || !Number.isFinite(bytes) || bytes <= 0) return; event.responseBytes += bytes; event.firstByteMs ??= Math.max(0, Date.now() - started); if (event.streamed) event.phase = "streaming"; },
    });
  }

  snapshot() {
    return { total: this.total, applicationRequests: this.total - this.selfChecks, selfChecks: this.selfChecks, active: this.total - this.completed, completed: this.completed, failed: this.failed, categories: { ...this.categories }, chats: { ...this.chat, active: this.chat.validated - this.chat.completed - this.chat.failed - this.chat.cancelled }, recent: this.recent.map(event => ({ ...event })).reverse() };
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
