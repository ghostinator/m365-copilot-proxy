import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HttpActivity } from "./http-activity.js";
import { RequestSources, sourceAddress } from "./request-sources.js";
import { createApp } from "./index.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("canonicalizes real IP addresses without retaining arbitrary client strings", () => {
  expect(sourceAddress("::ffff:100.64.0.2")).toBe("100.64.0.2");
  expect(sourceAddress("::ffff:6440:2")).toBe("100.64.0.2");
  expect(sourceAddress("2001:0DB8:0:0::1")).toBe("2001:db8::1");
  expect(sourceAddress("fe80::1%eth0")).toBe("fe80::1");
  expect(sourceAddress("private-hostname-or-key")).toBe("unknown");
});

it("persists source rankings and errors once across restart, separately from self-checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-sources-"));
  const store = new RequestSources(dir), activity = new HttpActivity(store);
  const complete = activity.begin("POST", "/v1/chat/completions", false, "::ffff:100.64.0.2")!;
  complete.chat("claude-sonnet", true); complete.result(429); complete.output(123); complete(200); complete(500);
  activity.begin("GET", "/v1/models", false, "100.64.0.2")!(200);
  for (let i = 0; i < 4; i++) activity.begin("GET", "/health/live", true, "100.64.0.3")!(200);
  activity.begin("POST", "/secret-path", false, "100.64.0.2")!(499);
  store.flush();
  store.close();
  const restarted = new RequestSources(dir), restored = restarted.snapshot();
  expect(restored.persistent).toBe(true);
  expect(restored.systems[0]).toMatchObject({ address: "100.64.0.2", total: 3, applicationRequests: 3, chats: 1, failed: 1, cancelled: 1, responseBytes: 123 });
  expect(restored.systems[1]).toMatchObject({ address: "100.64.0.3", applicationRequests: 0, selfChecks: 4 });
  expect(restored.recent).toHaveLength(7);
  expect(readFileSync(join(dir, "activity.sqlite")).includes(Buffer.from("secret-path"))).toBe(false);
  restarted.close();
});

it("uses transport context and ignores forged forwarding or system-name headers", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const app = createApp();
  try {
    const req = () => new Request("http://localhost/v1/models", { headers: { "x-forwarded-for": "100.64.99.99", "x-real-ip": "100.64.99.99", "x-client-name": "private-client-name" } });
    await (await app.fetch(req(), { remoteAddress: "100.64.0.4" })).text();
    await (await app.fetch(req())).text();
    const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status"))).json();
    expect(status.sources.systems.map((row: any) => row.address).sort()).toEqual(["100.64.0.4", "unknown"]);
    expect(JSON.stringify(status.sources)).not.toMatch(/100\.64\.99\.99|private-client-name/);
  } finally { app.close(); }
});

it("retains unlimited history and systems while bounding displayed results", () => {
  const activity = new HttpActivity();
  for (let i = 0; i < 600; i++) activity.begin("GET", "/v1/models", false, `10.0.${Math.floor(i / 256)}.${i % 256}`)!(200);
  expect(activity.sources.snapshot().summary.systems).toBe(600);
  expect(activity.sources.snapshot().storage.storedRecords).toBe(600);
  expect(activity.sources.snapshot().systems).toHaveLength(50);
  expect(activity.sources.snapshot().recent).toHaveLength(20);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 24 * 60 * 60_000);
  expect(activity.sources.snapshot().summary.systems).toBe(600);
  expect(activity.sources.snapshot({ range: "30d" }).summary.total).toBe(0);
  expect(activity.sources.snapshot().storage.retention).toBe("unlimited");
  activity.sources.close();
});

it("treats corrupt storage and failed persistence as diagnostic errors rather than failed requests", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-sources-invalid-"));
  writeFileSync(join(dir, "request-sources.json"), "{broken");
  const corrupt = new RequestSources(dir);
  expect(corrupt.snapshot().error).toContain("could not be migrated");
  corrupt.close();
  const file = join(dir, "not-a-directory"); writeFileSync(file, "fixture");
  const store = new RequestSources(file), activity = new HttpActivity(store);
  expect(() => activity.begin("GET", "/v1/models", false, "127.0.0.1")!(200)).not.toThrow();
  store.flush();
  expect(store.snapshot().error).toContain("could not be saved");
  expect(activity.snapshot().failed).toBe(0);
  store.close();
});

function event(at: number, address = "100.64.0.2", model = "claude-sonnet") {
  return { clientAddress: address, clientSoftware: "OpenAI Python", id: randomUUID(), method: "POST", endpoint: "/v1/chat/completions", source: "application" as const, receivedAt: new Date(at).toISOString(), status: 200, durationMs: 123, phase: "completed" as const, outcome: "success" as const, model, servedModel: model, streamed: false, applicationStatus: 200, responseBytes: 345, firstByteMs: 3, queueMs: 2, upstreamAttempts: 1, upstreamFailures: 0 };
}

