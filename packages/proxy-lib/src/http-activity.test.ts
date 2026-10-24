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
    expect(await send("/v1/responses?api_key=private-query", { method: "POST" })).toBe(404);
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
    for (const headers of [{}, { origin: "https://evil.example" }]) {
      const response = await app.fetch(new Request("http://localhost/v1/models", { headers }));
      expect(response.status).toBeGreaterThanOrEqual(400); await response.text();
    }
    const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status", { headers: { authorization: "Bearer activity-secret" } }))).json();
    expect(status.activity).toMatchObject({ total: 2, completed: 2, failed: 2 });
  } finally { app.close(); }
});

it("bounds recent metadata, counts each finish once and keeps streams active until cancelled", async () => {
  const activity = new HttpActivity();
  for (let i = 0; i < 25; i++) { const finish = activity.begin("GET", "/v1/models")!; finish(200); finish(500); }
  expect(activity.snapshot()).toMatchObject({ total: 25, active: 0, failed: 0 });
  expect(activity.snapshot().recent).toHaveLength(20);
  const cancelled = vi.fn();
  const source = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: test\n\n")); }, cancel: cancelled });
  const response = trackHttpResponse(new Response(source), activity.begin("POST", "/v1/chat/completions"));
  expect(activity.snapshot().active).toBe(1);
  await response.body!.cancel();
  expect(cancelled).toHaveBeenCalledOnce();
  expect(activity.snapshot()).toMatchObject({ total: 26, active: 0, completed: 26, failed: 1 });
  expect(activity.snapshot().recent[0].status).toBe(499);
});
