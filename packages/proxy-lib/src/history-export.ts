import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import type { ActivityQuery } from "./activity-schema.js";
import { requestSelection, withRequestDetails, requestColumns, decodeRequest } from "./activity-records.js";
import { diagnosticText } from "./error-diagnostics.js";

export type ExportFormat = "json" | "csv";
const csvFields = ["id", "address", "receivedAt", "method", "endpoint", "source", "status", "applicationStatus", "outcome", "model", "servedModel", "apiKeyId", "apiKeyLabel", "clientSoftware", "streamed", "durationMs", "responseBytes", "firstByteMs", "queueMs", "upstreamAttempts", "upstreamFailures", "diagnosticType", "diagnosticCode", "diagnosticMessage", "diagnosticStack", "timeline"];
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  // Quoting alone does not stop spreadsheet formula interpretation.
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function redactRecord(row: ReturnType<typeof decodeRequest>) {
  const safe = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? diagnosticText(value, 32_000) : value]));
  const diagnostic = row.diagnostic ? Object.fromEntries(["type", "code", "message", "stack", "phase"].filter(key => typeof row.diagnostic[key] === "string").map(key => [key, diagnosticText(row.diagnostic[key], 32_000)])) : null;
  const timeline = (row.timeline as { atMs: number; phase: string; model?: string }[]).map(point => ({ atMs: point.atMs, phase: diagnosticText(point.phase, 40), ...(point.model ? { model: diagnosticText(point.model, 100) } : {}) }));
  return { ...safe, diagnostic, timeline };
}

/** Append-only sequence boundary: no long transaction, OFFSET scan, or unbounded in-memory array. */
export class HistoryCursor {
  readonly snapshot: { at: string; maxSequence: number; records: number };
  private database: DatabaseSync;
  private ownsConnection: boolean;
  private selection;
  private last = 0;
  private rows: Record<string, unknown>[] = [];
  private closed = false;
  constructor(database: DatabaseSync, path: string, readonly query: ActivityQuery, now = Date.now()) {
    this.ownsConnection = path !== ":memory:";
    this.database = this.ownsConnection ? new DatabaseSync(path, { readOnly: true }) : database;
    try {
      this.selection = requestSelection(query, now);
      const maxSequence = Number(this.database.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM requests").get()!.n);
      const records = Number(this.database.prepare(`SELECT COUNT(*) AS n ${this.selection.from}${this.selection.conditions.length ? " AND " : " WHERE "}r.seq<=?`).get(...this.selection.bindings, maxSequence)!.n);
      this.snapshot = { at: new Date(now).toISOString(), maxSequence, records };
    } catch (error) { if (this.ownsConnection) this.database.close(); throw error; }
  }
  async next() {
    if (this.closed) return null;
    if (!this.rows.length) {
      await setImmediate(); // Let chat admission and writes progress between small read batches.
      if (this.closed) return null;
      this.rows = this.database.prepare(`SELECT ${requestColumns} ${withRequestDetails(this.selection.from)}${this.selection.conditions.length ? " AND " : " WHERE "}r.seq>? AND r.seq<=? ORDER BY r.seq LIMIT 50`).all(...this.selection.bindings, this.last, this.snapshot.maxSequence);
    }
    const row = this.rows.shift();
    if (!row) return null;
    this.last = Number(row.seq);
    return redactRecord(decodeRequest(row));
  }
  close() { if (this.closed) return; this.closed = true; this.rows = []; if (this.ownsConnection) this.database.close(); }
}

export class HistoryDownloads {
  private tickets = new Map<string, { cursor: HistoryCursor; format: ExportFormat; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  private active = 0;
  create(cursor: HistoryCursor, format: ExportFormat) {
    if (this.tickets.size + this.active >= 4) { cursor.close(); throw new Error("At most four history downloads can be pending or active."); }
    const ticket = randomBytes(32).toString("base64url"), expiresAt = Date.now() + 60_000;
    const timer = setTimeout(() => { this.tickets.delete(ticket); cursor.close(); }, 60_000); timer.unref();
    this.tickets.set(ticket, { cursor, format, expiresAt, timer });
    return { url: "/v1/proxy/download/" + ticket, expiresAt: new Date(expiresAt).toISOString(), snapshot: cursor.snapshot };
  }
  consume(req: Request): Response {
    const ticket = new URL(req.url).pathname.split("/").at(-1) ?? "";
    if (req.method !== "GET" || req.headers.has("origin") && req.headers.get("origin") !== new URL(req.url).origin) return new Response("Download unavailable", { status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    const job = this.tickets.get(ticket);
    if (job && Date.now() >= job.expiresAt) { this.tickets.delete(ticket); clearTimeout(job.timer); job.cursor.close(); return new Response("Download expired", { status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
    if (!job) return new Response("Download expired or already used", { status: 404, headers: { "Cache-Control": "no-store" } });
    this.tickets.delete(ticket); clearTimeout(job.timer); this.active++;
    const { cursor, format } = job, encoder = new TextEncoder();
    let started = false, count = 0, finished = false, timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { if (finished) return; finished = true; clearTimeout(timer); cursor.close(); this.active--; req.signal.removeEventListener("abort", abort); };
    let fail: (reason: Error) => void;
    const abort = () => fail(new Error("History download cancelled"));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        fail = reason => { if (finished) return; cleanup(); controller.error(reason); };
        timer = setTimeout(() => fail(new Error("History download exceeded ten minutes")), 600_000); timer.unref();
        req.signal.addEventListener("abort", abort, { once: true });
        if (req.signal.aborted) abort();
      },
      async pull(controller) {
        try {
          if (finished) return;
          if (!started) {
            started = true;
            controller.enqueue(encoder.encode(format === "csv" ? "\ufeff" + csvFields.join(",") + "\r\n" : JSON.stringify({ format: "m365-proxy-history-v1", snapshot: cursor.snapshot, filters: cursor.query, notice: "Completed saved requests only; IP addresses and labels included. Review before sharing." }).slice(0, -1) + ',"records":['));
            return;
          }
          const row = await cursor.next();
          if (finished) return;
          if (!row) {
            if (count !== cursor.snapshot.records) throw new Error("History changed during export");
            if (format === "json") controller.enqueue(encoder.encode("]}\n"));
            cleanup(); controller.close(); return;
          }
          const flat = { ...row, diagnosticType: row.diagnostic?.type, diagnosticCode: row.diagnostic?.code, diagnosticMessage: row.diagnostic?.message, diagnosticStack: row.diagnostic?.stack, timeline: JSON.stringify(row.timeline) } as Record<string, unknown>;
          controller.enqueue(encoder.encode(format === "json" ? (count ? "," : "") + JSON.stringify(row) : csvFields.map(field => csvCell(flat[field])).join(",") + "\r\n"));
          count++;
        } catch { fail(new Error("History download failed; retry the export")); }
      },
      cancel() { cleanup(); },
    });
    return new Response(body, { headers: { "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="m365-history-${cursor.snapshot.at.replace(/[:.]/g, "-")}.${format}"`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  }
}
export const historyDownloads = new HistoryDownloads();
