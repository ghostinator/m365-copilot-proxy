import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { filesystemCapacity, StorageFootprint } from "./storage-footprint.js";
const folders: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), "m365-footprint-")); folders.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

it("counts file lengths by category without opening credentials or walking unrelated directories", () => {
  vi.spyOn(performance,"now").mockReturnValue(0); // Keep inventory assertions independent of host load; the budget has its own test.
  const dir = directory(); mkdirSync(join(dir, "history-backups")); mkdirSync(join(dir, "frames"));
  for (const [name, bytes] of Object.entries({ "activity.sqlite": 10, "activity.sqlite-wal": 20, "alerts.sqlite": 30,
    "notifications.sqlite-shm": 40, "debug.log": 50, "debug.log.1": 60, "secrets.json": 900,
    "history-backups/one.sqlite": 70, "history-backups/one.json": 80, "history-backups/unfinished.partial": 90, "frames/frame.log": 1000 })) writeFileSync(join(dir, name), Buffer.alloc(bytes));
  const f = new StorageFootprint(dir).snapshot();
  expect(f).toMatchObject({ complete: true, totalBytes: 450, categories: {
    activity: { bytes: 30, files: 2 }, operations: { bytes: 70, files: 2 }, logs: { bytes: 110, files: 2 }, backups: { bytes: 240, files: 3 } } });
  expect(JSON.stringify(f)).not.toMatch(/secrets|unfinished|frames|one.sqlite/);
});

it("caches scans then refreshes and reports unknown capacity rather than zero for missing storage", () => {
  const dir = directory(); let now = 100000; const f = new StorageFootprint(dir, () => now);
  expect(f.snapshot().complete).toBe(true); writeFileSync(join(dir, "debug.log"), "abc");
  expect(f.snapshot().totalBytes).toBe(0); now += 30000; expect(f.snapshot().totalBytes).toBe(3);
  expect(filesystemCapacity(join(dir, "missing"))).toEqual({ freeBytes: null, capacityBytes: null });
  expect(new StorageFootprint().snapshot()).toMatchObject({ persistent: false, totalBytes: 0 });
});

it("marks bounded scans partial instead of claiming a complete zero", () => {
  const dir = directory(); let calls = 0; vi.spyOn(performance, "now").mockImplementation(() => calls++ * 100);
  expect(new StorageFootprint(dir).snapshot()).toMatchObject({ complete: false, totalBytes: 0 });
});

it("does not traverse a linked backup directory", () => {
  const dir = directory(), outside = directory(); writeFileSync(join(outside, "other.sqlite"), "private");
  symlinkSync(outside, join(dir, "history-backups"), process.platform === "win32" ? "junction" : "dir");
  expect(new StorageFootprint(dir).snapshot()).toMatchObject({ complete: false, categories: { backups: { bytes: 0, files: 0 } } });
});
