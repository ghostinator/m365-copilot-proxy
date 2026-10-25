import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityDatabase } from "./activity-database.js";
import { entry } from "./activity-schema.js";
import { HttpActivity } from "./http-activity.js";
import { metricsResponse } from "./metrics.js";
import { createApp } from "./index.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const now = Date.parse("2026-10-25T20:00:00Z"), day = 86_400_000;
const saved = (at: number) => entry.parse({ id: randomUUID(), address: "192.0.2.1", receivedAt: new Date(at).toISOString(), method: "GET", endpoint: "/v1/models", source: "application", status: 200, outcome: "success", durationMs: 10, responseBytes: 100 });

it("plans from a bounded observed window, excludes future traffic, and preserves all records", () => {
  const db = new ActivityDatabase(mkdtempSync(join(tmpdir(), "m365-growth-")));
  db.write([saved(now - 10 * day), ...Array.from({ length: 20 }, () => saved(now - day)), saved(now + day)]);
  const g = db.storage(now).growth;
  expect(g).toMatchObject({ records: 22, recentRequests: 20, observedMs: 7 * day, status: "estimate" });
  expect(g.requestsPerDay).toBeCloseTo(20 / 7);
  expect(g.bytesPerDay).toBeGreaterThan(0); expect(g.bytesPer30Days).toBeCloseTo(g.bytesPerDay! * 30);
  expect(g.freeBytes).not.toBeNull(); expect(g.capacityBytes).toBeGreaterThanOrEqual(g.freeBytes!);
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM requests").get()!.n).toBe(22); db.close();
});

it("does not project empty, short, undersampled or in-memory history as reliable disk growth", () => {
  const db = new ActivityDatabase(mkdtempSync(join(tmpdir(), "m365-growth-empty-")));
  expect(db.storage(now).growth).toMatchObject({ records: 0, bytesPerRecord: null, bytesPerDay: null, status: "insufficient-samples" });
  db.write(Array.from({ length: 19 }, () => saved(now - day)));
  expect(db.storage(now).growth.bytesPerDay).toBeNull(); db.close();
  const short = new ActivityDatabase(mkdtempSync(join(tmpdir(), "m365-growth-short-")));
  short.write(Array.from({ length: 20 }, () => saved(now - 30 * 60_000)));
  expect(short.storage(now).growth.bytesPerDay).toBeNull(); short.close();
  const memory = new ActivityDatabase(); memory.write(Array.from({ length: 20 }, () => saved(now - day)));
  expect(memory.storage(now).growth).toMatchObject({ bytesPerDay: null, freeBytes: null, status: "in-memory" }); memory.close();
});

it("keeps logical growth estimates stable across a WAL checkpoint while physical usage changes", () => {
  const db = new ActivityDatabase(mkdtempSync(join(tmpdir(), "m365-growth-wal-")));
  db.write(Array.from({ length: 40 }, () => saved(now - day)));
  const before = db.storage(now); expect(before.walBytes).toBeGreaterThan(0);
  db.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const after = db.storage(now); expect(after.walBytes).toBe(0);
  expect(after.growth.logicalBytes).toBe(before.growth.logicalBytes);
  expect(after.growth.bytesPerDay).toBe(before.growth.bytesPerDay); db.close();
});

it("leaves metrics disabled without sampling storage or counting the scrape", async () => {
  vi.stubEnv("M365_METRICS", "0"); const activity = new HttpActivity();
  const read = vi.spyOn(activity.sources, "storageStatistics");
  expect(metricsResponse(activity).status).toBe(404); expect(read).not.toHaveBeenCalled();
  expect(activity.begin("GET", "/v1/proxy/metrics")).toBeNull();
  expect(activity.metricsSnapshot().total).toBe(0); activity.sources.close();
});

it("exports cumulative histogram samples and SSE errors without client, model or credential labels", async () => {
  vi.stubEnv("M365_METRICS", "1"); const activity = new HttpActivity();
  let time = now; vi.spyOn(Date, "now").mockImplementation(() => time);
  const first = activity.begin("POST", "/v1/chat/completions", false, "192.0.2.99", "sensitive-user-agent")!;
  first.applicationKey({ id: randomUUID(), label: "secret-application" }); first.chat("secret-model", false);
  time += 100; first(200); first(200); // A duplicate finish must not double count.
  const fail = activity.begin("POST", "/v1/chat/completions")!; fail.chat("claude-sonnet", true); fail.result(429);
  fail.diagnostic("private-error", "Bearer secret-token"); time += 2000; fail(200);
  const cancel = activity.begin("POST", "/v1/chat/completions")!; cancel.chat("claude-sonnet", true); time += 7000; cancel(499);
  const response = metricsResponse(activity), text = await response.text();
  expect(response.headers.get("content-type")).toContain("version=0.0.4"); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(text).toContain('m365_proxy_chats_total{outcome="error"} 1');
  expect(text).toContain('m365_proxy_chats_total{outcome="cancelled"} 1');
  expect(text).toContain('m365_proxy_http_duration_seconds_bucket{le="0.1"} 1');
  expect(text).toContain('m365_proxy_http_duration_seconds_bucket{le="5"} 2');
  expect(text).toContain('m365_proxy_http_duration_seconds_bucket{le="+Inf"} 3');
  expect(text).toContain("m365_proxy_http_duration_seconds_count 3");
  expect(text).toContain("m365_proxy_http_duration_seconds_sum 9.1");
  expect(text).not.toMatch(/192\.0\.2|secret-|sensitive-|private-error|Bearer|claude-sonnet|NaN/);
  const labels = [...text.matchAll(/[{,](\w+)=/g)].map(m => m[1]);
  expect([...new Set(labels)].sort()).toEqual(["component", "kind", "le", "outcome", "rule", "source"]);
  expect(text.endsWith("\n")).toBe(true); activity.sources.close();
});

it("uses existing optional-key/origin policy and scrapes never grow activity or history", async () => {
  vi.stubEnv("M365_METRICS", "1"); vi.stubEnv("M365_API_KEY", "private-metrics-key"); const app = createApp();
  const request = (headers = {}) => app.fetch(new Request("http://localhost/v1/proxy/metrics", { headers }));
  expect((await request()).status).toBe(401);
  expect((await request({ authorization: "Bearer private-metrics-key", origin: "https://untrusted.invalid" })).status).toBe(403);
  const first = await request({ authorization: "Bearer private-metrics-key" }); expect(first.status).toBe(200); await first.text();
  await (await request({ authorization: "Bearer private-metrics-key" })).text();
  const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status", { headers: { authorization: "Bearer private-metrics-key" } }))).json();
  expect(status.activity.total).toBe(0); expect(status.sources.history.total).toBe(0); expect(status.metrics.enabled).toBe(true);
  app.close();
  vi.stubEnv("M365_API_KEY", ""); const keyless = createApp(); expect((await keyless.fetch(new Request("http://localhost/v1/proxy/metrics"))).status).toBe(200); keyless.close();
});

it("marks unavailable history explicitly without inventing zero-valued storage samples", async () => {
  vi.stubEnv("M365_METRICS", "1"); const activity = new HttpActivity();
  vi.spyOn(activity.sources, "storageStatistics").mockReturnValue({ storage: null, available: false, unsavedRecords: 3, lostRecords: 2 });
  const text = await metricsResponse(activity).text(); expect(text).toContain("m365_proxy_history_available 0");
  expect(text).toContain("m365_proxy_history_unsaved_records 3"); expect(text).not.toContain("# TYPE m365_proxy_history_bytes");
  activity.sources.close();
});
