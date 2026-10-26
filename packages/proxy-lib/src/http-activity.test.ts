import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./index.js";
import { HttpActivity, trackHttpResponse } from "./http-activity.js";

afterEach(() => vi.unstubAllEnvs());

it("retains connectivity, rejected chat and unsupported endpoint counts while excluding dashboard polling", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const app = createApp();
  try {
    const send = async (url: string, init?: RequestInit) => { const response = await app.fetch(new Request("http://localhost" + url, init)); await response.text(); return response.status; };
    expect(await send("/v1/models")).toBe(200);
    expect(await send("/health/live")).toBe(200);
    expect(await send("/v1/chat/completions", { method: "POST", body: "{broken" })).toBe(400);
    expect(await send("/v1/unsupported?api_key=private-query", { method: "POST" })).toBe(404);
    expect(await send("/private-path-secret", { method: "POST" })).toBe(404);
    await send("/dashboard"); await send("/dashboard-script");
    for (let i = 0; i < 3; i++) {
      const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status"))).json();
      expect(status.activity).toMatchObject({ total: 5, active: 0, completed: 5, failed: 3, categories: { models: 1, chat: 1, health: 1, other: 2 } });
      expect(status.requests.sessions).toBe(0);
      expect(JSON.stringify(status.activity)).not.toMatch(/private-query|private-path-secret|api_key/);
    }
  } finally { app.close(); }
});

it("counts authentication and origin rejection before reaching a route", async () => {
  vi.stubEnv("M365_API_KEY", "activity-secret");
  const app = createApp();
  try {
    for (const headers of [{} as Record<string, string>, { origin: "https://evil.example" }]) {
      const response = await app.fetch(new Request("http://localhost/v1/models", { headers }));
      expect(response.status).toBeGreaterThanOrEqual(400); await response.text();
    }
    const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status", { headers: { authorization: "Bearer activity-secret" } }))).json();
    expect(status.activity).toMatchObject({ total: 2, completed: 2, failed: 2 });
  } finally { app.close(); }
});

it("bounds recent metadata, counts each finish once and keeps streams active until cancelled", async () => {
  const activity = new HttpActivity();
  for (let i = 0; i < 125; i++) { const finish = activity.begin("GET", "/v1/models")!; finish(200); finish(500); }
  expect(activity.snapshot()).toMatchObject({ total: 125, active: 0, failed: 0 });
  expect(activity.snapshot().recent).toHaveLength(100);
  const cancelled = vi.fn();
  const source = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: test\n\n")); }, cancel: cancelled });
  const response = trackHttpResponse(new Response(source), activity.begin("POST", "/v1/chat/completions"));
  expect(activity.snapshot().active).toBe(1);
  await response.body!.cancel();
  expect(cancelled).toHaveBeenCalledOnce();
  expect(activity.snapshot()).toMatchObject({ total: 126, active: 0, completed: 126, failed: 1 });
  expect(activity.snapshot().recent[0].status).toBe(499);
});

it("keeps queued requests visible even after the recent buffer evicts them", () => {
  const activity = new HttpActivity();
  const queued = activity.begin("POST", "/v1/chat/completions", false, "192.0.2.20")!;
  queued.chat("claude-sonnet", false); queued.phase("queued");
  for (let index = 0; index < 110; index++) activity.begin("GET", "/v1/models")!(200);
  expect(activity.snapshot().recent.some(row => row.id === queued.id)).toBe(false);
  expect(activity.snapshot().live).toEqual([expect.objectContaining({ id: queued.id, phase: "queued", elapsedMs: expect.any(Number) })]);
  queued(499);
  expect(activity.snapshot().live).toHaveLength(0);
  expect(activity.sources.snapshot({ requestKind: "errors" }).recent[0]).toMatchObject({ id: queued.id, outcome: "cancelled" });
  activity.sources.close();
});

it("distinguishes self-checks and application-level errors inside successful HTTP streams", () => {
  const activity = new HttpActivity();
  activity.begin("GET", "/v1/models", true)!(200);
  const trace = activity.begin("POST", "/v1/chat/completions")!;
  trace.chat("claude-sonnet", true); trace.phase("queued"); trace.admitted();
  trace.upstream("claude-sonnet"); trace.upstreamFailed();
  trace.upstream("claude-sonnet"); trace.output(64); trace.result(429);
  expect(activity.snapshot().chats.active).toBe(1);
  trace(200);
  expect(activity.snapshot()).toMatchObject({ total: 2, selfChecks: 1, applicationRequests: 1, failed: 1, chats: { validated: 1, failed: 1, active: 0, streamed: 1, upstreamAttempts: 2, retries: 1 } });
  expect(activity.snapshot().recent[0]).toMatchObject({ status: 200, applicationStatus: 429, outcome: "error", model: "claude-sonnet", servedModel: "claude-sonnet", responseBytes: 64 });
});

it("does not count a generated response as delivered after a client cancellation", () => {
  const activity = new HttpActivity();
  const trace = activity.begin("POST", "/v1/chat/completions")!;
  trace.chat("private-model-text", true); trace.result(200); trace(499);
  expect(activity.snapshot().chats).toMatchObject({ completed: 0, cancelled: 1, active: 0 });
  expect(JSON.stringify(activity.snapshot())).not.toContain("private-model-text");
});
