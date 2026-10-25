import { activityInsights, modelCheckHistory } from "./activity-insights.js";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { entry, legacySchema, sourceAddress, type SavedRequest, type ActivityQuery } from "./activity-schema.js";

const hour = 3_600_000;
const windows = { "24h": 24 * hour, "7d": 7 * 24 * hour, "30d": 30 * 24 * hour, "90d": 90 * 24 * hour, "365d": 365 * 24 * hour };
const methods = entry.shape.method.options, endpoints = entry.shape.endpoint.options;
const outcomes = ["success", "error", "cancelled"] as const;
const counters = ["total", "applicationRequests", "selfChecks", "chats", "models", "health", "other", "failed", "cancelled", "responseBytes", "durationSum", "durationSamples"];
const fields = [...counters, "firstSeen", "lastSeen"];
const uuidBytes = (id: string) => Buffer.from(id.replaceAll("-", ""), "hex");
const uuidText = (id: Uint8Array) => Buffer.from(id).toString("hex").replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/, "$1-$2-$3-$4-$5");
type Bind = string | number | Uint8Array | null;
const empty = () => Object.fromEntries(fields.map(field => [field, 0])) as Record<string, number>;
function metrics(request: SavedRequest) {
  const value = empty(), at = Date.parse(request.receivedAt);
  value.total = 1; value.applicationRequests = Number(request.source === "application"); value.selfChecks = Number(request.source === "self-check");
  const kind = (request.endpoint === "/v1/chat/completions" || request.endpoint === "/v1/proxy/model-check") ? "chats" : request.endpoint === "/v1/models" ? "models" : request.endpoint.startsWith("/health") ? "health" : "other";
  value[kind] = 1; value.failed = Number(request.outcome === "error"); value.cancelled = Number(request.outcome === "cancelled");
  value.responseBytes = request.responseBytes; value.durationSum = request.durationMs; value.durationSamples = 1;
  value.firstSeen = at; value.lastSeen = at;
  return value;
}

