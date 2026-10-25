import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { z } from "zod/v4";
import { CONFIG_DIR, atomicWritePrivate } from "@m365-copilot/core";

const metadata = z.object({ version: z.literal(1), id: z.uuid(), createdAt: z.iso.datetime(), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), schema: z.literal(5), requests: z.number().int().nonnegative(), modelReports: z.number().int().nonnegative() }).strict();
type BackupInfo = z.infer<typeof metadata>;
async function digest(path: string) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }

/** Scan integrity off the HTTP event loop; the worker only opens the supplied local file read-only. */
function inspect(path: string): Promise<{ schema: 5; requests: number; modelReports: number }> {
  return new Promise((accept, reject) => {
    const worker = new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const {DatabaseSync}=require('node:sqlite');
      let db,result;try {
        db=new DatabaseSync(workerData,{readOnly:true});db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=1000');
        if(db.prepare('PRAGMA user_version').get().user_version!==5)throw Error('Unsupported schema');
        if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get())throw Error('Integrity failed');
        const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
        for(const name of ['metadata','systems','requests','hourly','system_totals','legacy_totals','model_checks','request_errors','request_timings','request_applications'])if(!tables.has(name))throw Error('Missing table');
        result={schema:5,requests:db.prepare('SELECT count(*) AS n FROM requests').get().n,modelReports:db.prepare('SELECT count(*) AS n FROM model_checks').get().n};
      }catch{result={error:true}}finally{db?.close()}parentPort.postMessage(result);
    `, { eval: true, workerData: path, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    let settled = false;
    const finish = (error?: Error, value?: { schema: 5; requests: number; modelReports: number }) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); error ? reject(error) : accept(value!); };
    const timer = setTimeout(() => finish(new Error("Backup verification exceeded 30 seconds")), 30_000);
    worker.once("message", result => result.error ? finish(new Error("Backup integrity or schema verification failed")) : finish(undefined, result));
    worker.once("error", () => finish(new Error("Backup verification worker failed")));
    worker.once("exit", () => { if (!settled) finish(new Error("Backup verification ended unexpectedly")); });
  });
}

export class HistoryBackups {
  readonly directory: string;
  readonly folder: string;
  constructor(directory = CONFIG_DIR) { this.directory = resolve(directory); this.folder = join(this.directory, "history-backups"); }
  private path(id: string, suffix = ".sqlite") { return join(this.folder, z.uuid().parse(id) + suffix); }
  private lock(name: string) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, name), fd = openSync(path, "wx", 0o600);
    return () => { closeSync(fd); rmSync(path); };
  }
  list(offset = 0) {
    const files = existsSync(this.folder) ? readdirSync(this.folder) : [];
    const fileSet = new Set(files);
    const names = files.filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    const all: BackupInfo[] = []; let unavailable = files.filter(name => /^[a-f0-9-]{36}\.sqlite$/.test(name) && !fileSet.has(name.slice(0, -7) + ".json")).length;
    for (const name of names) try { const id = name.slice(0, -5), info = metadata.parse(JSON.parse(readFileSync(this.path(id, ".json"), "utf8"))); if (info.id !== id || !existsSync(this.path(id))) throw new Error(); all.push(info); } catch { unavailable++; }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { backups: all.slice(offset, offset + 20), total: all.length, offset, limit: 20, unavailable, retention: "unlimited" };
  }
  async verify(id: string) {
    const info = metadata.parse(JSON.parse(readFileSync(this.path(id, ".json"), "utf8")));
    if (info.id !== id || statSync(this.path(id)).size !== info.bytes || await digest(this.path(id)) !== info.sha256) throw new Error("Backup checksum mismatch");
    const checked = await inspect(this.path(id));
    if (checked.requests !== info.requests || checked.modelReports !== info.modelReports) throw new Error("Backup row counts do not match its manifest");
    return { ...info, verified: true };
  }
  private async createUnlocked() {
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const id = randomUUID(), path = this.path(id), partial = path + ".partial";
    closeSync(openSync(partial, "wx", 0o600));
    let source: DatabaseSync | undefined;
    try {
      source = new DatabaseSync(join(this.directory, "activity.sqlite"), { readOnly: true });
      await backup(source, partial, { rate: 32 });
      const checked = await inspect(partial);
      const info: BackupInfo = { version: 1, id, createdAt: new Date().toISOString(), bytes: statSync(partial).size, sha256: await digest(partial), ...checked };
      if (process.platform !== "win32") chmodSync(partial, 0o600);
      renameSync(partial, path);
      atomicWritePrivate(this.path(id, ".json"), JSON.stringify(info, null, 2) + "\n");
      return { ...info, verified: true };
    } finally { source?.close(); for (const suffix of ["", "-wal", "-shm"]) rmSync(partial + suffix, { force: true }); }
  }
  async create() {
    if (existsSync(join(this.directory, "history-maintenance.lock"))) throw new Error("History restore is in progress");
    const release = this.lock("history-backups.lock");
    try { return await this.createUnlocked(); } finally { release(); }
  }
  async restore(id: string, apply = false) {
    const checked = await this.verify(id);
    const plan = { backup: checked, replaces: "Saved activity database only; newer history will be replaced. Account sign-in, keys and configuration are preserved.", requiresStoppedProxy: true, applied: false, safetyBackup: null as string | null };
    if (!apply) return plan;
    const releaseMaintenance = this.lock("history-maintenance.lock");
    let releaseBackups: (() => void) | undefined;
    const stage = join(this.directory, `activity-restore-${randomUUID()}.sqlite`), target = join(this.directory, "activity.sqlite");
    try {
      if (existsSync(join(this.directory, "instance.json"))) throw new Error("Stop the proxy before applying a history restore");
      releaseBackups = this.lock("history-backups.lock");
      copyFileSync(this.path(id), stage);
      if (process.platform !== "win32") chmodSync(stage, 0o600);
      if (await digest(stage) !== checked.sha256) throw new Error("Staged backup changed");
      await inspect(stage);
      if (!existsSync(target) && ["-wal", "-shm"].some(suffix => existsSync(target + suffix))) throw new Error("Orphaned history sidecars must be preserved and inspected before restore");
      if (existsSync(target)) {
        // Refuse corrupt/currently busy databases rather than deleting uncheckpointed WAL data.
        const safety = await this.createUnlocked(); plan.safetyBackup = safety.id;
        const current = new DatabaseSync(target);
        try { const checkpoint = current.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()!; if (Number(checkpoint.busy)) throw new Error("History is still in use"); }
        finally { current.close(); }
      }
      for (const suffix of ["-wal", "-shm"]) rmSync(target + suffix, { force: true });
      renameSync(stage, target);
      return { ...plan, applied: true };
    } finally { for (const suffix of ["", "-wal", "-shm"]) rmSync(stage + suffix, { force: true }); releaseBackups?.(); releaseMaintenance(); }
  }
}
export const historyBackups = new HistoryBackups();
