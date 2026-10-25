import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AlertMonitor, type AlertSample } from "./alert-monitor.js";
import { alertSettings, defaultAlerts } from "./alert-store.js";
import { RequestSources } from "./request-sources.js";
import { HttpActivity } from "./http-activity.js";
import { OperatorAccess } from "./operator-access.js";
import { operatorAction } from "./operator-actions.js";
import { ApiKeyStore } from "./api-keys.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const directory = () => mkdtempSync(join(tmpdir(), "m365-alerts-"));
const enabled = { ...defaultAlerts, enabled: true };
const healthy: AlertSample = { total: 10, failed: 0, throttled: 0, storageError: false, authentication: "ready" };
function fixture(dir?: string) {
  let time = 1_000_000, sample = { ...healthy };
  const sampler = vi.fn(() => sample);
  const monitor = new AlertMonitor(dir, sampler, () => time);
  return { monitor, sampler, at: (n: number) => time = 1_000_000 + n, sample: (s: Partial<AlertSample>) => sample = { ...healthy, ...s } };
}

it("does no sampling or storage creation until enabled, and stops its background timer on close", async () => {
  vi.useFakeTimers(); const dir = directory(), f = fixture(dir);
  f.monitor.start(); await vi.advanceTimersByTimeAsync(90_000);
  expect(f.sampler).not.toHaveBeenCalled(); expect(existsSync(join(dir, "alerts.sqlite"))).toBe(false);
  f.monitor.configure(enabled); expect(f.sampler).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000); expect(f.sampler).toHaveBeenCalledTimes(2);
  f.monitor.close(); await vi.advanceTimersByTimeAsync(60_000); expect(f.sampler).toHaveBeenCalledTimes(2);
});

it("requires sustained thresholds, deduplicates incident updates and records recovery and recurrence", () => {
  const f = fixture(); f.monitor.configure(enabled);
  f.sample({ failed: 5 }); f.monitor.tick(); f.at(30_000); f.monitor.tick();
  expect(f.monitor.snapshot().active).toHaveLength(0);
  f.at(60_000); f.monitor.tick(); const first = f.monitor.snapshot();
  expect(first.active).toHaveLength(1); expect(first.events.map(e => e.event)).toEqual(["opened"]);
  f.at(90_000); f.monitor.tick(); expect(f.monitor.snapshot().total).toBe(1);
  f.monitor.acknowledge(String(first.active[0].id)); f.monitor.acknowledge(String(first.active[0].id));
  expect(f.monitor.snapshot().total).toBe(2);
  f.sample({}); f.monitor.tick(); expect(f.monitor.snapshot().active).toHaveLength(0);
  f.sample({ failed: 6 }); f.monitor.tick(); f.at(150_000); f.monitor.tick();
  const next = f.monitor.snapshot(); expect(next.active[0].id).not.toBe(first.active[0].id);
  expect(next.events.map(e => e.event)).toEqual(["opened", "resolved", "acknowledged", "opened"]);
  expect(() => f.monitor.acknowledge(String(first.active[0].id))).toThrow(); f.monitor.close();
});

it("resets interrupted sustain timers, requires minimum samples, and treats missing observations as unknown", () => {
  const f = fixture(); f.monitor.configure(enabled);
  f.sample({ total: 9, failed: 9 }); f.monitor.tick(); f.at(60_000); f.monitor.tick();
  expect(f.monitor.snapshot().active).toHaveLength(0);
  f.sample({ failed: 5 }); f.monitor.tick(); f.at(90_000); f.sample({}); f.monitor.tick();
  f.sample({ failed: 5 }); f.monitor.tick(); f.at(120_000); f.monitor.tick(); expect(f.monitor.snapshot().active).toHaveLength(0);
  f.at(150_000); f.monitor.tick(); expect(f.monitor.snapshot().active.map(r => r.rule)).toEqual(["failures"]);
  f.sample({ storageError: true }); f.at(180_000); f.monitor.tick();
  expect(f.monitor.snapshot().active.map(r => r.rule)).toContain("failures"); // No invented traffic recovery.
  f.at(240_000); f.monitor.tick(); expect(f.monitor.snapshot().active.map(r => r.rule)).toContain("storage");
  f.sample({ authentication: "auth_required" }); f.at(270_000); f.monitor.tick(); f.at(330_000); f.monitor.tick();
  expect(f.monitor.snapshot().active.map(r => r.rule)).toEqual(["authentication"]);
  f.sample({ authentication: "starting" }); f.monitor.tick(); expect(f.monitor.snapshot().active).toHaveLength(1);
  f.sample({}); f.monitor.tick(); expect(f.monitor.snapshot().active).toHaveLength(0); f.monitor.close();
});

