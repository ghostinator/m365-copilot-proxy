import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, openSync, closeSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { notificationDestination, notificationConfig, notificationRule, deliveryMessage, type NotificationDestination, type DeliveryMessage } from "./notification-schema.js";

export interface NotificationEventRow { seq: number; incident_id: string; rule: string; event: string; at_ms: number; evidence: string; model?: string }
export interface EventBatch { max: number; events: NotificationEventRow[] }
const queued = "status='queued'";

export class NotificationStore {
  private db?: DatabaseSync;
  readonly path: string;
  constructor(private directory?: string) { this.path = directory ? join(directory, "notifications.sqlite") : ":memory:"; }
  exists() { return !!this.db || !!this.directory && existsSync(this.path); }
  private open() {
    if (this.db) return this.db;
    if (this.directory) { mkdirSync(this.directory, { recursive: true, mode: 0o700 }); if (!existsSync(this.path)) closeSync(openSync(this.path, "wx", 0o600)); if (process.platform !== "win32") chmodSync(this.path, 0o600); }
    const db = new DatabaseSync(this.path);
    try {
      db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      if (Number(db.prepare("PRAGMA user_version").get()!.user_version) > 1) throw Error("Unsupported notification store");
      db.exec(`CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS destinations(id TEXT PRIMARY KEY,label TEXT NOT NULL,revision INTEGER NOT NULL,enabled INTEGER NOT NULL,
          deleted INTEGER NOT NULL,config TEXT NOT NULL,rules TEXT NOT NULL,events TEXT NOT NULL,start_seq INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,destination_id TEXT NOT NULL,revision INTEGER NOT NULL,event_seq INTEGER,
          incident_id TEXT,event TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,next_ms INTEGER NOT NULL,
          lease TEXT,lease_until INTEGER,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,error TEXT,
          UNIQUE(destination_id,revision,event_seq));
        CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(status,next_ms,created_ms);
        CREATE INDEX IF NOT EXISTS deliveries_recent ON deliveries(created_ms DESC,id);
        PRAGMA user_version=1;`);
      this.db = db; return db;
    } catch (error) { db.close(); throw error; }
  }
  private transaction<T>(run: (db: DatabaseSync) => T): T {
    const db = this.open(); db.exec("BEGIN IMMEDIATE");
    try { const result = run(db); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  cursor() { return this.exists() ? Number(this.open().prepare("SELECT cursor FROM metadata WHERE id=1").get()?.cursor ?? 0) : 0; }
  save(value: NotificationDestination, max: number, now: number, id: string = randomUUID()) {
    value = notificationDestination.parse(value);
    this.transaction(db => {
      const old = db.prepare("SELECT revision,deleted FROM destinations WHERE id=?").get(id);
      if (old?.deleted) throw Error("Removed destination IDs cannot be reused");
      if (!old && Number(db.prepare("SELECT count(*) AS n FROM destinations WHERE deleted=0").get()!.n) >= 20) throw Error("At most 20 destinations");
      db.prepare("INSERT OR IGNORE INTO metadata VALUES(1,?)").run(max);
      db.prepare(`INSERT INTO destinations VALUES(?,?,?,0,0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,
        revision=excluded.revision,enabled=0,deleted=0,config=excluded.config,rules=excluded.rules,events=excluded.events,start_seq=excluded.start_seq`)
        .run(id, value.label, Number(old?.revision ?? 0) + 1, JSON.stringify(value.config), JSON.stringify(value.rules), JSON.stringify(value.events), max);
      db.prepare(`UPDATE deliveries SET status='cancelled',error='destination_replaced',updated_ms=? WHERE destination_id=? AND ${queued}`).run(now, id);
    }); return id;
  }
  enable(id: string, enabled: boolean, max: number, now: number) {
    this.transaction(db => {
      const existing = db.prepare("SELECT enabled FROM destinations WHERE id=? AND deleted=0").get(id);
      if (!existing) throw Error("Destination missing");
      if (!!existing.enabled === enabled) return;
      db.prepare("UPDATE destinations SET enabled=?,revision=revision+1,start_seq=? WHERE id=?").run(Number(enabled), max, id);
      db.prepare(`UPDATE deliveries SET status='cancelled',error='destination_enablement_changed',updated_ms=? WHERE destination_id=? AND ${queued}`).run(now, id);
    });
  }
  remove(id: string, now: number) {
    this.transaction(db => {
      const changed = db.prepare("UPDATE destinations SET enabled=0,deleted=1,revision=revision+1,config='{}' WHERE id=? AND deleted=0").run(id);
      if (!changed.changes) throw Error("Destination missing");
      db.prepare(`UPDATE deliveries SET status='cancelled',error='destination_removed',updated_ms=? WHERE destination_id=? AND ${queued}`).run(now, id);
    });
  }
  private add(db: DatabaseSync, destination: Record<string, unknown>, event: NotificationEventRow | null, now: number) {
    const id = randomUUID(), message = event ? deliveryMessage(id, event.incident_id, event.rule, event.event, event.at_ms, event.evidence, event.model) : deliveryMessage(id, null, "test", "test", now);
    db.prepare("INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?,?,?,?,'queued',0,?,NULL,NULL,?,?,NULL)")
      .run(id, destination.id as string, Number(destination.revision), event?.seq ?? null, event?.incident_id ?? null, event?.event ?? "test", JSON.stringify(message), now, now, now);
  }
  ingest(batch: EventBatch, now: number) {
    this.transaction(db => {
      let cursor = Number(db.prepare("SELECT cursor FROM metadata WHERE id=1").get()?.cursor ?? 0);
      if (batch.max < cursor) throw Error("Alert event sequence regressed");
      const destinations = db.prepare("SELECT * FROM destinations WHERE enabled=1 AND deleted=0 LIMIT 20").all();
      for (const e of batch.events) {
        if (e.seq <= cursor) continue;
        if (["acknowledged", "reset", "disabled", "resolved"].includes(e.event)) db.prepare(`UPDATE deliveries SET status='cancelled',error='incident_closed_or_acknowledged',updated_ms=? WHERE incident_id=? AND event='opened' AND ${queued}`).run(now, e.incident_id);
        if (["opened", "resolved"].includes(e.event) && notificationRule.safeParse(e.rule).success) for (const d of destinations) {
          if (e.seq > Number(d.start_seq) && JSON.parse(String(d.rules)).includes(e.rule) && JSON.parse(String(d.events)).includes(e.event)) this.add(db, d, e, now);
        }
        cursor = e.seq;
      }
      db.prepare("INSERT INTO metadata VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cursor=MAX(cursor,excluded.cursor)").run(cursor);
    });
  }
  test(id: string, now: number) {
    this.transaction(db => {
      const d = db.prepare("SELECT * FROM destinations WHERE id=? AND enabled=1 AND deleted=0").get(id); if (!d) throw Error("Enable destination before testing");
      if (db.prepare("SELECT id FROM deliveries WHERE destination_id=? AND event='test' AND created_ms>? LIMIT 1").get(id, now - 60_000)) throw Error("Test cooldown active");
      this.add(db, d, null, now);
    });
  }
  preview(id: string, now: number) {
    const d = this.open().prepare("SELECT * FROM destinations WHERE id=? AND deleted=0").get(id); if (!d) throw Error("Destination missing");
    return { label: d.label, type: JSON.parse(String(d.config)).type, message: deliveryMessage("preview", null, "test", "test", now) };
  }
  claim(now: number) {
    return this.transaction(db => {
      db.prepare("UPDATE deliveries SET status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'queued' END,error='previous_attempt_interrupted',next_ms=? WHERE status='sending' AND lease_until<=?").run(now, now);
      for (let i = 0; i < 20; i++) {
        const row = db.prepare("SELECT * FROM deliveries WHERE status='queued' AND next_ms<=? ORDER BY created_ms,id LIMIT 1").get(now); if (!row) return null;
        const d = db.prepare("SELECT * FROM destinations WHERE id=? AND enabled=1 AND deleted=0 AND revision=?").get(row.destination_id, row.revision);
        if (!d) { db.prepare("UPDATE deliveries SET status='cancelled',error='destination_changed',updated_ms=? WHERE id=?").run(now, row.id); continue; }
        const config = notificationConfig.parse(JSON.parse(String(d.config))), lease = randomUUID();
        db.prepare("UPDATE deliveries SET status='sending',attempts=attempts+1,lease=?,lease_until=?,updated_ms=? WHERE id=?").run(lease, now + 60_000, now, row.id);
        return { id: String(row.id), lease, attempts: Number(row.attempts) + 1, config, message: JSON.parse(String(row.payload)) as DeliveryMessage };
      } return null;
    });
  }
  complete(id: string, lease: string, attempts: number, now: number, failure?: { category: string; retryable: boolean }) {
    const retry = !!failure?.retryable && attempts < 4, delay = [30_000, 120_000, 600_000][attempts - 1] ?? 600_000;
    this.open().prepare("UPDATE deliveries SET status=?,error=?,next_ms=?,updated_ms=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='sending'")
      .run(!failure ? "sent" : retry ? "queued" : "failed", failure?.category ?? null, now + (retry ? delay : 0), now, id, lease);
  }
  snapshot(offset = 0) {
    if (!this.exists()) return { destinations: [], deliveries: [], total: 0, offset: 0, limit: 20, counts: {} };
    const db = this.open(), total = Number(db.prepare("SELECT count(*) AS n FROM deliveries").get()!.n);
    offset = Math.min(offset, Math.max(0, Math.ceil(total / 20) - 1) * 20);
    return { destinations: db.prepare("SELECT id,label,revision,enabled,config,rules,events FROM destinations WHERE deleted=0 ORDER BY label,id LIMIT 20").all().map(d => {
      const c = notificationConfig.parse(JSON.parse(String(d.config)));
      return { id: d.id, label: d.label, revision: d.revision, enabled: !!d.enabled, type: c.type, format: c.type === "webhook" ? c.format : null,
        rules: JSON.parse(String(d.rules)), events: JSON.parse(String(d.events)), credentialConfigured: c.type === "smtp" ? !!c.user : (c.type === "webhook" || c.type === "ntfy") ? !!c.bearer : !!c.apiKey };
    }), deliveries: db.prepare(`SELECT j.id,d.label,j.event,j.status,j.attempts,j.next_ms,j.created_ms,j.updated_ms,j.error
      FROM deliveries j JOIN destinations d ON d.id=j.destination_id ORDER BY j.created_ms DESC,j.id LIMIT 20 OFFSET ?`).all(offset), total, offset, limit: 20,
      counts: Object.fromEntries(db.prepare("SELECT status,count(*) AS n FROM deliveries GROUP BY status").all().map(r => [String(r.status), Number(r.n)])) };
  }
  close() { this.db?.close(); this.db = undefined; }
}
