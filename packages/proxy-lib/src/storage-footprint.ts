import { lstatSync, opendirSync, statfsSync } from "node:fs";
import { join } from "node:path";

/** Available bytes for the account running the proxy, on its shared data volume. */
export function filesystemCapacity(directory?: string) {
  if (directory) try {
    const fs = statfsSync(directory, { bigint: true });
    return { freeBytes: Number(fs.bavail * fs.bsize), capacityBytes: Number(fs.blocks * fs.bsize) };
  } catch { /* Unsupported or inaccessible volume: unknown, never zero. */ }
  return { freeBytes: null, capacityBytes: null };
}

const empty = () => ({ bytes: 0, files: 0 });
/** Metadata only. Bounded, cached scans never follow links or open file contents. */
export class StorageFootprint {
  private cached?: ReturnType<StorageFootprint["scan"]>;
  private checked = -Infinity;
  constructor(private directory?: string, private now = () => Date.now()) {}
  snapshot() {
    const now = this.now();
    if (!this.cached || now < this.checked || now - this.checked >= 30_000) {
      this.cached = this.scan(); this.checked = now;
    }
    return this.cached;
  }
  private scan() {
    const categories = { activity: empty(), operations: empty(), backups: empty(), logs: empty() };
    let complete = true, entries = 0;
    const deadline = performance.now() + 25;
    const visit = (folder: string, backup = false) => {
      let dir: ReturnType<typeof opendirSync> | undefined;
      try {
        if (!lstatSync(folder).isDirectory()) { complete = false; return; }
        dir = opendirSync(folder);
        while (true) {
          if (entries >= 2000 || performance.now() > deadline) { complete = false; break; }
          const item = dir.readSync(); if (!item) break;
          entries++;
          if (!item.isFile()) continue;
          const group = backup ? categories.backups
            : /^activity\.sqlite(?:-(?:wal|shm|journal))?$/.test(item.name) ? categories.activity
            : /\.sqlite(?:-(?:wal|shm|journal))?$/.test(item.name) ? categories.operations
            : /\.log(?:\.\d+)?$/.test(item.name) ? categories.logs : null;
          if (!group) continue;
          try {
            const stat = lstatSync(join(folder, item.name));
            if (stat.isFile()) { group.bytes += stat.size; group.files++; }
          } catch { complete = false; }
        }
      } catch (error) {
        // An absent backup directory is normal before the first backup.
        if (!backup || (error as NodeJS.ErrnoException).code !== "ENOENT") complete = false;
      } finally { dir?.closeSync(); }
    };
    if (this.directory) { visit(this.directory); visit(join(this.directory, "history-backups"), true); }
    return { categories, totalBytes: Object.values(categories).reduce((n, g) => n + g.bytes, 0),
      complete, persistent: !!this.directory, checkedAt: new Date(this.now()).toISOString(), cacheSeconds: 30 };
  }
}
