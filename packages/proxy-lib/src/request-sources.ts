import { ActivityDatabase } from "./activity-database.js";
import { entry, activityQuery, sourceAddress, type SavedRequest, type ActivityQuery } from "./activity-schema.js";
import { createLogger } from "@m365-copilot/core";
import type { ActivityEvent } from "./http-activity.js";
export { sourceAddress, parseActivityQuery, type ActivityQuery } from "./activity-schema.js";
const log = createLogger("request-sources");

/** Batched durable activity. No automatic retention or system/request count limit. */
export class RequestSources {
  private database: ActivityDatabase | undefined;
  private pending: SavedRequest[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private savedAt: string | null = null;
  private error: string | null = null;
  private closed = false;
  private notSaved = 0;
  constructor(private directory?: string) {}
  private open() {
    if (!this.database) this.database = new ActivityDatabase(this.directory);
    return this.database;
  }
  record(event: ActivityEvent) {
    if (this.closed) return;
    const parsed = entry.safeParse({ ...event, address: sourceAddress(event.clientAddress) });
    if (!parsed.success) return;
    if (this.pending.length >= 10000) { this.notSaved++; this.error = "Activity database is unavailable; unsaved activity exceeded the memory buffer."; return; }
    this.pending.push(parsed.data);
    if (!this.directory || this.pending.length >= 100) this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 500); this.timer.unref();
    }
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending.length || this.closed) return;
    try {
      this.open().write(this.pending); this.pending = [];
      this.savedAt = new Date().toISOString(); this.error = null;
    } catch {
      this.error = "Activity history could not be saved. Check data-directory permissions and disk space.";
      log.error(this.error);
    }
  }
  saveModelCheck(model: string, status: number, identity: string, durationMs: number, servedModel: string | null = null, kind = "identity", verdict = "unknown", evidence = "", turns = 1) {
    try { this.open().saveModelCheck(model, status, identity, durationMs, servedModel, kind, verdict, evidence, turns); }
    catch { this.error = "Model check result could not be saved."; }
  }
  snapshot(options: Partial<ActivityQuery> = {}, now = Date.now()) {
    const query = activityQuery.parse(options);
    this.flush();
    const status = { persistent: !!this.directory, savedAt: this.savedAt, pendingSave: !!this.pending.length, unsavedRecords: this.pending.length, lostRecords: this.notSaved, error: this.error };
    try {
      const database = this.open();
      return { ...database.snapshot(query, now), ...status, error: this.error ?? database.migrationWarning };
    } catch {
      return { ...status, error: this.error ?? "Activity database could not be opened or read.", errorGroups: [], keyActivity: [], errors: [], errorHistory: { total: 0, offset: 0, limit: query.errorLimit }, startedAt: null, systems: [], recent: [], labels: {}, modelActivity: [], modelChecks: [], range: query.range, from: null, to: new Date(now).toISOString(), summary: { total: 0, applicationRequests: 0, selfChecks: 0, chats: 0, models: 0, health: 0, other: 0, failed: 0, cancelled: 0, responseBytes: 0, systems: 0, averageDurationMs: null }, history: { total: 0, limit: query.limit, offset: 0 }, legacyUndated: 0, storage: { engine: "SQLite", retention: "unlimited", totalBytes: 0, databaseBytes: 0, walBytes: 0, sharedMemoryBytes: 0, storedRecords: 0, averageBytesPerRecord: null } };
    }
  }
  close() { this.flush(); this.closed = true; this.database?.close(); this.database = undefined; }
}
