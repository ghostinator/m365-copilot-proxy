import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ActivityDatabase } from "./activity-database.js";
import { activityQuery, entry } from "./activity-schema.js";
import { modelReliability } from "./model-reliability.js";

const now = Date.parse("2026-10-25T18:00:00Z"), day = 86_400_000, key = randomUUID();
const query = (options = {}) => activityQuery.parse({ range: "24h", ...options });
function request(at: number, options = {}) {
  return entry.parse({ id: randomUUID(), address: "192.0.2.1", receivedAt: new Date(at).toISOString(),
    method: "POST", endpoint: "/v1/chat/completions", source: "application", status: 200, outcome: "success",
    durationMs: 100, responseBytes: 10, model: "claude-sonnet", servedModel: "claude-sonnet", ...options });
}

it("compares disjoint adjacent periods, preserves cancellations, stream errors and fallback routes", () => {
  const db = new ActivityDatabase();
  db.write([request(now - 2 * day), request(now - day), request(now - day + 1),
    request(now, { outcome: "error", applicationStatus: 502, servedModel: null }),
    request(now, { outcome: "cancelled", servedModel: "m365-copilot" }), request(now + 1)]);
  const result = modelReliability(db.db, query(), now);
  expect(result.current).toMatchObject({ total: 3, succeeded: 1, failed: 1, cancelled: 1, successRate: 1 / 3 });
  expect(result.previous).toMatchObject({ total: 1, succeeded: 1 });
  expect(result.routes).toHaveLength(3);
  expect(result.routes.find(r => r.servedModel === null)?.current.failed).toBe(1);
  expect(result.routes.find(r => r.servedModel === "m365-copilot")?.current.cancelled).toBe(1);
  expect(result.routes.find(r => r.servedModel === "claude-sonnet")?.changePoints).toBe(0);
  expect(result.buckets.reduce((sum, b) => sum + b.total, 0)).toBe(3);
  db.close();
});

it("filters clients and named applications without selection bias from request/error/check controls", () => {
  const db = new ActivityDatabase();
  const opts = { apiKeyId: key, apiKeyLabel: "Production" };
  db.write([request(now, opts), request(now, { ...opts, outcome: "error", applicationStatus: 429 }),
    request(now), request(now, { ...opts, address: "192.0.2.2" }), request(now, { ...opts, model: "m365-copilot" }),
    request(now, { ...opts, source: "self-check" }), request(now, { ...opts, endpoint: "/v1/models" }),
    request(now, { ...opts, endpoint: "/v1/proxy/model-check" })]);
  const r = modelReliability(db.db, query({ model: "claude-sonnet", address: "192.0.2.1", requestKey: key,
    requestKind: "errors", errorCategory: "throttling", requestId: randomUUID(), checkKind: "shell-tool" }), now);
  expect(r.current).toMatchObject({ total: 2, succeeded: 1, failed: 1, successRate: .5 });
  expect(modelReliability(db.db, query({ requestKey: "unattributed" }), now).current.total).toBe(1);
  db.close();
});

it("uses exact route p95 samples, distinguishes previous-only routes and leaves missing comparisons unknown", () => {
  const db = new ActivityDatabase();
  db.write(Array.from({ length: 20 }, (_, i) => request(now - i, { durationMs: (i + 1) * 100 })));
  db.write([request(now - day - 1, { servedModel: "m365-copilot" })]);
  const r = modelReliability(db.db, query(), now);
  expect(r.routes[0].current).toMatchObject({ total: 20, p95Ms: 1900, averageDurationMs: 1050 });
  expect(r.routes[0].changePoints).toBeNull();
  expect(r.routes[1].current.successRate).toBeNull();
  expect(r.routes[1].previous?.total).toBe(1);
  const all = modelReliability(db.db, query({ range: "all" }), now);
  expect(all.current.total).toBe(21); expect(all.previous).toBeNull();
  expect(all.routes.every(route => route.previous === null && route.changePoints === null)).toBe(true);
  expect(all.buckets.length).toBeLessThanOrEqual(48);
  expect(all.buckets.some(b => b.total === 0 && b.successRate === null)).toBe(true);
  db.close();
});

it("returns bounded routes without truncating totals and handles an empty database", () => {
  const db = new ActivityDatabase();
  const empty = modelReliability(db.db, query(), now);
  expect(empty.current).toMatchObject({ total: 0, successRate: null }); expect(empty.routes).toEqual([]);
  // Old/custom stored identifiers may outlive today's registry. Queries must remain bounded.
  db.write(Array.from({ length: 130 }, (_, i) => request(now - i)));
  db.db.exec("UPDATE requests SET model='historical-'||seq");
  const r = modelReliability(db.db, query(), now);
  expect(r.routes).toHaveLength(100); expect(r.routeCount).toBe(130); expect(r.current.total).toBe(130);
  expect(r.buckets.reduce((sum, b) => sum + b.total, 0)).toBe(130);
  db.close();
});
