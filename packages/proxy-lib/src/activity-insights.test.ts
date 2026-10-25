import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityDatabase } from "./activity-database.js";
import { activityQuery, parseActivityQuery, entry } from "./activity-schema.js";
import { HttpActivity } from "./http-activity.js";
import { RequestSources } from "./request-sources.js";

afterEach(() => vi.restoreAllMocks());
const now = Date.parse("2026-10-25T18:00:00Z");
function saved(durationMs = 100, at = now) {
  return { id: randomUUID(), receivedAt: new Date(at).toISOString(), address: "192.0.2.20", method: "POST", endpoint: "/v1/chat/completions", source: "application", status: 200, outcome: "success", durationMs, responseBytes: 25, model: "claude-sonnet", servedModel: "claude-sonnet", firstByteMs: 30, queueMs: 5 };
}
const query = (value = {}) => activityQuery.parse(value);

it("computes exact filtered chat percentiles and empty intervals without mixing checks or model polls", () => {
  const db = new ActivityDatabase();
  db.write(Array.from({ length: 20 }, (_, index) => ({
    ...saved((index + 1) * 100, now - index * 3600000),
    outcome: index === 18 ? "error" : index === 19 ? "cancelled" : "success",
  })).map(value => entry.parse(value)));
  const p = db.snapshot(query({ range: "24h" }), now).performance;
  expect(p).toMatchObject({ total: 20, succeeded: 18, failed: 1, cancelled: 1, p50Ms: 1000, p95Ms: 1900, successRate: .9, firstByteSamples: 20, queueSamples: 20 });
  expect(p.buckets.reduce((sum, bucket) => sum + Number(bucket.total), 0)).toBe(20);
  expect(p.buckets.length).toBeLessThanOrEqual(48);
  expect(p.buckets.some(bucket => !bucket.total && bucket.durationMs === null)).toBe(true);
  expect(db.snapshot(query({ address: "192.0.2.99" }), now).performance).toMatchObject({ total: 0, p50Ms: null, p95Ms: null, successRate: null });
  db.close();
});

it("excludes non-chat traffic, manual checks, future samples and other client/model filters", () => {
  const db = new ActivityDatabase();
  const values = [
    saved(), { ...saved(), endpoint: "/v1/models" }, { ...saved(), source: "self-check" },
    saved(100, now + 1), { ...saved(), address: "192.0.2.30" }, { ...saved(), model: "m365-copilot" },
  ];
  db.write(values.map(value => entry.parse(value)));
  expect(db.snapshot(query({ model: "claude-sonnet", address: "192.0.2.20" }), now).performance.total).toBe(1);
  db.close();
});

it("upgrades schema 3 without inventing timings or losing old requests and check reports", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const directory = mkdtempSync(join(tmpdir(), "m365-insights-upgrade-"));
  const original = new ActivityDatabase(directory);
  original.write([entry.parse(saved())]);
  original.saveModelCheck("claude-sonnet", 200, "old report", 50);
  original.db.exec("DROP INDEX requests_application_time; ALTER TABLE requests DROP COLUMN application_id; DROP TABLE request_applications; DROP TABLE request_timings; PRAGMA user_version=3");
  original.close();
  const upgraded = new ActivityDatabase(directory);
  const result = upgraded.snapshot(query(), now + 60000);
  expect(result.history.total).toBe(1);
  expect(result.recent[0]).toMatchObject({ timingRecorded: false, firstByteMs: null, upstreamAttempts: null, timeline: [] });
  expect(result.performance).toMatchObject({ total: 1, p50Ms: 100, firstByteMs: null, firstByteSamples: 0 });
  expect(result.checkHistory.total).toBe(1);
  expect(upgraded.db.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
  upgraded.close();
});

it("persists an actual retry/fallback/stream timeline and timing values across restart", () => {
  let clock = now;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const directory = mkdtempSync(join(tmpdir(), "m365-inspector-"));
  const store = new RequestSources(directory), activity = new HttpActivity(store);
  const trace = activity.begin("POST", "/v1/chat/completions", false, "192.0.2.20")!;
  trace.chat("claude-sonnet", true); trace.phase("queued");
  clock += 25; trace.admitted(); trace.upstream("claude-sonnet");
  clock += 10; trace.upstreamFailed(); trace.upstream("m365-copilot");
  clock += 15; trace.output(25);
  clock += 50; trace.result(200); trace(200);
  store.close();
  const restored = new RequestSources(directory);
  const request = restored.snapshot().recent[0];
  expect(request).toMatchObject({ timingRecorded: true, queueMs: 25, firstByteMs: 50, durationMs: 100, upstreamAttempts: 2, upstreamFailures: 1, servedModel: "m365-copilot" });
  expect(request.timeline.map((point: any) => point.phase)).toEqual(["received", "queued", "preparing", "upstream", "upstream-failed", "upstream", "streaming", "completed"]);
  expect(request.timeline.map((point: any) => point.atMs)).toEqual([0, 0, 25, 25, 35, 35, 50, 100]);
  restored.close();
});

it("bounds verbose timelines while retaining the final cancellation", () => {
  const activity = new HttpActivity();
  const trace = activity.begin("POST", "/v1/chat/completions")!;
  trace.chat("claude-sonnet", false);
  for (let index = 0; index < 150; index++) { trace.upstream("claude-sonnet"); trace.upstreamFailed(); }
  trace(499);
  const request = activity.sources.snapshot().recent[0];
  expect(request.timeline).toHaveLength(128);
  expect(request.timelineTruncated).toBe(true);
  expect(request.timeline.at(-1).phase).toBe("cancelled");
  expect(request.upstreamAttempts).toBe(150);
  activity.sources.close();
});

it("pages and compares saved checks without treating self-reported identities as passed tests", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const db = new ActivityDatabase();
  db.saveModelCheck("claude-sonnet", 200, "", 50, "claude-sonnet", "function-tool", "failed", "No call");
  db.saveModelCheck("claude-sonnet", 200, "", 60, "m365-copilot", "function-tool", "passed", "Valid call");
  db.saveModelCheck("claude-sonnet", 200, "Self ID", 20, "claude-sonnet", "identity", "reported");
  const result = db.snapshot(query({ checkKind: "function-tool", checkLimit: 1, address: "192.0.2.99" }), now).checkHistory;
  expect(result).toMatchObject({ total: 2, offset: 0, clientFilterApplies: false });
  expect(result.reports[0]).toMatchObject({ verdict: "passed", previousVerdict: "failed", previousServedModel: "claude-sonnet", servedModel: "m365-copilot" });
  expect(result.summary[0]).toMatchObject({ samples: 2, passed: 1, failed: 1, errors: 0, reported: 0 });
  expect(db.snapshot(query({ checkOffset: 1, checkLimit: 1, checkKind: "function-tool" }), now).checkHistory.reports[0].verdict).toBe("failed");
  expect(db.snapshot(query({ checkKind: "identity" }), now).checkHistory.summary[0]).toMatchObject({ samples: 1, passed: 0, reported: 1 });
  expect(() => parseActivityQuery(new URLSearchParams("checkKind=unknown"))).toThrow();
  db.close();
});

