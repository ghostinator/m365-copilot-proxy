import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./index.js";
import { activePriorityAccessExhaustion, notePriorityAccessExhausted, resetPriorityAccessState } from "@m365-copilot/core";
import { createContext, runInContext } from "node:vm";
import { dashboardResponse } from "./dashboard.js";

afterEach(() => { vi.unstubAllEnvs(); resetPriorityAccessState(); });

it("renders chart data, request timelines and check comparisons safely and clears them when forgetting access", async () => {
  const elements = new Map<string, any>();
  const node = () => ({
    textContent: "", value: "", children: [] as any[], style: {} as Record<string, string>,
    dataset: {} as Record<string, string>, listeners: {} as Record<string, Function>,
    attributes: {} as Record<string, string>, setAttribute(key: string, value: string) { this.attributes[key] = value; },
    focus() {}, querySelectorAll() { return []; },
    addEventListener(event: string, callback: Function) { this.listeners[event] = callback; },
    replaceChildren(...children: any[]) { this.children = children; },
    append(...children: any[]) { this.children.push(...children); },
  });
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const context = createContext({ document: { getElementById: element, createElement: node }, fetch: () => new Promise(() => {}), AbortController, AbortSignal, URLSearchParams, clearTimeout, setTimeout, setInterval: () => 0 });
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  const performance = { total: 2, successRate: .5, failed: 1, cancelled: 0, p50Ms: 100, p95Ms: 300, firstByteMs: 20, firstByteSamples: 1, queueMs: 0, queueSamples: 1, buckets: [{ at: Date.now(), total: 2, succeeded: 1, failed: 1, cancelled: 0, durationMs: 200, firstByteMs: 20, queueMs: 0 }] };
  runInContext('renderPerformance('+JSON.stringify(performance)+')', context);
  expect(element("performance-summary").textContent).toContain("50.0% success");
  expect(element("performance-latency").textContent).toContain("p95 300 ms");
  expect(element("performance-data").children).toHaveLength(1);
  element("performance-metric").value = "successRate";
  element("performance-metric").listeners.change();
  expect(element("performance-chart").children[0].style.height).toBe("50%");
  runInContext('renderStoragePlanning('+JSON.stringify({ growth: { freeBytes: 1_048_576, capacityBytes: 2_097_152, logicalBytes: 4096,
    records: 40, bytesPerRecord: 102.4, status: "estimate", bytesPerDay: 2048, bytesPer30Days: 61440, bytesPer365Days: 747520,
    recentRequests: 40, observedMs: 2 * 86400000, requestsPerDay: 20 } })+')', context);
  expect(element("storage-capacity").textContent).toContain("1.00 MiB available");
  expect(element("storage-growth").textContent).toContain("Estimated activity growth");
  expect(element("storage-sample").textContent).toContain("20.0 requests/day");
  const observations = { total: 2, succeeded: 1, failed: 1, cancelled: 0, successRate: .5, averageDurationMs: 200, p95Ms: 300 };
  runInContext('renderReliability('+JSON.stringify({ current: observations, previous: null, from: null, to: Date.now(), routeLimit: 100, routeCount: 1,
    routes: [{ model: "<img src=x>", servedModel: null, current: observations, previous: null, changePoints: null }],
    buckets: [{ at: Date.now(), ...observations }], bucketMs: 60000 })+')', context);
  expect(element("reliability-routes").children[0].children[0].textContent).toBe("<img src=x> → unknown");
  expect(element("reliability-summary").textContent).toContain("limited sample");
  expect(element("reliability-chart").children[0].style.height).toBe("50%");
  expect(element("reliability-period").textContent).toContain("Choose a rolling range");
  const report = { seq: 1, checkedAt: Date.now(), model: "claude-sonnet", kind: "function-tool", verdict: "passed", durationMs: 100, status: 200, evidence: "<img src=x>", previousVerdict: "failed", previousServedModel: "m365-copilot" };
  runInContext('renderCheckHistory('+JSON.stringify({ total: 2, offset: 0, limit: 1, summary: [], reports: [report] })+')', context);
  const evidence = element("check-history-records").children[0].children[0].children[1].textContent;
  expect(evidence).toContain("Previous stored sample: failed");
  expect(evidence).toContain("Evidence: <img src=x>");
  expect(element("check-next").disabled).toBe(false);
  runInContext("sourceRecords=[{id:'example',address:'192.0.2.20',durationMs:50,firstByteMs:20,timeline:[{atMs:0,phase:'received'},{atMs:50,phase:'completed'}]}];renderSourceHistory()", context);
  expect(element("source-history").children[0].children[0].children[1].textContent).toContain("+50 ms · completed");
  runInContext("clearStatus('Unavailable')", context);
  expect(element("check-history-records").children).toHaveLength(0);
  expect(element("performance-chart").children).toHaveLength(0);
  expect(element("storage-capacity").textContent).toBe("Storage planning unavailable");
  expect(element("reliability-chart").children).toHaveLength(0);
  expect(element("reliability-routes").children).toHaveLength(0);
  expect(element("source-history").children).toHaveLength(0);
});

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
  const context = createContext({ document: { getElementById: element }, fetch: () => new Promise(() => {}), location, AbortController, AbortSignal, URLSearchParams, clearTimeout, setTimeout, setInterval: () => 0 });
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