/** Normalized append-only requests plus transactional hourly and all-time rollups. */
export class ActivityDatabase {
  readonly db: DatabaseSync;
  readonly path: string;
  migrationWarning: string | null = null;
  private statements = new Map<string, StatementSync>();
  private labels = new Map<string, string>();
  private local = new Set(["127.0.0.1", "::1"]);
  constructor(private directory?: string) {
    this.path = directory ? join(directory, "activity.sqlite") : ":memory:";
    if (directory) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!existsSync(this.path)) closeSync(openSync(this.path, "wx", 0o600));
      if (process.platform !== "win32") chmodSync(this.path, 0o600);
    }
    this.db = new DatabaseSync(this.path);
    try {
      this.db.exec("PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;");
      const version = Number(this.statement("PRAGMA user_version").get()!.user_version);
      if (version > 4) throw new Error("Unsupported activity database version");
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1000;
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS systems(id INTEGER PRIMARY KEY, address TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS requests(seq INTEGER PRIMARY KEY, request_id BLOB NOT NULL UNIQUE, received_ms INTEGER NOT NULL,
          system_id INTEGER NOT NULL REFERENCES systems(id), method INTEGER NOT NULL, endpoint INTEGER NOT NULL,
          self_check INTEGER NOT NULL, status INTEGER NOT NULL, outcome INTEGER NOT NULL, bytes INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
          model TEXT NOT NULL, servedModel TEXT NOT NULL, clientSoftware TEXT NOT NULL, streamed INTEGER, application_status INTEGER);
        CREATE INDEX IF NOT EXISTS requests_time ON requests(received_ms DESC, seq DESC);
        CREATE INDEX IF NOT EXISTS requests_system_time ON requests(system_id, received_ms DESC, seq DESC);
        CREATE INDEX IF NOT EXISTS requests_model_time ON requests(model, received_ms DESC, seq DESC);
        ${["hourly", "system_totals", "legacy_totals"].map(table => `CREATE TABLE IF NOT EXISTS ${table}(
          ${table === "hourly" ? "hour_ms INTEGER NOT NULL," : ""} system_id INTEGER NOT NULL REFERENCES systems(id),
          model TEXT NOT NULL, servedModel TEXT NOT NULL, clientSoftware TEXT NOT NULL,
          ${fields.map(field => `${field} INTEGER NOT NULL`).join(",")}, PRIMARY KEY(${table === "hourly" ? "hour_ms," : ""}system_id,model,servedModel,clientSoftware)) WITHOUT ROWID;`).join("\n")}
        CREATE TABLE IF NOT EXISTS model_checks(seq INTEGER PRIMARY KEY, model TEXT NOT NULL, checked_ms INTEGER NOT NULL, status INTEGER NOT NULL, identity TEXT NOT NULL, duration_ms INTEGER NOT NULL, served_model TEXT);
        CREATE INDEX IF NOT EXISTS model_checks_latest ON model_checks(model,seq DESC);
        CREATE TABLE IF NOT EXISTS request_errors(request_id BLOB PRIMARY KEY REFERENCES requests(request_id), detail TEXT NOT NULL) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS requests_errors_time ON requests(received_ms DESC,seq DESC) WHERE outcome<>0;
        `);
      if (version < 3) this.db.exec("BEGIN IMMEDIATE; ALTER TABLE model_checks ADD COLUMN kind TEXT NOT NULL DEFAULT 'identity'; ALTER TABLE model_checks ADD COLUMN verdict TEXT NOT NULL DEFAULT 'unknown'; ALTER TABLE model_checks ADD COLUMN evidence TEXT NOT NULL DEFAULT ''; ALTER TABLE model_checks ADD COLUMN turns INTEGER NOT NULL DEFAULT 1; CREATE INDEX model_checks_kind_latest ON model_checks(model,kind,seq DESC); PRAGMA user_version=3; COMMIT;");
      if (version < 4) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE request_timings(request_id BLOB PRIMARY KEY REFERENCES requests(request_id),
          first_byte_ms INTEGER,queue_ms INTEGER,attempts INTEGER NOT NULL,failures INTEGER NOT NULL,
          timeline TEXT NOT NULL,truncated INTEGER NOT NULL) WITHOUT ROWID;
        PRAGMA user_version=4; COMMIT;`);
      this.statement("INSERT OR IGNORE INTO metadata VALUES('startedAt',?)").run(new Date().toISOString());
      for (const interfaces of Object.values(networkInterfaces())) for (const iface of interfaces ?? []) this.local.add(sourceAddress(iface.address));
      if (directory) {
        try {
          const config = JSON.parse(readFileSync(join(directory, "server.json"), "utf8"));
          for (const [address, label] of Object.entries(config.sourceLabels ?? {})) {
            if (sourceAddress(address) === address && typeof label === "string" && label.length > 0 && label.length <= 100) this.labels.set(address, label);
          }
        } catch { /* Labels are optional; never interpret request headers as labels. */ }
        this.migrate();
      }
    } catch (error) { this.db.close(); throw error; }
  }
  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }
  private system(address: string) {
    this.statement("INSERT OR IGNORE INTO systems(address) VALUES(?)").run(address);
    return Number(this.statement("SELECT id FROM systems WHERE address=?").get(address)!.id);
  }
  private add(table: string, id: number, values: Record<string, number>, bucket?: number, request?: SavedRequest) {
    const keys = [...(bucket === undefined ? [] : ["hour_ms"]), "system_id", "model", "servedModel", "clientSoftware", ...fields];
    this.statement(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})
      ON CONFLICT(${bucket === undefined ? "" : "hour_ms,"}system_id,model,servedModel,clientSoftware) DO UPDATE SET
      ${counters.map(field => `${field}=${table}.${field}+excluded.${field}`).join(",")},
      firstSeen=MIN(${table}.firstSeen,excluded.firstSeen),lastSeen=MAX(${table}.lastSeen,excluded.lastSeen)`)
      .run(...(bucket === undefined ? [] : [bucket]), id, request?.model ?? "", request?.servedModel ?? "", request?.clientSoftware ?? "unknown", ...fields.map(field => values[field]));
  }
  private insert(request: SavedRequest) {
    const id = this.system(request.address), at = Date.parse(request.receivedAt);
    const result = this.statement("INSERT OR IGNORE INTO requests(request_id,received_ms,system_id,method,endpoint,self_check,status,outcome,bytes,duration_ms,model,servedModel,clientSoftware,streamed,application_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(uuidBytes(request.id), at, id, methods.indexOf(request.method), endpoints.indexOf(request.endpoint), Number(request.source === "self-check"), request.status, outcomes.indexOf(request.outcome), request.responseBytes, request.durationMs, request.model ?? "", request.servedModel ?? "", request.clientSoftware, request.streamed === null ? null : Number(request.streamed), request.applicationStatus);
    if (!Number(result.changes)) return;
    this.statement("INSERT INTO request_timings VALUES(?,?,?,?,?,?,?)").run(uuidBytes(request.id), request.firstByteMs, request.queueMs, request.upstreamAttempts, request.upstreamFailures, JSON.stringify(request.timeline), Number(request.timelineTruncated));
    if (request.outcome !== "success") this.statement("INSERT INTO request_errors(request_id,detail) VALUES(?,?)").run(uuidBytes(request.id), JSON.stringify({ diagnostic: request.diagnostic, firstByteMs: request.firstByteMs, queueMs: request.queueMs, upstreamAttempts: request.upstreamAttempts, upstreamFailures: request.upstreamFailures }));
    const value = metrics(request);
    this.add("hourly", id, value, Math.floor(at / hour) * hour, request); this.add("system_totals", id, value, undefined, request);
  }
  write(requests: SavedRequest[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try { for (const request of requests) this.insert(request); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private migrate() {
    if (this.statement("SELECT value FROM metadata WHERE key='legacyMigrated'").get()) return;
    const path = join(this.directory!, "request-sources.json");
    try {
      const legacy = existsSync(path) ? (() => {
        if (statSync(path).size > 2 * 1024 * 1024) throw new Error("Oversized legacy source history");
        return legacySchema.parse(JSON.parse(readFileSync(path, "utf8")));
      })() : null;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        if (legacy) {
          for (const request of legacy.recent) this.insert(request);
          for (const system of legacy.systems) {
            const value = empty();
            const included = legacy.recent.filter(request => request.address === system.address).map(metrics);
            for (const field of counters) value[field] = Math.max(0, Number(system[field as keyof typeof system] ?? 0) - included.reduce((sum, item) => sum + item[field], 0));
            value.durationSum = 0; value.durationSamples = 0;
            value.firstSeen = Date.parse(system.firstSeen); value.lastSeen = Date.parse(system.lastSeen);
            if (value.total) this.add("legacy_totals", this.system(system.address), value);
          }
          this.statement("UPDATE metadata SET value=? WHERE key='startedAt'").run(legacy.startedAt);
        }
        this.statement("INSERT INTO metadata VALUES('legacyMigrated','1')").run(); this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    } catch { this.migrationWarning = "Legacy source history could not be migrated. The original JSON file is preserved."; }
  }
  private aggregate(query: ActivityQuery, now: number, byModel = false) {
    const sum = counters.map(field => `SUM(${field}) AS ${field}`).join(",");
    const dimensions = `system_id${byModel ? ",model,servedModel,clientSoftware" : ""}`;
    const conditions = [...(query.model ? ["model=?"] : []), ...(query.address ? ["system_id=(SELECT id FROM systems WHERE address=?)"] : [])];
    const filterBindings: Bind[] = [...(query.model ? [query.model] : []), ...(query.address ? [query.address] : [])];
    const grouped = `SELECT ${dimensions},${sum},MIN(firstSeen) AS firstSeen,MAX(lastSeen) AS lastSeen FROM parts${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} GROUP BY ${dimensions}`;
    if (query.range === "all") return { sql: `WITH parts AS(SELECT * FROM system_totals UNION ALL SELECT * FROM legacy_totals), grouped AS(${grouped})`, bindings: filterBindings, since: null };
    const since = now - windows[query.range], low = Math.ceil(since / hour) * hour, high = Math.floor(now / hour) * hour;
    const raw = `SELECT system_id,model,servedModel,clientSoftware,COUNT(*) AS total,SUM(self_check=0) AS applicationRequests,SUM(self_check=1) AS selfChecks,
      SUM(endpoint IN(${endpoints.indexOf("/v1/chat/completions")},${endpoints.indexOf("/v1/proxy/model-check")})) AS chats,SUM(endpoint=${endpoints.indexOf("/v1/models")}) AS models,
      SUM(endpoint IN(${["/health", "/health/live", "/health/ready"].map(path => endpoints.indexOf(path as typeof endpoints[number])).join(",")})) AS health,
      SUM(endpoint IN(${["/v1/responses", "/v1/messages", "/messages", "(other endpoint)"].map(path => endpoints.indexOf(path as typeof endpoints[number])).join(",")})) AS other,
      SUM(outcome=1) AS failed,SUM(outcome=2) AS cancelled,SUM(bytes) AS responseBytes,SUM(duration_ms) AS durationSum,COUNT(*) AS durationSamples,
      MIN(received_ms) AS firstSeen,MAX(received_ms) AS lastSeen FROM requests WHERE (received_ms>=? AND received_ms<?) OR (received_ms>=? AND received_ms<=?) GROUP BY system_id,model,servedModel,clientSoftware`;
    return { sql: `WITH parts AS(SELECT system_id,model,servedModel,clientSoftware,${fields.join(",")} FROM hourly WHERE hour_ms>=? AND hour_ms<? UNION ALL ${raw}), grouped AS(${grouped})`, bindings: [low, high, since, low, high, now, ...filterBindings] as Bind[], since };
  }
  snapshot(query: ActivityQuery, now = Date.now()) {
    const aggregate = this.aggregate(query, now);
    const summary = this.statement(`${aggregate.sql} SELECT ${counters.map(field => `COALESCE(SUM(${field}),0) AS ${field}`).join(",")},COUNT(*) AS systems,MIN(firstSeen) AS firstSeen,MAX(lastSeen) AS lastSeen FROM grouped`).get(...aggregate.bindings)!;
    const systems = this.statement(`${aggregate.sql} SELECT systems.address,grouped.* FROM grouped JOIN systems ON systems.id=grouped.system_id ORDER BY applicationRequests DESC,lastSeen DESC LIMIT 50`).all(...aggregate.bindings).map(row => ({ ...row, firstSeen: new Date(Number(row.firstSeen)).toISOString(), lastSeen: new Date(Number(row.lastSeen)).toISOString(), label: this.labels.get(String(row.address)) ?? null, isThisDevice: this.local.has(String(row.address)) }));
    const modelAggregate = this.aggregate(query, now, true);
    const modelActivity = this.statement(`${modelAggregate.sql} SELECT s.address,g.model,g.servedModel,g.clientSoftware,g.total,g.applicationRequests,g.chats,g.failed,g.cancelled,g.responseBytes,g.lastSeen FROM grouped g JOIN systems s ON s.id=g.system_id WHERE g.model<>'' ORDER BY g.applicationRequests DESC,g.lastSeen DESC LIMIT 50`).all(...modelAggregate.bindings);
    const filters: string[] = [], bindings: Bind[] = [];
    if (aggregate.since !== null) { filters.push("r.received_ms>=? AND r.received_ms<=?"); bindings.push(aggregate.since, now); }
    if (query.address) { filters.push("s.address=?"); bindings.push(query.address); }
    if (query.model) { filters.push("r.model=?"); bindings.push(query.model); }
    const from = `FROM requests r JOIN systems s ON r.system_id=s.id${filters.length ? " WHERE " + filters.join(" AND ") : ""}`;
    const legacyUndated = Number(this.statement("SELECT COALESCE(SUM(total),0) AS count FROM legacy_totals").get()!.count);
    const totalRecords = query.address ? Number(this.statement(`SELECT COUNT(*) AS count ${from}`).get(...bindings)!.count) : Number(summary.total) - (query.range === "all" && !query.model ? legacyUndated : 0);
    const offset = Math.min(query.offset, Math.max(0, Math.ceil(totalRecords / query.limit) - 1) * query.limit);
    const recent = this.statement(`SELECT r.*,s.address,t.first_byte_ms,t.queue_ms,t.attempts,t.failures,t.timeline,t.truncated,d.detail ${from.replace("JOIN systems s ON r.system_id=s.id", "JOIN systems s ON r.system_id=s.id LEFT JOIN request_timings t ON t.request_id=r.request_id LEFT JOIN request_errors d ON d.request_id=r.request_id")} ORDER BY received_ms DESC,seq DESC LIMIT ? OFFSET ?`).all(...bindings, query.limit, offset).map(row => ({ id: uuidText(row.request_id as Uint8Array), address: String(row.address), receivedAt: new Date(Number(row.received_ms)).toISOString(), method: methods[Number(row.method)], endpoint: endpoints[Number(row.endpoint)], source: Number(row.self_check) ? "self-check" : "application", status: Number(row.status), outcome: outcomes[Number(row.outcome)], responseBytes: Number(row.bytes), durationMs: Number(row.duration_ms), model: row.model || null, servedModel: row.servedModel || null, clientSoftware: String(row.clientSoftware), streamed: row.streamed === null ? null : !!row.streamed, applicationStatus: row.application_status, firstByteMs: row.first_byte_ms ?? null, queueMs: row.queue_ms ?? null, upstreamAttempts: row.attempts ?? null, upstreamFailures: row.failures ?? null, timeline: row.timeline ? JSON.parse(String(row.timeline)) : [], timelineTruncated: !!row.truncated, timingRecorded: row.timeline !== null, diagnostic: row.detail ? JSON.parse(String(row.detail)).diagnostic ?? null : null }));
    const errorFrom = from + (filters.length ? " AND " : " WHERE ") + "r.outcome<>0";
    const errorTotal = Number(this.statement(`SELECT COUNT(*) AS count ${errorFrom}`).get(...bindings)!.count);
    const errorOffset = Math.min(query.errorOffset, Math.max(0, Math.ceil(errorTotal / query.errorLimit) - 1) * query.errorLimit);
    const errors = this.statement(`SELECT r.*,s.address,d.detail ${errorFrom.replace("JOIN systems s ON r.system_id=s.id", "JOIN systems s ON r.system_id=s.id LEFT JOIN request_errors d ON d.request_id=r.request_id")} ORDER BY r.received_ms DESC,r.seq DESC LIMIT ? OFFSET ?`).all(...bindings,query.errorLimit,errorOffset).map(row => ({ id: uuidText(row.request_id as Uint8Array), address: String(row.address), receivedAt: new Date(Number(row.received_ms)).toISOString(), method: methods[Number(row.method)], endpoint: endpoints[Number(row.endpoint)], source: Number(row.self_check) ? "self-check" : "application", status: Number(row.status), applicationStatus: row.application_status, outcome: outcomes[Number(row.outcome)], model: row.model || null, servedModel: row.servedModel || null, clientSoftware: String(row.clientSoftware), streamed: row.streamed === null ? null : !!row.streamed, responseBytes: Number(row.bytes), durationMs: Number(row.duration_ms), ...(row.detail ? JSON.parse(String(row.detail)) : { diagnostic: null }) }));
    const labels = Object.fromEntries(this.labels);
    for (const address of this.local) if (!labels[address]) labels[address] = "This device";
    const storedRecords = Number(this.statement("SELECT COALESCE(SUM(total),0) AS count FROM system_totals").get()!.count);
    const bytes = (suffix: string) => { try { return statSync(this.path + suffix).size; } catch { return 0; } };
    const databaseBytes = this.directory ? bytes("") : 0, walBytes = this.directory ? bytes("-wal") : 0, sharedMemoryBytes = this.directory ? bytes("-shm") : 0;
    return { performance: activityInsights(this.db, query, now), checkHistory: modelCheckHistory(this.db, query, now), errors, errorHistory: { total: errorTotal, offset: errorOffset, limit: query.errorLimit }, startedAt: String(this.statement("SELECT value FROM metadata WHERE key='startedAt'").get()!.value), systems, recent, labels, modelActivity, modelChecks: this.statement("SELECT model,kind,verdict,evidence,turns,checked_ms AS checkedAt,status,identity,served_model AS servedModel,duration_ms AS durationMs FROM model_checks WHERE seq IN(SELECT MAX(seq) FROM model_checks GROUP BY model,kind) ORDER BY checked_ms DESC").all(), range: query.range, from: aggregate.since === null ? null : new Date(aggregate.since).toISOString(), to: new Date(now).toISOString(), summary: { ...summary, averageDurationMs: Number(summary.durationSamples) ? Number(summary.durationSum) / Number(summary.durationSamples) : null }, history: { total: totalRecords, limit: query.limit, offset }, legacyUndated, storage: { engine: "SQLite", retention: "unlimited", databaseBytes, walBytes, sharedMemoryBytes, totalBytes: databaseBytes + walBytes + sharedMemoryBytes, storedRecords, averageBytesPerRecord: storedRecords ? Math.round((databaseBytes + walBytes) / storedRecords) : null } };
  }
  saveModelCheck(model: string, status: number, identity: string, durationMs: number, servedModel: string | null = null, kind = "identity", verdict = "unknown", evidence = "", turns = 1) {
    this.statement("INSERT INTO model_checks(model,checked_ms,status,identity,duration_ms,served_model,kind,verdict,evidence,turns) VALUES(?,?,?,?,?,?,?,?,?,?)").run(model, Date.now(), status, identity.slice(0, 1000), durationMs, servedModel, kind, verdict, evidence.slice(0,2000), turns);
  }
  close() { this.db.close(); }
}