it("computes exact rolling boundaries using raw edge hours plus full hourly buckets", () => {
  const now = Date.parse("2026-10-25T18:23:45.000Z"), day = 86400000;
  const store = new RequestSources();
  for (const age of [0, 24 * 3600000, 24 * 3600000 + 1, 7 * day, 7 * day + 1, 30 * day, 30 * day + 1, 400 * day]) store.record(event(now - age));
  expect(store.snapshot({ range: "24h" }, now).summary.total).toBe(2);
  expect(store.snapshot({ range: "7d" }, now).summary.total).toBe(4);
  expect(store.snapshot({ range: "30d" }, now).summary.total).toBe(6);
  expect(store.snapshot({ range: "365d" }, now).summary.total).toBe(7);
  expect(store.snapshot({ range: "all" }, now).summary.total).toBe(8);
  expect(store.snapshot({ range: "24h" }, now).summary.averageDurationMs).toBe(123);
  store.close();
});

it("supports model/client breakdowns, system labels, deduplication and deep history pages", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-db-labels-"));
  writeFileSync(join(dir, "server.json"), JSON.stringify({ sourceLabels: { "100.67.127.67": "pueblo-agent", "100.119.206.22": "debiandev · ai-hedge-fund-crypto (prod)" } }));
  const store = new RequestSources(dir), first = event(Date.now(), "100.67.127.67");
  store.record(first); store.record(first);
  for (let i = 0; i < 55; i++) store.record(event(Date.now(), "100.119.206.22", "claude-opus"));
  expect(store.snapshot().summary.total).toBe(56);
  expect(store.snapshot().labels["100.67.127.67"]).toBe("pueblo-agent");
  expect(store.snapshot().labels["127.0.0.1"]).toBe("This device");
  expect(store.snapshot({ model: "claude-opus", offset: 20, limit: 20 }).history).toEqual({ total: 55, offset: 20, limit: 20 });
  expect(store.snapshot({ model: "claude-opus" }).summary.total).toBe(55);
  expect(store.snapshot({ model: "claude-opus" }).modelActivity[0]).toMatchObject({ model: "claude-opus", address: "100.119.206.22", clientSoftware: "OpenAI Python", applicationRequests: 55 });
  expect(store.snapshot({ address: "100.67.127.67" }).recent).toHaveLength(1);
  expect(store.snapshot().storage.totalBytes).toBeGreaterThan(0);
  store.close();
  if (process.platform !== "win32") expect(statSync(join(dir, "activity.sqlite")).mode & 0o777).toBe(0o600);
});

it("migrates legacy records once and preserves undated aggregate remainders only in all-time statistics", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-db-migrate-"));
  const at = new Date().toISOString(), record = { ...event(Date.now()), address: "100.64.0.2" };
  const original = JSON.stringify({ version: 1, startedAt: at, systems: [{ address: "100.64.0.2", firstSeen: at, lastSeen: at, total: 10, applicationRequests: 10, selfChecks: 0, chats: 10, models: 0, health: 0, other: 0, failed: 0, cancelled: 0, responseBytes: 3450 }], recent: [record] });
  writeFileSync(join(dir, "request-sources.json"), original);
  const store = new RequestSources(dir);
  expect(store.snapshot().summary.total).toBe(10);
  expect(store.snapshot().legacyUndated).toBe(9);
  expect(store.snapshot({ range: "24h" }).summary.total).toBe(1);
  expect(store.snapshot().history.total).toBe(1);
  store.close();
  const restarted = new RequestSources(dir);
  expect(restarted.snapshot().summary.total).toBe(10);
  expect(restarted.snapshot().storage.storedRecords).toBe(1);
  expect(readFileSync(join(dir, "request-sources.json"), "utf8")).toBe(original);
  restarted.close();
  const database = new DatabaseSync(join(dir, "activity.sqlite"), { readOnly: true });
  expect(database.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
  database.close();
});

it("keeps every explicit model-test report while presenting the latest result per model", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-model-report-history-")), store = new RequestSources(dir);
  store.saveModelCheck("claude-sonnet", 200, "First self-report", 10, "claude-sonnet");
  store.saveModelCheck("claude-sonnet", 429, "", 20, null);
  expect(store.snapshot().modelChecks).toHaveLength(1);
  expect(store.snapshot().modelChecks[0].status).toBe(429);
  store.close();
  const database = new DatabaseSync(join(dir, "activity.sqlite"), { readOnly: true });
  expect(database.prepare("SELECT COUNT(*) AS count FROM model_checks").get()!.count).toBe(2);
  database.close();
});
