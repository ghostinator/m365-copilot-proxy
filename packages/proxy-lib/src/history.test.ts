import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { HttpActivity } from "./http-activity.js";
import { RequestSources } from "./request-sources.js";
import { HistoryBackups } from "./history-backups.js";
import { HistoryDownloads, csvCell } from "./history-export.js";
import { setImmediate } from "node:timers/promises";

afterEach(() => { vi.useRealTimers(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m365-history-")), sources = new RequestSources(dir), activity = new HttpActivity(sources);
  const app = randomUUID();
  const record = (n: number) => {
    for (let i = 0; i < n; i++) {
      const trace = activity.begin("POST", "/v1/chat/completions", false, "192.0.2.20")!;
      trace.applicationKey({ id: app, label: "=SUM(1,2)" }); trace.chat("claude-sonnet", true);
      if (i % 2 === 0) { trace.errorBody(JSON.stringify({ error: { type: "m365_throttled", message: "Bearer private-token" } })); trace.result(429); }
      trace(200);
    }
    sources.flush();
  };
  return { dir, sources, activity, record, app };
}
it("streams every filtered saved row beyond page limits using a frozen sequence boundary", async () => {
  const f = fixture(); f.record(251);
  const query = { requestKey: f.app, requestKind: "errors" as const, errorCategory: "throttling" as const, model: "claude-sonnet", address: "192.0.2.20", offset: 100, limit: 1 };
  const cursor = f.sources.exportCursor(query), downloads = new HistoryDownloads();
  expect(cursor.snapshot.records).toBe(126);
  const ticket = downloads.create(cursor, "json");
  f.record(20);
  const response = downloads.consume(new Request("http://localhost" + ticket.url));
  const result = await response.json();
  expect(result.records).toHaveLength(126);
  expect(new Set(result.records.map((r: { id: string }) => r.id)).size).toBe(126);
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(result.records.every((r: { applicationStatus: number }) => r.applicationStatus === 429)).toBe(true);
  expect(f.sources.snapshot(query).history.total).toBe(136);
  expect(downloads.consume(new Request("http://localhost" + ticket.url)).status).toBe(404);
  f.sources.close();
});
it("streams CSV with spreadsheet-formula protection and correct quotes/newlines", async () => {
  expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
  expect(csvCell(' \t+cmd')).toMatch(/^"'/);
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  const f = fixture(); f.record(3);
  const downloads = new HistoryDownloads(), ticket = downloads.create(f.sources.exportCursor(), "csv");
  const response = downloads.consume(new Request("http://localhost" + ticket.url)), text = await response.text();
  expect(response.headers.get("content-type")).toContain("text/csv");
  expect(text).toContain('"\'=SUM(1,2)"'); expect(text).not.toContain("private-token");
  expect(text.split("\r\n")).toHaveLength(5);
  f.sources.close();
});
it("limits pending downloads, rejects foreign origins and closes cancelled/expired readers", async () => {
  const f = fixture(); f.record(2);
  const downloads = new HistoryDownloads(), tickets = Array.from({ length: 4 }, () => downloads.create(f.sources.exportCursor(), "json"));
  expect(() => downloads.create(f.sources.exportCursor(), "json")).toThrow("four");
  expect(downloads.consume(new Request("http://localhost" + tickets[0].url, { headers: { origin: "https://evil.example" } })).status).toBe(404);
  const body = downloads.consume(new Request("http://localhost" + tickets[0].url)).body!;
  await body.cancel();
  const cursor = f.sources.exportCursor();
  vi.useFakeTimers(); const expiring = new HistoryDownloads(); const ticket = expiring.create(cursor, "json");
  await vi.advanceTimersByTimeAsync(60_001);
  expect(expiring.consume(new Request("http://localhost" + ticket.url)).status).toBe(404);
  expect(await cursor.next()).toBeNull();
  f.sources.close();
});
it("creates and verifies an online backup including reports, then rejects a corrupted copy", async () => {
  const f = fixture(); f.record(120);
  f.sources.saveModelCheck("claude-sonnet", 200, "offline fixture", 10);
  const manager = new HistoryBackups(f.dir), backup = await manager.create();
  expect(backup).toMatchObject({ verified: true, schema: 5, requests: 120, modelReports: 1 });
  expect(await manager.verify(backup.id)).toEqual(backup);
  expect(manager.list().total).toBe(1);
  const saved = new DatabaseSync(join(f.dir, "history-backups", backup.id + ".sqlite"), { readOnly: true });
  expect(saved.prepare("SELECT count(*) AS n FROM request_timings").get()!.n).toBe(120); saved.close();
  appendFileSync(join(f.dir, "history-backups", backup.id + ".sqlite"), "corrupted");
  await expect(manager.verify(backup.id)).rejects.toThrow("checksum");
  f.sources.close();
});
it("keeps online backups consistent while request writes continue", async () => {
  const f = fixture(); f.record(1000);
  const manager = new HistoryBackups(f.dir), pending = manager.create();
  for (let i = 0; i < 10; i++) { f.record(7); await setImmediate(); }
  const saved = await pending; expect(saved.requests).toBeGreaterThanOrEqual(1000); expect(saved.requests).toBeLessThanOrEqual(1070);
  const copy = new DatabaseSync(join(f.dir, "history-backups", saved.id + ".sqlite"), { readOnly: true });
  expect(copy.prepare("SELECT SUM(total) AS n FROM system_totals").get()!.n).toBe(saved.requests);
  expect(copy.prepare("SELECT count(*) AS n FROM request_timings").get()!.n).toBe(saved.requests);
  copy.close(); expect((await manager.verify(saved.id)).verified).toBe(true); f.sources.close();
});
it("previews restore, rejects an active instance, then preserves newer history in a safety backup", async () => {
  const f = fixture(); f.record(4); const manager = new HistoryBackups(f.dir), backup = await manager.create();
  f.record(6);
  const settings = '{"sourceLabels":{"192.0.2.20":"Production"}}';
  writeFileSync(join(f.dir, "server.json"), settings); writeFileSync(join(f.dir, "proxy-api-keys.json"), "configuration sentinel");
  expect((await manager.restore(backup.id)).applied).toBe(false);
  writeFileSync(join(f.dir, "instance.json"), "{}");
  await expect(manager.restore(backup.id, true)).rejects.toThrow("Stop the proxy");
  expect(f.sources.snapshot().history.total).toBe(10);
  const { unlinkSync } = await import("node:fs"); unlinkSync(join(f.dir, "instance.json"));
  f.sources.close();
  const result = await manager.restore(backup.id, true);
  expect(result.applied).toBe(true); expect(result.safetyBackup).not.toBeNull();
  expect((await manager.verify(result.safetyBackup!)).requests).toBe(10);
  const restored = new RequestSources(f.dir); expect(restored.snapshot().history.total).toBe(4); restored.close();
  expect(readFileSync(join(f.dir, "server.json"), "utf8")).toBe(settings);
  expect(readFileSync(join(f.dir, "proxy-api-keys.json"), "utf8")).toBe("configuration sentinel");
  expect(existsSync(join(f.dir, "history-maintenance.lock"))).toBe(false);
});
it("cleans up failed backup creation and refuses path traversal without touching history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-history-empty-")), manager = new HistoryBackups(dir);
  await expect(manager.create()).rejects.toThrow();
  expect(readdirSync(join(dir, "history-backups"))).toHaveLength(0);
  expect(existsSync(join(dir, "history-backups.lock"))).toBe(false);
  await expect(manager.verify("../server.json")).rejects.toThrow();
});
