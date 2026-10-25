import { isIP } from "node:net";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { atomicWritePrivate, createLogger } from "@m365-copilot/core";
import type { ActivityEvent } from "./http-activity.js";

/** Only transport metadata belongs here: never forwarded/client headers. */
export function sourceAddress(value?: string): string {
  if (!value || value.length > 100) return "unknown";
  const address = value.split("%")[0];
  if (!isIP(address)) return "unknown";
  if (isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
const count = z.number().int().nonnegative().safe();
const timestamp = z.iso.datetime();
const address = z.string().max(100).refine(value => sourceAddress(value) === value);
const summary = z.object({ address, firstSeen: timestamp, lastSeen: timestamp, total: count, applicationRequests: count, selfChecks: count, chats: count, models: count, health: count, other: count, failed: count, cancelled: count, responseBytes: count });
const entry = z.object({ id: z.uuid(), address, receivedAt: timestamp, method: z.enum(["GET", "POST", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE", "OTHER"]), endpoint: z.enum(["/v1/models", "/v1/chat/completions", "/health", "/health/live", "/health/ready", "/v1/responses", "/v1/messages", "/messages", "(other endpoint)"]), source: z.enum(["application", "self-check"]), status: z.number().int().min(100).max(599), outcome: z.enum(["success", "error", "cancelled"]), responseBytes: count, durationMs: count });
const schema = z.object({ version: z.literal(1), startedAt: timestamp, systems: z.array(summary).max(512), recent: z.array(entry).max(500) });
type State = z.infer<typeof schema>;
const log = createLogger("request-sources");
const retentionMs = 30 * 24 * 60 * 60_000;

/** Bounded saved totals for retained systems and recent completed requests. */
export class RequestSources {
  private loaded = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private state: State = { version: 1, startedAt: new Date().toISOString(), systems: [], recent: [] };
  private savedAt: string | null = null;
  private error: string | null = null;
  constructor(private directory?: string) {}
  private load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.directory) return;
    try {
      const path = join(this.directory, "request-sources.json"), stat = statSync(path);
      if (stat.size > 2 * 1024 * 1024) throw new Error("Oversized source history");
      const state = schema.parse(JSON.parse(readFileSync(path, "utf8")));
      if (new Set(state.systems.map(system => system.address)).size !== state.systems.length) throw new Error("Duplicate systems");
      this.state = state; this.savedAt = stat.mtime.toISOString();
    } catch (error: any) {
      if (error.code !== "ENOENT") this.error = "Saved source history could not be loaded; collecting new observations.";
    }
  }
  private prune(now: number) {
    const fresh = (at: string) => Date.parse(at) > now - retentionMs && Date.parse(at) <= now + 60_000;
    this.state.systems = this.state.systems.filter(system => fresh(system.lastSeen));
    this.state.recent = this.state.recent.filter(event => fresh(event.receivedAt));
  }
  record(event: ActivityEvent) {
    this.load(); this.prune(Date.now());
    const parsed = entry.safeParse({ ...event, address: sourceAddress(event.clientAddress) });
    if (!parsed.success) return;
    const request = parsed.data;
    let system = this.state.systems.find(system => system.address === request.address);
    if (!system) {
      if (this.state.systems.length >= 512) {
        this.state.systems.sort((a, b) => a.lastSeen.localeCompare(b.lastSeen)); this.state.systems.shift();
      }
      system = { address: request.address, firstSeen: request.receivedAt, lastSeen: request.receivedAt, total: 0, applicationRequests: 0, selfChecks: 0, chats: 0, models: 0, health: 0, other: 0, failed: 0, cancelled: 0, responseBytes: 0 };
      this.state.systems.push(system);
    }
    system.total++; system[request.source === "self-check" ? "selfChecks" : "applicationRequests"]++;
    const kind = request.endpoint === "/v1/chat/completions" ? "chats" : request.endpoint === "/v1/models" ? "models" : request.endpoint.startsWith("/health") ? "health" : "other";
    system[kind]++;
    if (request.outcome === "error") system.failed++;
    if (request.outcome === "cancelled") system.cancelled++;
    system.responseBytes += request.responseBytes;
    system.firstSeen = system.firstSeen < request.receivedAt ? system.firstSeen : request.receivedAt;
    system.lastSeen = system.lastSeen > request.receivedAt ? system.lastSeen : request.receivedAt;
    this.state.recent.push(request);
    if (this.state.recent.length > 500) this.state.recent.shift();
    this.dirty = true;
    if (this.directory && !this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 500); this.timer.unref();
    }
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.directory || !this.dirty) return;
    try {
      atomicWritePrivate(join(this.directory, "request-sources.json"), JSON.stringify(this.state) + "\n");
      this.dirty = false; this.savedAt = new Date().toISOString(); this.error = null;
    } catch {
      this.error = "Source history could not be saved. Check data-directory permissions and disk space.";
      log.error(this.error);
    }
  }
  snapshot() {
    this.load(); this.prune(Date.now());
    return { startedAt: this.state.startedAt, persistent: !!this.directory, savedAt: this.savedAt, pendingSave: this.dirty && !!this.directory, error: this.error, maxSystems: 512, maxRecent: 500, inactiveRetentionDays: 30, systems: this.state.systems.map(system => ({ ...system })).sort((a, b) => b.applicationRequests - a.applicationRequests || b.lastSeen.localeCompare(a.lastSeen)), recent: this.state.recent.map(event => ({ ...event })).reverse() };
  }
}
