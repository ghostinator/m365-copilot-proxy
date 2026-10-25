import { randomBytes } from "node:crypto";
import { closeSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { HistoryBackups } from "./history-backups.js";
type OpenBackup = Awaited<ReturnType<HistoryBackups["openDownload"]>>;
/** One-use, short-lived capabilities hold a verified file descriptor, never a client path. */
export class BackupDownloads {
  private tickets = new Map<string, OpenBackup & { expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  private active = 0; private preparing = 0;
  async create(manager: HistoryBackups, id: string) {
    if (this.tickets.size + this.active + this.preparing >= 4) throw Error("At most four backup downloads can be pending or active");
    this.preparing++;
    try {
      const opened = await manager.openDownload(id), ticket = "b_" + randomBytes(32).toString("base64url"), expiresAt = Date.now() + 60_000;
      const timer = setTimeout(() => { this.tickets.delete(ticket); closeSync(opened.fd); }, 60_000); timer.unref();
      this.tickets.set(ticket, { ...opened, expiresAt, timer });
      return { url: "/v1/proxy/download/" + ticket, expiresAt: new Date(expiresAt).toISOString(), backup: opened.info };
    } finally { this.preparing--; }
  }
  consume(req: Request): Response {
    const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
    const missing = () => new Response("Backup download expired or unavailable", { status: 404, headers });
    if (req.method !== "GET" || req.headers.has("origin") && req.headers.get("origin") !== new URL(req.url).origin) return missing();
    const ticket = new URL(req.url).pathname.split("/").at(-1) ?? "", job = this.tickets.get(ticket);
    if (!job) return missing();
    this.tickets.delete(ticket); clearTimeout(job.timer);
    if (Date.now() >= job.expiresAt) { closeSync(job.fd); return missing(); }
    this.active++;
    let stream: ReturnType<typeof createReadStream>;
    try { stream = createReadStream("", { fd: job.fd, autoClose: true, start: 0, end: job.info.bytes - 1, highWaterMark: 64 * 1024 }); }
    catch { closeSync(job.fd); this.active--; return missing(); }
    const abort = () => stream.destroy(new Error("Backup download cancelled"));
    const timer = setTimeout(() => stream.destroy(new Error("Backup download timed out")), 600_000); timer.unref();
    stream.once("close", () => { clearTimeout(timer); this.active--; req.signal.removeEventListener("abort", abort); });
    req.signal.addEventListener("abort", abort, { once: true });
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    if (req.signal.aborted) abort();
    return new Response(body, { headers: { ...headers, "Content-Type": "application/vnd.sqlite3", "Content-Length": String(job.info.bytes),
      "Content-Disposition": `attachment; filename="${job.info.id}.sqlite"`, "X-Checksum-SHA256": job.info.sha256 } });
  }
}
export const backupDownloads = new BackupDownloads();
