import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./index.js";
import { activePriorityAccessExhaustion, notePriorityAccessExhausted, resetPriorityAccessState } from "@m365-copilot/core";
import { createContext, runInContext } from "node:vm";
import { dashboardResponse } from "./dashboard.js";

afterEach(() => { vi.unstubAllEnvs(); resetPriorityAccessState(); });

it("organizes unique controls into accessible tabs and preserves filters when switching with keyboard or deep links", async () => {
  const page = await dashboardResponse("/dashboard")!.text();
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const tab of ["models", "requests", "errors"]) expect(ids).not.toContain(tab);
  expect(page).toContain('role="tablist"');
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, attributes: {} as Record<string, string>, listeners: {} as Record<string, Function>, setAttribute(key: string, value: string) { this.attributes[key] = value; }, addEventListener(key: string, callback: Function) { this.listeners[key] = callback; }, focus: vi.fn() });
    return elements.get(id);
  };
  const location = { hash: "#errors" };
  const context = createContext({ document: { getElementById: element }, fetch: () => new Promise(() => {}), location, AbortController, AbortSignal, URLSearchParams, setInterval: () => 0 });
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  expect(element("panel-errors").hidden).toBe(false);
  expect(element("panel-models").hidden).toBe(true);
  element("activity-range").value = "7d";
  element("tab-models").listeners.click();
  expect(location.hash).toBe("models");
  expect(element("panel-errors").hidden).toBe(true);
  expect(element("panel-models").hidden).toBe(false);
  element("tab-models").listeners.keydown({ key: "ArrowRight", preventDefault() {} });
  expect(element("tab-errors").focus).toHaveBeenCalledOnce();
  expect(element("tab-errors").attributes["aria-selected"]).toBe("true");
  expect(element("activity-range").value).toBe("7d");
});

it("pages recent requests in groups of 20 and resets pagination when the size or filter changes", async () => {
  const elements = new Map<string, any>();
  const node = () => ({ textContent: "", value: "", disabled: false, children: [] as any[], listeners: {} as Record<string, Function>, setAttribute() {}, focus() {}, addEventListener(event: string, callback: Function) { this.listeners[event] = callback; }, replaceChildren(...children: any[]) { this.children = children; }, append(child: any) { this.children.push(child); } });
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  element("activity-page-size").value = "20"; element("activity-filter").value = "all";
  const context = createContext({ document: { getElementById: element, hidden: false, createElement: node }, fetch: () => new Promise(() => {}), AbortController, AbortSignal, URLSearchParams, setInterval: () => 0 });
  const page = await dashboardResponse("/dashboard")!.text();
  expect(page).toContain('class="request-box"');
  expect(page).toContain('max-height:480px;overflow:auto');
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  const events = Array.from({ length: 55 }, (_, id) => ({ id: String(id), receivedAt: new Date().toISOString(), method: "GET", endpoint: "/v1/models", clientAddress: "100.64.0.2", source: "application", streamed: null, status: 200, phase: "completed", outcome: "success", applicationStatus: null, responseBytes: 123, firstByteMs: 1, queueMs: null, durationMs: 2, upstreamAttempts: 0 }));
  runInContext(`records=${JSON.stringify(events)};renderEvents()`, context);
  expect(element("http-events").children).toHaveLength(20);
  expect(element("activity-page").textContent).toContain("1–20 of 55");
  element("activity-next").listeners.click();
  expect(element("activity-page").textContent).toContain("21–40 of 55");
  element("activity-next").listeners.click();
  expect(element("http-events").children).toHaveLength(15);
  expect(element("activity-next").disabled).toBe(true);
  element("activity-page-size").value = "50"; element("activity-page-size").listeners.change();
  expect(element("http-events").children).toHaveLength(50);
  expect(element("activity-page").textContent).toContain("1–50 of 55");
  element("activity-filter").value = "errors"; element("activity-filter").listeners.change();
  expect(element("activity-page").textContent).toContain("0–0 of 0");
  expect(element("activity-previous").disabled).toBe(true);
});

it("protects operator data with the API key and never injects credentials into the page", async () => {
  vi.stubEnv("M365_API_KEY", "secret-for-dashboard-test");
  const app = createApp();
  try {
    const page = await app.fetch(new Request("http://localhost/dashboard"));
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).not.toContain("secret-for-dashboard-test");
    expect((await app.fetch(new Request("http://localhost/v1/proxy/status"))).status).toBe(401);
    expect((await app.fetch(new Request("http://localhost/v1/proxy/checks"))).status).toBe(401);
    expect((await app.fetch(new Request("http://localhost/v1/proxy/status", { headers: { authorization: "Bearer secret-for-dashboard-test", origin: "https://evil.example" } }))).status).toBe(403);
    const response = await app.fetch(new Request("http://localhost/v1/proxy/status", { headers: { authorization: "Bearer secret-for-dashboard-test" } }));
    const status = await response.json();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(status.authentication.status).toBe("starting");
    expect(status.requests).toEqual({ sessions: 0, pending: 0 });
    expect(status.budgets.every((b: any) => b.allowance === null && b.observation === "unknown")).toBe(true);
    expect(JSON.stringify(status)).not.toContain("secret-for-dashboard-test");
  } finally { app.close(); }
});

