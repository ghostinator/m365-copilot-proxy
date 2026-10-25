import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { EventBatch, NotificationEventRow } from "./notification-store.js";

export const alertSettings = z.object({ enabled: z.boolean(), windowMinutes: z.number().int().min(1).max(60),
  minRequests: z.number().int().min(1).max(10000), minFailures: z.number().int().min(1).max(10000),
  failurePercent: z.number().int().min(1).max(100), sustainSeconds: z.number().int().min(30).max(3600),
  failures: z.boolean(), throttling: z.boolean(), authentication: z.boolean(), storage: z.boolean(),
}).strict().refine(s => s.minFailures <= s.minRequests, { message: "Minimum failures must not exceed minimum requests" });
export type AlertSettings = z.infer<typeof alertSettings>;
export const defaultAlerts: AlertSettings = { enabled: false, windowMinutes: 5, minRequests: 10, minFailures: 5,
  failurePercent: 50, sustainSeconds: 60, failures: true, throttling: true, authentication: true, storage: true };
export type AlertRule = "failures" | "throttling" | "authentication" | "storage";
export interface AlertFact { rule: AlertRule; triggered: boolean | null; evidence: string }

/** Separate operational store: activity schema/backups and account files remain unchanged. */
export class AlertStore {
  private db?: DatabaseSync;
  readonly path: string;
  constructor(private directory?: string) { this.path = directory ? join(directory, "alerts.sqlite") : ":memory:"; }
  private open() {
    if (this.db) return this.db;
    if (this.directory) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      if (!existsSync(this.path)) closeSync(openSync(this.path, "wx", 0o600));
      if (process.platform !== "win32") chmodSync(this.path, 0o600);
    }
    const db = new DatabaseSync(this.path);
    try {
      db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
      if (version > 1) throw new Error("Unsupported alert store version");
      db.exec(`CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,rule TEXT NOT NULL UNIQUE,opened_ms INTEGER NOT NULL,
          last_seen_ms INTEGER NOT NULL,acknowledged_ms INTEGER,evidence TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,incident_id TEXT NOT NULL,rule TEXT NOT NULL,
          event TEXT NOT NULL,at_ms INTEGER NOT NULL,evidence TEXT NOT NULL);
        PRAGMA user_version=1;`);
      this.db = db; return db;
    } catch (error) { db.close(); throw error; }
  }
  settings(): AlertSettings {
    if (!this.db && (!this.directory || !existsSync(this.path))) return { ...defaultAlerts };
    const value = this.open().prepare("SELECT value FROM settings WHERE id=1").get()?.value;
    return value ? alertSettings.parse(JSON.parse(String(value))) : { ...defaultAlerts };
  }
  private event(id: string, rule: string, event: string, at: number, evidence: string) {
    this.open().prepare("INSERT INTO events(incident_id,rule,event,at_ms,evidence) VALUES(?,?,?,?,?)").run(id, rule, event, at, evidence);
  }
  configure(value: AlertSettings, now: number) {
    const settings = alertSettings.parse(value), db = this.open();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of db.prepare("SELECT id,rule FROM incidents").all()) this.event(String(r.id), String(r.rule), settings.enabled ? "reset" : "disabled", now, "Alert settings changed; previous incident closed.");
      db.exec("DELETE FROM incidents");
      db.prepare("INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));
      db.exec("COMMIT"); return settings;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  apply(facts: AlertFact[], pending: Map<AlertRule, number>, sustainMs: number, now: number) {
    const db = this.open(); db.exec("BEGIN IMMEDIATE");
    try {
      for (const f of facts) {
        const active = db.prepare("SELECT id FROM incidents WHERE rule=?").get(f.rule);
        if (f.triggered === null) { pending.delete(f.rule); continue; } // Unknown is not recovery.
        if (!f.triggered) {
          pending.delete(f.rule);
          if (active) { this.event(String(active.id), f.rule, "resolved", now, f.evidence); db.prepare("DELETE FROM incidents WHERE id=?").run(active.id); }
        } else if (active) {
          pending.delete(f.rule);
          db.prepare("UPDATE incidents SET last_seen_ms=?,evidence=? WHERE id=?").run(now, f.evidence, active.id);
        } else {
          if (!pending.has(f.rule)) pending.set(f.rule, now);
          if (now - pending.get(f.rule)! >= sustainMs) {
            const id = randomUUID();
            db.prepare("INSERT INTO incidents VALUES(?,?,?,?,NULL,?)").run(id, f.rule, now, now, f.evidence);
            this.event(id, f.rule, "opened", now, f.evidence); pending.delete(f.rule);
          }
        }
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  acknowledge(id: string, now: number) {
    const db = this.open(); db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM incidents WHERE id=?").get(id);
      if (!row) throw new Error("Incident is no longer active");
      if (row.acknowledged_ms === null) {
        db.prepare("UPDATE incidents SET acknowledged_ms=? WHERE id=?").run(now, id);
        this.event(id, String(row.rule), "acknowledged", now, "Operator acknowledged this incident; monitoring continues.");
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  snapshot(offset = 0) {
    if (!this.db && (!this.directory || !existsSync(this.path))) return { active: [], events: [], total: 0, offset: 0, limit: 20 };
    const db = this.open(), total = Number(db.prepare("SELECT count(*) AS n FROM events").get()!.n);
    offset = Math.min(offset, Math.max(0, Math.ceil(total / 20) - 1) * 20);
    return { active: db.prepare("SELECT * FROM incidents ORDER BY opened_ms DESC,id").all(),
      events: db.prepare("SELECT * FROM events ORDER BY seq DESC LIMIT 20 OFFSET ?").all(offset), total, offset, limit: 20 };
  }
  deliveryEvents(after: number, limit: number): EventBatch {
    if (!this.db && (!this.directory || !existsSync(this.path))) return { max: 0, events: [] };
    const db = this.open(), max = Number(db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM events").get()!.n);
    return { max, events: db.prepare("SELECT seq,incident_id,rule,event,at_ms,evidence FROM events WHERE seq>? ORDER BY seq LIMIT ?").all(after, Math.min(50, Math.max(0, limit))) as unknown as NotificationEventRow[] };
  }
  close() { this.db?.close(); this.db = undefined; }
}
