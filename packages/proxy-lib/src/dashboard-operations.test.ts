import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";
import { dashboardResponse } from "./dashboard.js";
async function dashboard() {
  const elements = new Map<string, any>();
  const node = () => ({ textContent: "", value: "", hidden: false, disabled: false, children: [] as any[], dataset: {}, style: {}, listeners: {} as Record<string, Function>, setAttribute() {}, querySelectorAll: () => [], addEventListener(event: string, callback: Function) { this.listeners[event] = callback; }, replaceChildren(...children: any[]) { this.children = children; }, append(...children: any[]) { this.children.push(...children); }, focus() {} });
  const el = (id: string) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const pending: { resolve: (value: any) => void; url: string }[] = [];
  const context = createContext({ document: { getElementById: el, createElement: node }, fetch: (url: string) => new Promise(resolve => pending.push({ resolve, url })), AbortController, AbortSignal, URLSearchParams, setInterval: () => 0, clearTimeout: () => {}, setTimeout: () => 0 });
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  return { el, context, pending };
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
