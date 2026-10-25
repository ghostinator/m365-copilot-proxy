import { mkdtempSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { RequestSources } from "./request-sources.js";
import { HttpActivity } from "./http-activity.js";
import { HistoryBackups } from "./history-backups.js";
import { BackupDownloads } from "./backup-downloads.js";
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m365-backup-download-")), sources = new RequestSources(dir), activity = new HttpActivity(sources);
  activity.begin("GET", "/v1/models", false, "192.0.2.1")!(200); sources.flush(); sources.close();
  const manager = new HistoryBackups(dir), backup = await manager.create(), downloads = new BackupDownloads();
  return { dir, manager, backup, downloads };
}
it("streams only a verified backup, with its checksum and one-use capability", async () => {
  const f = await fixture(), ticket = await f.downloads.create(f.manager, f.backup.id);
  expect(JSON.stringify(ticket)).not.toContain(f.dir);
  const response = f.downloads.consume(new Request("http://localhost"+ticket.url));
  expect(response.headers.get("content-type")).toBe("application/vnd.sqlite3");
  expect(response.headers.get("x-checksum-sha256")).toBe(f.backup.sha256);
  const bytes = Buffer.from(await response.arrayBuffer()); expect(bytes.subarray(0,16).toString()).toBe("SQLite format 3\0");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(f.backup.sha256);
  expect(bytes).toEqual(readFileSync(join(f.dir,"history-backups",f.backup.id+".sqlite")));
  expect(f.downloads.consume(new Request("http://localhost"+ticket.url)).status).toBe(404);
});
it("refuses corrupt backups and client-controlled paths", async () => {
  const f = await fixture(); appendFileSync(join(f.dir,"history-backups",f.backup.id+".sqlite"), "corrupt");
  await expect(f.downloads.create(f.manager, f.backup.id)).rejects.toThrow("checksum");
  await expect(f.downloads.create(f.manager, "../server.json")).rejects.toThrow();
});
it("does not spend tickets on foreign origins/non-GET, and releases cancelled downloads", async () => {
  const f = await fixture(), ticket = await f.downloads.create(f.manager, f.backup.id);
  expect(f.downloads.consume(new Request("http://localhost"+ticket.url,{headers:{origin:"http://foreign.invalid"}})).status).toBe(404);
  expect(f.downloads.consume(new Request("http://localhost"+ticket.url,{method:"POST"})).status).toBe(404);
  const response = f.downloads.consume(new Request("http://localhost"+ticket.url)); expect(response.status).toBe(200); await response.body!.cancel(); await setImmediate();
});
it("bounds concurrent preparations and expires unused file descriptors", async () => {
  const f = await fixture(), jobs = Array.from({length:4},()=>f.downloads.create(f.manager,f.backup.id));
  await expect(f.downloads.create(f.manager,f.backup.id)).rejects.toThrow("four");
  const tickets = await Promise.all(jobs); vi.useFakeTimers({toFake:["Date"]});
  try {
    vi.setSystemTime(Date.now()+60_001);
    for(const ticket of tickets) expect(f.downloads.consume(new Request("http://localhost"+ticket.url)).status).toBe(404);
    const next = await f.downloads.create(f.manager,f.backup.id), response = f.downloads.consume(new Request("http://localhost"+next.url));
    await response.body!.cancel(); await setImmediate();
  } finally { vi.useRealTimers(); }
});
