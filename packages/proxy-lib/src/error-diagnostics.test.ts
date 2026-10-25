import { expect, it, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HttpActivity } from "./http-activity.js";
import { RequestSources } from "./request-sources.js";
import { createApp } from "./index.js";
import { diagnosticText } from "./error-diagnostics.js";

afterEach(() => vi.unstubAllEnvs());

it("persists detailed SSE errors and cancellations across restart with independent filtered paging", () => {
  const directory = mkdtempSync(join(tmpdir(), "m365-errors-"));
  const sources = new RequestSources(directory), activity = new HttpActivity(sources);
  const trace = activity.begin("POST", "/v1/chat/completions", false, "100.67.127.67", "OpenAI/Python")!;
  trace.chat("claude-sonnet", true); trace.admitted(); trace.upstream("claude-sonnet"); trace.upstreamFailed();
  trace.diagnostic("rate_limit_error", "PerUserThrottled; retry later. Authorization: Bearer private-credential", "Error: upstream\n at worker (test.ts:4)", "m365_throttled");
  trace.result(429); trace.output(120); trace(200);
  activity.begin("GET", "/v1/models", false, "100.64.0.2")!(499);
  activity.begin("GET", "/v1/models", false, "100.67.127.67")!(200);
  sources.close();
  const restarted = new RequestSources(directory);
  const snapshot = restarted.snapshot({ address: "100.67.127.67", model: "claude-sonnet", errorLimit: 1 });
  expect(snapshot.errorHistory).toEqual({ total: 1, limit: 1, offset: 0 });
  expect(snapshot.errors[0]).toMatchObject({ status: 200, applicationStatus: 429, model: "claude-sonnet", upstreamAttempts: 1, upstreamFailures: 1, responseBytes: 120, diagnostic: { type: "rate_limit_error", code: "m365_throttled", phase: "upstream", stack: "Error: upstream\n at worker (test.ts:4)" } });
  expect(JSON.stringify(snapshot.errors)).not.toContain("private-credential");
  expect(restarted.snapshot({ errorLimit: 1, errorOffset: 1 }).errors[0].id).toBe(trace.id);
  restarted.close();
});

it("upgrades an existing v1 database without losing earlier failed requests", () => {
  const directory = mkdtempSync(join(tmpdir(), "m365-errors-v1-"));
  const sources = new RequestSources(directory), activity = new HttpActivity(sources);
  activity.begin("POST", "/v1/responses", false, "100.67.127.67")!(404);
  sources.close();
  const db = new DatabaseSync(join(directory, "activity.sqlite"));
  db.exec("DROP TABLE request_errors; DROP INDEX requests_errors_time; PRAGMA user_version=1;"); db.close();
  const upgraded = new RequestSources(directory), result = upgraded.snapshot();
  expect(result.error).toBeNull();
  expect(result.summary.total).toBe(1);
  expect(result.errorHistory.total).toBe(1);
  expect(result.errors[0]).toMatchObject({ status: 404, endpoint: "/v1/responses", diagnostic: null });
  upgraded.close();
});

it("shows invalid requests and unsupported endpoints even when no internal logger error is emitted", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const app = createApp();
  try {
    await (await app.fetch(new Request("http://localhost/v1/chat/completions", { method: "POST", body: '{"private-prompt-unfinished' }), { remoteAddress: "100.67.127.67" })).text();
    await (await app.fetch(new Request("http://localhost/v1/responses?api_key=private-query", { method: "POST" }), { remoteAddress: "100.67.127.67" })).text();
    const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status?address=100.67.127.67"))).json();
    expect(status.sources.errorHistory.total).toBe(2);
    expect(status.sources.errors.map((e: any) => e.status)).toEqual([404, 400]);
    expect(JSON.stringify(status.sources.errors)).not.toMatch(/private-prompt|private-query/);
    expect(status.sources.errors[1].diagnostic.type).toBe("invalid_request_error");
  } finally { app.close(); }
});

it("bounds error diagnostics and redacts common credentials and URL secrets", () => {
  const value = diagnosticText('Bearer abcdefg sk-123456 eyJabc.def.ghi password="hunter2" https://u:p@example.test/path?token=123');
  expect(value).not.toMatch(/abcdefg|sk-123456|eyJabc|hunter2|u:p|token=123/);
  expect(diagnosticText("x".repeat(40000))).toHaveLength(12000);
});
