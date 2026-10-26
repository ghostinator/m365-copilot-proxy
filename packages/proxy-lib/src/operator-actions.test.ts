import { RequestSources } from "./request-sources.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { OperatorAccess } from "./operator-access.js";
import { ApiKeyStore } from "./api-keys.js";
import { operatorAction } from "./operator-actions.js";
import { HttpActivity } from "./http-activity.js";
import { drainingResponse, registerServiceController, serviceCommand, serviceState } from "./service-control.js";
import { requestGate } from "./http-policy.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m365-operator-")), access = new OperatorAccess(dir), keys = new ApiKeyStore(dir);
  const grant = access.grant(), activity = new HttpActivity();
  const request = (value: unknown, headers: Record<string,string> = {}) => new Request("http://localhost/v1/proxy/operator", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-m365-operator": grant.token, ...headers }, body: JSON.stringify(value) });
  return { dir, access, keys, grant, activity, request };
}
it("requires an expiring host grant and exact browser origin, independently of application credentials", async () => {
  vi.stubEnv("M365_API_KEY", "legacy-secret");
  const f = fixture();
  for (const headers of [{ "x-m365-operator": "" }, { origin: "https://evil.invalid" }, { origin: "null" }, { "x-m365-operator": "m365_invalid" }]) {
    expect((await operatorAction(f.request({ action: "key-create", label: "no" }, headers), f.activity, f.access, f.keys)).status).toBe(403);
  }
  expect(requestGate(f.request({ action: "unlock" }), f.keys)).toBeNull();
  expect((await operatorAction(f.request({ action: "unlock" }), f.activity, f.access, f.keys)).status).toBe(200);
  expect(readFileSync(join(f.dir, "operator-access.json"), "utf8")).not.toContain(f.grant.token);
  const second = f.access.grant();
  expect(f.access.allows(f.request({ action: "unlock" }))).toBe(false);
  expect(f.access.allows(f.request({}, { "x-m365-operator": second.token }))).toBe(true);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000);
  expect(f.access.allows(f.request({}, { "x-m365-operator": second.token }))).toBe(false);
  vi.restoreAllMocks(); f.activity.sources.close();
});
it("creates a token once, renames and revokes without enabling required-key mode", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const f = fixture(), action = (value: unknown) => operatorAction(f.request(value), f.activity, f.access, f.keys);
  const created = await (await action({ action: "key-create", label: "Prod" })).json();
  expect(created.token).toMatch(/^m365_/);
  expect(f.keys.status().required).toBe(false);
  expect(JSON.stringify(f.keys.status())).not.toContain(created.token);
  expect((await action({ action: "key-rename", id: created.id, label: "Production" })).status).toBe(200);
  expect(f.keys.status().keys[0].label).toBe("Production");
  expect(f.keys.authorize(new Headers({ authorization: `Bearer ${created.token}` })).application?.label).toBe("Production");
  await action({ action: "key-revoke", id: created.id });
  expect(f.keys.authorize(new Headers({ authorization: `Bearer ${created.token}` }))).toEqual({ allowed: true, application: null });
  expect((await action({ action: "key-create", label: "", token: "injected" })).status).toBe(400);
  expect((await action({ action: "key-create", label: "a".repeat(5000) })).status).toBe(400);
  f.activity.sources.close();
});
it.each(['/v1/chat/completions', '/v1/responses', '/v1/messages'])("drains %s before restarting, refuses new chats and leaves model-list reads available", async endpoint => {
  vi.useFakeTimers();
  const activity = new HttpActivity(), restart = vi.fn(async () => {});
  registerServiceController({ status: async () => ({}), startup: async () => {}, restart });
  const finish = activity.begin("POST", endpoint)!;
  await serviceCommand("restart", activity);
  await vi.advanceTimersByTimeAsync(1000);
  expect(restart).not.toHaveBeenCalled();
  expect(drainingResponse(new Request("http://localhost" + endpoint, { method: "POST" }))?.status).toBe(503);
  expect(drainingResponse(new Request("http://localhost/v1/models"))).toBeNull();
  finish(200); await vi.advanceTimersByTimeAsync(500);
  expect(restart).toHaveBeenCalledOnce();
  expect(serviceState().phase).toBe("restarting");
  registerServiceController({ status: async () => ({}), startup: async () => {}, restart });
  activity.sources.close();
});
it("cancels a restart after the drain deadline and resumes admissions without interrupting work", async () => {
  vi.useFakeTimers();
  const activity = new HttpActivity(), restart = vi.fn(async () => {});
  registerServiceController({ status: async () => ({}), startup: async () => {}, restart });
  const finish = activity.begin("POST", "/v1/proxy/model-check")!;
  await serviceCommand("restart", activity); await vi.advanceTimersByTimeAsync(120_500);
  expect(restart).not.toHaveBeenCalled(); expect(serviceState().phase).toBe("running");
  expect(drainingResponse(new Request("http://localhost/v1/chat/completions", { method: "POST" }))).toBeNull();
  expect(activity.snapshot().active).toBe(1); finish(200); activity.sources.close();
});

it("serializes startup changes and refuses a restart while startup is being updated", async () => {
  const activity = new HttpActivity();
  let finish!: () => void;
  registerServiceController({ status: async () => ({}), startup: () => new Promise<void>(resolve => finish = resolve), restart: async () => {} });
  const pending = serviceCommand("startup-enable", activity);
  await expect(serviceCommand("startup-disable", activity)).rejects.toThrow("Another service setting");
  await expect(serviceCommand("restart", activity)).rejects.toThrow("startup setting");
  finish(); await pending; expect(serviceState().phase).toBe("running"); activity.sources.close();
});

it("waits for a manual backup lock before handing off a dashboard restart",async()=>{
 vi.useFakeTimers();const dir=mkdtempSync(join(tmpdir(),"m365-backup-restart-")),activity=new HttpActivity(new RequestSources(dir)),restart=vi.fn(async()=>{});
 registerServiceController({status:async()=>({}),startup:async()=>{},restart});
 writeFileSync(join(dir,"history-backups.lock"),"offline fixture");await serviceCommand("restart",activity);await vi.advanceTimersByTimeAsync(500);expect(restart).not.toHaveBeenCalled();
 rmSync(join(dir,"history-backups.lock"));await vi.advanceTimersByTimeAsync(500);expect(restart).toHaveBeenCalledOnce();activity.sources.close();
});

it("preflights an update before draining and waits for an in-flight notification", async () => {
 vi.useFakeTimers();const activity=new HttpActivity(),restart=vi.fn(async()=>{}),prepare=vi.fn(async()=>{});
 registerServiceController({status:async()=>({}),startup:async()=>{},restart,prepareUpdate:prepare});
 const summary=vi.spyOn(activity.sources.alerts.notifications,'summary').mockReturnValue({configured:1,enabled:1,counts:{sending:1},running:true,error:null});
 await serviceCommand('update-apply',activity);expect(prepare).toHaveBeenCalledWith('update-apply');
 await vi.advanceTimersByTimeAsync(500);expect(restart).not.toHaveBeenCalled();
 summary.mockReturnValue({configured:1,enabled:1,counts:{sent:1},running:true,error:null});
 await vi.advanceTimersByTimeAsync(500);expect(restart).toHaveBeenCalledWith('update-apply');activity.sources.close();
});
