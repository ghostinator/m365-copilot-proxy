import { AlertStore, defaultAlerts, type AlertSettings, type AlertRule, type AlertFact } from "./alert-store.js";
import { Notifications } from "./notifications.js";

export interface AlertSample { total: number; failed: number; throttled: number; storageError: boolean; authentication: "ready" | "starting" | "auth_required" }
/** Background observations only; the sampler never refreshes auth or calls a model. */
export class AlertMonitor {
  private store: AlertStore;
  private pending = new Map<AlertRule, number>();
  private timer?: ReturnType<typeof setInterval>;
  private lastConfig = "";
  private closed = false;
  private error: string | null = null;
  private checkedAt: number | null = null;
  readonly notifications: Notifications;
  constructor(directory: string | undefined, private sample: (settings: AlertSettings, now: number) => AlertSample, private now = () => Date.now()) {
    this.store = new AlertStore(directory); this.notifications = new Notifications(directory, (after, limit) => this.store.deliveryEvents(after, limit), undefined, now);
  }
  start() {
    if (this.timer || this.closed) return;
    this.notifications.start();
    this.timer = setInterval(() => this.tick(), 30_000); this.timer.unref();
    this.tick();
  }
  tick() {
    if (this.closed) return;
    try {
      const settings = this.store.settings(), config = JSON.stringify(settings);
      if (this.lastConfig !== config) { this.pending.clear(); this.lastConfig = config; }
      if (!settings.enabled) { this.pending.clear(); this.error = null; return; }
      const now = this.now(), s = this.sample(settings, now);
      const traffic = !s.storageError && s.total >= settings.minRequests;
      const facts: AlertFact[] = [
        { rule: "failures", triggered: settings.failures ? s.storageError ? null : traffic && s.failed >= settings.minFailures && s.failed / s.total * 100 >= settings.failurePercent : false,
          evidence: `${s.failed} errors / ${s.total} completed application chats in ${settings.windowMinutes} minutes.` },
        { rule: "throttling", triggered: settings.throttling ? s.storageError ? null : traffic && s.throttled >= settings.minFailures : false,
          evidence: `${s.throttled} throttled requests / ${s.total} completed application chats in ${settings.windowMinutes} minutes.` },
        { rule: "authentication", triggered: settings.authentication ? s.authentication === "starting" ? null : s.authentication === "auth_required" : false,
          evidence: s.authentication === "auth_required" ? "Existing sign-in requires recovery on the proxy host." : "Authentication is ready." },
        { rule: "storage", triggered: settings.storage && s.storageError, evidence: s.storageError ? "Activity storage is unavailable or has unsaved/lost records. Inspect host storage and logs." : "Activity storage is available with no pending save error." },
      ];
      this.store.apply(facts, this.pending, settings.sustainSeconds * 1000, now);
      this.checkedAt = now; this.error = null;
    } catch { this.error = "Alert monitoring is unavailable. Check the host alert database, configuration, permissions and disk space."; this.pending.clear(); }
  }
  configure(value: AlertSettings) {
    if (this.closed) throw new Error("Alert monitor is closed");
    this.store.configure(value, this.now()); this.pending.clear(); this.lastConfig = ""; this.tick(); return this.snapshot();
  }
  acknowledge(id: string) { if (this.closed) throw new Error("Alert monitor is closed"); this.store.acknowledge(id, this.now()); return this.snapshot(); }
  snapshot(offset = 0) {
    try { return { settings: this.store.settings(), ...this.store.snapshot(offset), checkedAt: this.checkedAt, error: this.error, running: !!this.timer, intervalSeconds: 30, retention: "unlimited" }; }
    catch { return { settings: { ...defaultAlerts }, active: [], events: [], total: 0, offset: 0, limit: 20, checkedAt: this.checkedAt, error: "Alert history or settings could not be read; monitoring is unavailable.", running: !!this.timer, intervalSeconds: 30, retention: "unlimited" }; }
  }
  close() { this.notifications.close(); this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.store.close(); this.pending.clear(); }
}
