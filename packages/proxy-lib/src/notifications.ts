import { NotificationStore, type EventBatch } from "./notification-store.js";
import { notificationDestination, type NotificationDestination } from "./notification-schema.js";
import { sendNotification, DeliveryFailure } from "./notification-transport.js";

export class Notifications {
  private store: NotificationStore;
  private timer?: ReturnType<typeof setInterval>;
  private work?: Promise<void>;
  private closed = false;
  private error: string | null = null;
  constructor(directory: string | undefined, private source: (after: number, limit: number) => EventBatch,
    private send = sendNotification, private now = () => Date.now()) { this.store = new NotificationStore(directory); }
  start() {
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => { void this.pump(); }, 5000); this.timer.unref(); void this.pump();
  }
  pump(): Promise<void> {
    if (this.closed || this.work || !this.store.exists()) return this.work ?? Promise.resolve();
    this.work = (async () => {
      try {
        this.store.ingest(this.source(this.store.cursor(), 50), this.now());
        const job = this.store.claim(this.now());
        if (job) {
          let failure: DeliveryFailure | undefined;
          try { await this.send(job.config, job.message); }
          catch (error) { failure = error instanceof DeliveryFailure ? error : new DeliveryFailure("delivery_transport_failed", true); }
          this.store.complete(job.id, job.lease, job.attempts, this.now(), failure);
        }
        this.error = null;
      } catch { this.error = "Notification delivery is unavailable. Inspect host storage/configuration; no credentials are returned here."; }
    })().finally(() => { this.work = undefined; if (this.closed) this.store.close(); });
    return this.work;
  }
  save(value: NotificationDestination, id?: string) {
    this.ensureOpen(); value = notificationDestination.parse(value);
    this.store.save(value, this.source(0, 0).max, this.now(), id); return this.snapshot();
  }
  enable(id: string, enabled: boolean) { this.ensureOpen(); this.store.enable(id, enabled, this.source(0, 0).max, this.now()); return this.snapshot(); }
  remove(id: string) { this.ensureOpen(); this.store.remove(id, this.now()); return this.snapshot(); }
  preview(id: string) { this.ensureOpen(); return this.store.preview(id, this.now()); }
  test(id: string) { this.ensureOpen(); this.store.test(id, this.now()); return this.snapshot(); }
  private ensureOpen() { if (this.closed) throw Error("Notification service closed"); }
  snapshot(offset = 0) { this.ensureOpen(); return { ...this.store.snapshot(offset), running: !!this.timer, error: this.error }; }
  summary() {
    try { const s = this.snapshot(); return { configured: s.destinations.length, enabled: s.destinations.filter(d => d.enabled).length, counts: s.counts, running: s.running, error: s.error }; }
    catch { return { configured: 0, enabled: 0, counts: {}, running: !!this.timer, error: "Notification state unavailable." }; }
  }
  close() { this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; if (!this.work) this.store.close(); }
}