it("persists settings, acknowledgements and paged unlimited events across restart without duplicate opening", () => {
  const dir = directory(), f = fixture(dir); f.sample({ failed: 5 }); f.monitor.configure(enabled); f.at(60_000); f.monitor.tick();
  const id = String(f.monitor.snapshot().active[0].id); f.monitor.acknowledge(id); f.monitor.close();
  const g = fixture(dir); g.sample({ failed: 5 }); g.monitor.tick();
  expect(g.monitor.snapshot().settings.enabled).toBe(true); expect(g.monitor.snapshot().active[0]).toMatchObject({ id, acknowledged_ms: 1_060_000 });
  expect(g.monitor.snapshot().total).toBe(2);
  for (let i = 1; i <= 15; i++) {
    g.at(i * 120_000); g.sample({}); g.monitor.tick();
    g.sample({ failed: 5 }); g.monitor.tick(); g.at(i * 120_000 + 60_000); g.monitor.tick();
  }
  const first = g.monitor.snapshot(), second = g.monitor.snapshot(20);
  expect(first.total).toBe(32); expect(first.events).toHaveLength(20); expect(second.events).toHaveLength(12);
  expect(new Set([...first.events, ...second.events].map(e => e.seq)).size).toBe(32); g.monitor.close();
});

it("validates settings, closes incidents when disabled, and reports its own store failures safely", () => {
  const f = fixture(); f.sample({ failed: 5 }); f.monitor.configure(enabled); f.at(60_000); f.monitor.tick();
  expect(() => f.monitor.configure({ ...enabled, minFailures: 100 })).toThrow();
  expect(f.monitor.snapshot().active).toHaveLength(1);
  f.monitor.configure({ ...enabled, enabled: false }); expect(f.monitor.snapshot().active).toHaveLength(0);
  expect(f.monitor.snapshot().events[0].event).toBe("disabled"); f.monitor.close();
  expect(() => alertSettings.parse({ ...enabled, webhook: "https://unrequested.invalid" })).toThrow();
  const dir = directory(); writeFileSync(join(dir, "alerts.sqlite"), "corrupt-private-marker");
  const g = fixture(dir); g.monitor.tick(); const status = g.monitor.snapshot();
  expect(status.error).toContain("unavailable"); expect(JSON.stringify(status)).not.toContain("corrupt-private-marker"); g.monitor.close();
});

it("observes real saved SSE failures without a dashboard, excluding polls, tests and cancellations from errors", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T20:00:00Z"));
  const sources = new RequestSources(), activity = new HttpActivity(sources);
  sources.alerts.start(); sources.alerts.configure({ ...enabled, minRequests: 1, minFailures: 1, sustainSeconds: 30, authentication: false });
  const fail = activity.begin("POST", "/v1/chat/completions")!; fail.chat("claude-sonnet", true); fail.result(429); fail(200);
  const poll = activity.begin("GET", "/v1/models")!; poll(429);
  const check = activity.begin("POST", "/v1/proxy/model-check", true)!; check(429);
  const cancelled = activity.begin("POST", "/v1/chat/completions")!; cancelled.chat("claude-sonnet", false); cancelled(499);
  vi.setSystemTime(new Date("2026-10-26T20:00:00Z"));
  const future = activity.begin("POST", "/v1/chat/completions")!; future.result(429); future(200);
  vi.setSystemTime(new Date("2026-10-25T20:00:00Z"));
  await vi.advanceTimersByTimeAsync(60_000);
  const state = sources.alerts.snapshot(); expect(state.active.map(r => r.rule).sort()).toEqual(["failures", "throttling"]);
  expect(state.active[0].evidence).toContain("1"); expect(state.active[0].evidence).toContain("2 completed application chats");
  expect(sources.snapshot().storage.retention).toBe("unlimited"); sources.close();
});

it("requires the host grant for alert changes and acknowledgement without forcing application keys", async () => {
  const dir = directory(), access = new OperatorAccess(dir), keys = new ApiKeyStore(dir), activity = new HttpActivity();
  const grant = access.grant();
  const request = (value: unknown, token = grant.token) => new Request("http://localhost/v1/proxy/operator", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-m365-operator": token }, body: JSON.stringify(value) });
  expect((await operatorAction(request({ action: "alerts-configure", settings: enabled }, ""), activity, access, keys)).status).toBe(403);
  expect((await operatorAction(request({ action: "alerts-configure", settings: enabled }), activity, access, keys)).status).toBe(200);
  expect((await operatorAction(request({ action: "alerts-configure", settings: { ...enabled, sustainSeconds: 0 } }), activity, access, keys)).status).toBe(400);
  expect(keys.status().required).toBe(false); activity.sources.close();
});
