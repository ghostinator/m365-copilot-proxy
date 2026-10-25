import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";
import { dashboardResponse } from "./dashboard.js";
async function dashboard() {
  const elements = new Map<string, any>(), blobs: Blob[] = [];
  const node = () => ({ textContent: "", value: "", hidden: false, disabled: false, children: [] as any[], dataset: {}, style: {}, listeners: {} as Record<string, Function>, setAttribute() {}, querySelectorAll: () => [], addEventListener(event: string, callback: Function) { this.listeners[event] = callback; }, replaceChildren(...children: any[]) { this.children = children; }, append(...children: any[]) { this.children.push(...children); }, click() {}, focus() {} });
  const el = (id: string) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const pending: { resolve: (value: any) => void; url: string }[] = [];
  const context = createContext({ document: { getElementById: el, createElement: node }, fetch: (url: string) => new Promise(resolve => pending.push({ resolve, url })), AbortController, AbortSignal, URLSearchParams, Blob, URL: { createObjectURL(blob: Blob) { blobs.push(blob); return "blob:synthetic"; }, revokeObjectURL() {} }, setInterval: () => 0, clearTimeout: () => {}, setTimeout: () => 0 });
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  return { el, context, pending, blobs };
}
it("exports only saved-page metadata and redacts diagnostics without leaking operator/application credentials", async () => {
  const { context } = await dashboard();
  const record = { id: "example", address: "192.0.2.1", endpoint: "/v1/chat/completions", diagnostic: { message: "Bearer private-token m365_operator_abcdefghijklmnopqrstuvwxyz0123456789 password=secret" }, headers: { authorization: "private-header" }, prompt: "private-prompt", apiKey: "private-key" };
  runInContext(`sourceRecords=${JSON.stringify([record])}`, context);
  const text = runInContext("JSON.stringify(exportRequestPage())", context);
  expect(text).toContain("192.0.2.1"); expect(text).toContain("[redacted");
  expect(text).not.toMatch(/private-token|abcdefghijklmnopqrstuvwxyz|password=secret|private-header|private-prompt|private-key/);
  expect(JSON.parse(text).records).toHaveLength(1);
});
it("ignores a newly created token arriving after the operator locks the dashboard", async () => {
  const { el, context, pending } = await dashboard();
  runInContext("operatorToken='grant';operatorExpiry=Date.now()+60000;managementAction({action:'key-create',label:'Example'})", context);
  expect(pending[1].url).toBe("/v1/proxy/operator");
  runInContext("lockOperator()", context);
  pending[1].resolve({ ok: true, json: async () => ({ token: "must-not-display" }) });
  await new Promise(resolve => setImmediate(resolve));
  expect(el("created-key-token").value).toBe(""); expect(el("created-key").hidden).toBe(true);
  expect(el("key-management").disabled).toBe(true);
});

it("renders alert evidence as text, preserves draft settings, and locks acknowledgement controls", async () => {
  const { el, context } = await dashboard();
  const alerts = { settings: { enabled: true, failures: true, throttling: true, authentication: true, storage: true,
    windowMinutes: 5, minRequests: 10, minFailures: 5, failurePercent: 50, sustainSeconds: 60 },
    active: [{ id: "incident", rule: "failures", opened_ms: 1000, last_seen_ms: 2000, acknowledged_ms: null, evidence: "<img src=x>" }],
    events: [{ seq: 1, rule: "failures", event: "opened", at_ms: 1000, evidence: "<script>private text</script>" }],
    total: 1, offset: 0, limit: 20, checkedAt: 2000, running: true, error: null };
  runInContext("operatorToken='grant';renderAlerts("+JSON.stringify(alerts)+")", context);
  expect(el("alert-incidents").children[0].children[0].textContent).toContain("<img src=x>");
  expect(el("alert-events").children[0].textContent).toContain("<script>private text</script>");
  expect(el("alert-incidents").children[0].children[1].disabled).toBe(false);
  el("alerts-minRequests").value = "25"; el("alerts-minRequests").listeners.input();
  runInContext("renderAlerts("+JSON.stringify(alerts)+")", context);
  expect(el("alerts-minRequests").value).toBe("25");
  runInContext("lockOperator()", context);
  expect(el("alert-settings").disabled).toBe(true);
  expect(el("alert-incidents").children[0].children[1].disabled).toBe(true);
  runInContext("clearStatus('Disconnected')", context);
  expect(el("alert-incidents").children).toHaveLength(0);
  expect(el("alert-events").children).toHaveLength(0);
});

it("clears notification credentials and ignores late configuration responses after locking", async () => {
  const { el, context, pending } = await dashboard();
  el("notification-url").value = "https://example.invalid/private-hook"; el("notification-password").value = "private-password";
  runInContext("operatorToken='grant';operatorExpiry=Date.now()+60000;notificationAction({action:'notifications-status',offset:0})", context);
  runInContext("lockOperator()", context);
  pending[1].resolve({ ok: true, json: async () => ({ destinations: [{ id: "late", label: "must-not-restore" }], deliveries: [], total: 0, offset: 0 }) });
  await new Promise(resolve => setImmediate(resolve));
  expect(el("notification-url").value).toBe(""); expect(el("notification-password").value).toBe("");
  expect(el("notification-choice").children).toHaveLength(0); expect(el("notification-controls").disabled).toBe(true);
  const before = pending.length; el("notification-test").listeners.click(); expect(pending.length).toBe(before);
  expect(el("notification-message").textContent).toContain("Preview this destination");
});

