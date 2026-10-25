import { modelCheckState } from "./model-checks.js";
import type { HttpActivity } from "./http-activity.js";

export interface ServiceController {
  status(): Promise<unknown>;
  startup(enabled: boolean): Promise<void>;
  restart(): Promise<void>;
}
type Control = { adapter?: ServiceController; phase: "running" | "draining" | "restarting"; message: string; changing?: boolean; timer?: ReturnType<typeof setTimeout> };
// The CLI runtime and Nitro bundle share this process-local controller, not bundled module instances.
const slot = Symbol.for("m365.proxy.service-control");
const globals = globalThis as typeof globalThis & { [slot]?: Control };
const control = () => globals[slot] ??= { phase: "running", message: "" };
export function registerServiceController(adapter: ServiceController) { const state = control(); if (state.timer) clearTimeout(state.timer); state.adapter = adapter; state.phase = "running"; state.message = ""; }
export function serviceState() { const state = control(); return { available: !!state.adapter, phase: state.phase, message: state.message, platform: process.platform }; }
export function drainingResponse(req: Request): Response | null {
  if (control().phase === "running" || req.method !== "POST" || !["/v1/chat/completions", "/v1/proxy/model-check"].includes(new URL(req.url).pathname)) return null;
  return Response.json({ error: { type: "proxy_draining", message: "The proxy is draining for an operator-requested restart. Retry shortly." } }, { status: 503, headers: { "Retry-After": "5" } });
}
export async function serviceCommand(action: string, activity: HttpActivity) {
  const state = control(), adapter = state.adapter;
  if (!adapter) throw new Error("Service controls require the standalone CLI launcher.");
  if (action === "status") return { ...serviceState(), startup: await adapter.status() };
  if (action === "startup-enable" || action === "startup-disable") {
    if (state.phase !== "running") throw new Error("Wait for the pending restart before changing startup.");
    if (state.changing) throw new Error("Another service setting is being updated.");
    state.changing = true;
    try { await adapter.startup(action === "startup-enable"); } finally { state.changing = false; }
    return { ...serviceState(), startup: await adapter.status() };
  }
  if (action !== "restart") throw new Error("Unknown service action.");
  if (state.changing) throw new Error("Wait for the startup setting update before restarting.");
  if (state.phase !== "running") return serviceState();
  state.phase = "draining"; state.message = "Waiting for admitted chats, model tests and backup operations to finish. New chats receive a retryable 503.";
  const deadline = Date.now() + 120_000;
  const check = async () => {
    const backup = activity.sources.backups.summary();
    const busy = activity.snapshot().live.some(item => item.endpoint === "/v1/chat/completions" || item.endpoint === "/v1/proxy/model-check") || !!modelCheckState().runningModel || backup.inProgress || backup.backupLocked;
    if (busy && Date.now() < deadline) { state.timer = setTimeout(check, 500); state.timer.unref(); return; }
    if (busy) { state.phase = "running"; state.message = "Restart cancelled after two minutes: active requests or backup work were preserved. Inspect backup locks if no backup is running."; return; }
    try { await adapter.restart(); state.phase = "restarting"; state.message = "Restarting; the dashboard will reconnect."; }
    catch { state.phase = "running"; state.message = "Restart could not be staged. Check service logs on the host."; }
  };
  state.timer = setTimeout(check, 500); state.timer.unref();
  return serviceState();
}
