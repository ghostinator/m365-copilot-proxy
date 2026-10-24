import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./index.js";
import { activePriorityAccessExhaustion, notePriorityAccessExhausted, resetPriorityAccessState } from "@m365-copilot/core";

afterEach(() => { vi.unstubAllEnvs(); resetPriorityAccessState(); });

it("protects operator data with the API key and never injects credentials into the page", async () => {
  vi.stubEnv("M365_API_KEY", "secret-for-dashboard-test");
  const app = createApp();
  try {
    const page = await app.fetch(new Request("http://localhost/dashboard"));
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).not.toContain("secret-for-dashboard-test");
    expect((await app.fetch(new Request("http://localhost/v1/proxy/status"))).status).toBe(401);
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