it("uses one persistent request list with live rows pinned, server paging and complete-history filters", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const app = createApp();
  for (let index = 0; index < 25; index++) await (await app.fetch(new Request("http://localhost/v1/models"))).text();
  for (let index = 0; index < 4; index++) await (await app.fetch(new Request("http://localhost/v1/models", { headers: { "x-m365-check": "1" } }))).text();
  await (await app.fetch(new Request("http://localhost/unknown"))).text();
  const elements = new Map<string, any>();
  const node = () => ({ textContent: "", value: "", disabled: false, children: [] as any[], style: {}, dataset: {}, listeners: {} as Record<string, Function>, setAttribute() {}, focus() {}, querySelectorAll() { return []; }, addEventListener(event: string, callback: Function) { this.listeners[event] = callback; }, replaceChildren(...children: any[]) { this.children = children; }, append(...children: any[]) { this.children.push(...children); } });
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  element("history-size").value = "20"; element("activity-filter").value = "all";
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    if (url === "/v1/proxy/checks") return { ok: true, json: async () => ({ listeners: [], registeredModels: 0, authentication: { status: "starting" } }) };
    return app.fetch(new Request("http://localhost" + url));
  };
  const context = createContext({ document: { getElementById: element, hidden: false, createElement: node }, fetch, AbortController, AbortSignal, URLSearchParams, clearTimeout, setTimeout, setInterval: () => 0 });
  const page = await dashboardResponse("/dashboard")!.text();
  expect(page).not.toContain('id="http-events"');
  expect(page).not.toContain('Saved request history</h2>');
  expect(page).toContain('aria-label="Live and saved requests"');
  runInContext(await dashboardResponse("/dashboard-script")!.text(), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  expect(element("source-history").children).toHaveLength(20);
  expect(element("history-page").textContent).toContain("1–20 of 30");
  element("history-next").listeners.click(); await settle();
  expect(element("source-history").children).toHaveLength(10);
  expect(element("history-page").textContent).toContain("21–30 of 30");
  expect(urls.at(-1)).toContain("offset=20");
  element("history-size").value = "50"; element("history-size").listeners.change(); await settle();
  expect(element("source-history").children).toHaveLength(30);
  element("activity-filter").value = "checks"; element("activity-filter").listeners.change(); await settle();
  expect(element("source-history").children).toHaveLength(4);
  expect(element("history-page").textContent).toContain("of 4");
  expect(urls.at(-1)).toContain("requestKind=checks");
  element("activity-filter").value = "all";
  const live = { id: "live-example", receivedAt: new Date().toISOString(), phase: "queued", outcome: "pending", method: "POST", endpoint: "/v1/chat/completions", clientAddress: "192.0.2.20", source: "application" };
  runInContext('liveRecords='+JSON.stringify([live])+';renderSourceHistory()', context);
  expect(element("source-history").children).toHaveLength(5);
  expect(element("source-history").children[0].children[0].children[0].textContent).toContain("LIVE · queued");
  expect(element("request-summary").textContent).toContain("1 waiting in queue");
  app.close();
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
  const context = createContext({ document: { getElementById: element, hidden: false, createElement: () => ({}) }, fetch: (_url: string, options: { signal: AbortSignal }) => new Promise(resolve => pending.push({ resolve, signal: options.signal })), AbortController, AbortSignal, URLSearchParams, clearTimeout, setTimeout, setInterval: () => 0 });
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
  const node = () => ({ textContent: "", value: "", disabled: false, checked: false, children: [] as any[], style: {} as Record<string,string>, listeners: {} as Record<string, Function>, setAttribute() {}, focus() {}, addEventListener(event: string, callback: Function) { this.listeners[event] = callback; }, dataset: {} as Record<string, string>, querySelectorAll() { return []; }, replaceChildren(...children: any[]) { this.children = children; }, append(child: any) { this.children.push(child); } });
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
  const context = createContext({ document: { getElementById: element, hidden: false, createElement: node }, fetch, AbortController, AbortSignal, URLSearchParams, clearTimeout, setTimeout, setInterval: () => 0, setTimeout });
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