it("reports an observed budget wall and fallback without the upstream refusal text", async () => {
  vi.stubEnv("M365_API_KEY", "");
  vi.stubEnv("M365_OPUS_FALLBACK_MODEL", "claude-opus-4.5");
  const reset = new Date(Date.now() + 60_000);
  notePriorityAccessExhausted("opus", { window: "day", resetsAt: reset, message: "private upstream text" });
  const app = createApp();
  try {
    const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status"))).json();
    expect(status.budgets[0]).toMatchObject({ exhausted: true, resetsAt: reset.toISOString(), fallbackModel: "claude-opus-4.5" });
    expect(JSON.stringify(status)).not.toContain("private upstream text");
    expect(activePriorityAccessExhaustion("opus")).not.toBeNull();
  } finally { app.close(); }
});

it("forgets protected data immediately and discards a late response from the previous key", async () => {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", value: "", listeners: {} as Record<string, Function>, setAttribute() {}, focus() {}, addEventListener(event: string, callback: Function) { this.listeners[event] = callback; }, replaceChildren() {}, append() {} });
    return elements.get(id);
  };
  const pending: { resolve: (value: any) => void; signal: AbortSignal }[] = [];
  const context = createContext({ document: { getElementById: element, hidden: false, createElement: () => ({}) }, fetch: (_url: string, options: { signal: AbortSignal }) => new Promise(resolve => pending.push({ resolve, signal: options.signal })), AbortController, AbortSignal, URLSearchParams, setInterval: () => 0 });
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  element("key").value = "old-key";
  element("connect").listeners.submit({ preventDefault() {} });
  element("forget").listeners.click();
  expect(element("key").value).toBe("");
  expect(element("ready").textContent).toBe("Unavailable");
  expect(pending[1].signal.aborted).toBe(true);
  // A misbehaving transport can still finish after cancellation; the generation
  // check must prevent it from restoring data for the forgotten credential.
  pending[1].resolve({ ok: true, json: async () => ({ authentication: { status: "ready" }, requests: {}, models: [], budgets: [], recentErrors: [] }) });
  await new Promise(resolve => setImmediate(resolve));
  expect(element("ready").textContent).toBe("Unavailable");
  pending[2].resolve({ ok: false, status: 401 });
  await new Promise(resolve => setImmediate(resolve));
  expect(element("message").textContent).toContain("Enter your proxy API key");
});

it("loads history without probing models, then sends only the explicitly selected model", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const app = createApp();
  const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status"))).json();
  app.close();
  status.models = ["claude-sonnet", "claude-opus"];
  status.sources.labels["192.0.2.30"] = "Production host · example-app (prod)";
  const elements = new Map<string, any>();
  const node = () => ({ textContent: "", value: "", disabled: false, checked: false, children: [] as any[], listeners: {} as Record<string, Function>, setAttribute() {}, focus() {}, addEventListener(event: string, callback: Function) { this.listeners[event] = callback; }, dataset: {} as Record<string, string>, querySelectorAll() { return []; }, replaceChildren(...children: any[]) { this.children = children; }, append(child: any) { this.children.push(child); } });
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  element("activity-range").value = "24h"; element("activity-page-size").value = "20"; element("activity-filter").value = "all";
  const calls: { url: string; options: any }[] = [];
  const fetch = async (url: string, options: any) => {
    calls.push({ url, options });
    if (url.startsWith("/v1/proxy/status")) return { ok: true, json: async () => status };
    if (url === "/v1/proxy/checks") return { ok: true, json: async () => ({ listeners: [], listenerInspection: "unavailable", registeredModels: 2, authentication: { status: "starting" } }) };
    if (url === "/v1/proxy/model-check") return { ok: true, status: 200, json: async () => ({ model: "claude-sonnet", servedModel: "claude-sonnet", identity: "Unknown version", status: 200 }) };
    throw new Error("Unexpected URL");
  };
  const context = createContext({ document: { getElementById: element, hidden: false, createElement: node }, fetch, AbortController, AbortSignal, URLSearchParams, setInterval: () => 0, setTimeout });
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  await new Promise(resolve => setImmediate(resolve));
  expect(calls.every(call => call.options.method !== "POST")).toBe(true);
  expect(element("database-size").textContent).toContain("retention unlimited");
  const checkbox = element("model-check-rows").children[0].children[0].children[0];
  checkbox.checked = true; checkbox.listeners.change();
  await element("test-models").listeners.click();
  const posted = calls.filter(call => call.options.method === "POST");
  expect(posted).toHaveLength(1);
  expect(JSON.parse(posted[0].options.body)).toEqual({ model: "claude-sonnet", kind: "identity" });
  expect(element("model-test-status").textContent).toContain("Unknown version");
});