it("selects API email fields and clears provider credentials on lock", async () => {
  const { el, context } = await dashboard();
  runInContext("notificationAction=command=>globalThis.capturedNotification=command", context);
  for (const type of ["postal", "sendgrid"]) {
    el("notification-type").value = type; el("notification-type").listeners.change();
    expect(el("notification-email-api").hidden).toBe(false);
    expect(el("notification-"+type).hidden).toBe(false);
    expect(el("notification-webhook").hidden).toBe(true); expect(el("notification-smtp").hidden).toBe(true);
    el("notification-api-key").value = "private-provider-key"; el("notification-api-from").value = "private@example.com";
    el("notification-api-to").value = "recipient@example.com"; el("notification-postal-url").value = "https://private.example.com";
    el("notification-rules").value = "failures, storage"; el("notification-events").value = "opened";
    el("notification-region").value = "eu"; el("notification-postal-http").checked = false;
    el("notification-save").listeners.click();
    const command = runInContext("capturedNotification", context);
    expect(command.action).toBe("notifications-save");
    expect(command.destination.config).toMatchObject({ type, apiKey: "private-provider-key", from: "private@example.com", to: ["recipient@example.com"] });
    expect(command.destination.config).not.toHaveProperty("password");
    expect(type === "postal" ? command.destination.config.url : command.destination.config.region).toBe(type === "postal" ? "https://private.example.com" : "eu");
    runInContext("lockOperator()", context);
    for (const id of ["api-key", "api-from", "api-to", "postal-url"]) expect(el("notification-"+id).value).toBe("");
  }
});

it("saves ntfy fields separately from email/webhook settings and clears private topic/token on lock", async () => {
  const { el, context } = await dashboard(); runInContext("notificationAction=command=>globalThis.capturedNotification=command", context);
  el("notification-type").value = "ntfy"; el("notification-type").listeners.change();
  expect(el("notification-ntfy").hidden).toBe(false); expect(el("notification-email-api").hidden).toBe(true); expect(el("notification-webhook").hidden).toBe(true);
  el("notification-ntfy-url").value = "https://push.example.invalid"; el("notification-topic").value = "private-topic"; el("notification-ntfy-token").value = "private-token"; el("notification-ntfy-http").checked = false;
  el("notification-rules").value = "storage"; el("notification-events").value = "opened"; el("notification-save").listeners.click();
  expect(runInContext("capturedNotification.destination.config", context)).toMatchObject({ type: "ntfy", url: "https://push.example.invalid", topic: "private-topic", bearer: "private-token", allowHttp: false });
  runInContext("lockOperator()", context);
  for (const id of ["ntfy-url", "topic", "ntfy-token"]) expect(el("notification-"+id).value).toBe("");
});

it("ignores a password-login result arriving after Lock and clears password fields", async () => {
  const { el, context, pending } = await dashboard(); el("admin-password").value = "private administrator password";
  const submit = el("admin-login").listeners.submit({ preventDefault() {} });
  expect(el("admin-password").value).toBe(""); runInContext("lockOperator()", context);
  pending[1].resolve({ ok: true, json: async () => ({ token: "must-not-activate", expiresAt: new Date(Date.now()+60_000).toISOString() }) });
  await submit; expect(runInContext("operatorToken", context)).toBe(""); expect(el("admin-settings").disabled).toBe(true);
});

it("starts a clean destination draft without sending a request and requires sign-in before creation", async () => {
  const { el, context, pending } = await dashboard(); const requests = pending.length;
  el("notification-add").listeners.click(); expect(el("operator-message").textContent).toContain("Sign in");
  runInContext("operatorToken='grant'",context); el("notification-replace").checked=true; el("notification-url").value="private-draft";
  el("notification-add").listeners.click(); expect(el("notification-replace").checked).toBe(false); expect(el("notification-url").value).toBe("");
  expect(el("notification-type").value).toBe("webhook"); expect(pending.length).toBe(requests);
});

it("saves a restore-compatible manifest without internal fields and clears it on lock", async () => {
  const { el, context, blobs } = await dashboard(), id="12345678-1234-4234-8234-123456789abc";
  const backup={version:1,id,createdAt:"2026-10-25T00:00:00.000Z",bytes:4096,sha256:"a".repeat(64),schema:5,requests:2,modelReports:0,verified:true};
  el("backup-choice").value=id;
  await runInContext("operatorToken='grant';operatorCommand=async()=>("+JSON.stringify({url:"/v1/proxy/download/b_"+"a".repeat(43),backup})+");historyAction('download')",context);
  expect(el("backup-manifest").disabled).toBe(false); el("backup-manifest").listeners.click();
  const manifest=JSON.parse(await blobs[0].text()); expect(manifest.id).toBe(id); expect(manifest.sha256).toBe(backup.sha256); expect(manifest).not.toHaveProperty("verified");
  runInContext("lockOperator()",context); expect(el("backup-manifest").disabled).toBe(true); expect(runInContext("backupManifest",context)).toBeNull();
});
