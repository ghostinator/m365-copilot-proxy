import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, modelCapabilities, validateBind } from "./index.js";
afterEach(() => vi.unstubAllEnvs());
describe("HTTP boundary", () => {
  it("keeps liveness separate from readiness without authenticating", async () => {
    const app = createApp();
    expect((await app.fetch(new Request("http://localhost/health/live"))).status).toBe(200);
    expect((await app.fetch(new Request("http://localhost/health/ready"))).status).toBe(503);
  });
  it("rejects unauthenticated requests and foreign browser origins before reaching M365", async () => {
    vi.stubEnv("M365_API_KEY", "test-proxy-key");
    const app = createApp();
    expect((await app.fetch(new Request("http://localhost/v1/models"))).status).toBe(401);
    expect((await app.fetch(new Request("http://localhost/v1/models", { headers: { authorization: "Bearer test-proxy-key" } }))).status).toBe(200);
    expect((await app.fetch(new Request("http://localhost/v1/models", { headers: { origin: "https://evil.example", authorization: "Bearer test-proxy-key" } }))).status).toBe(403);
    vi.stubEnv("M365_ALLOWED_ORIGINS", "https://allowed.example");
    const allowed = await app.fetch(new Request("http://localhost/v1/models", { headers: { origin: "https://allowed.example", authorization: "Bearer test-proxy-key" } }));
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
  });
  it("allows keyless network binding and derives reasoning from the resolved tone", () => {
    vi.stubEnv("M365_API_KEY", "");
    expect(() => validateBind("0.0.0.0")).not.toThrow();
    expect(() => validateBind("192.0.2.10")).not.toThrow();
    expect(() => validateBind("127.0.0.1")).not.toThrow();
    expect(modelCapabilities("gpt-5.5-think-deeper").reasoning).toBe(true);
    expect(modelCapabilities("gpt-5.5-quick").reasoning).toBe(false);
  });
  it("accepts network-address requests without a key when none is configured", async () => {
    vi.stubEnv("M365_API_KEY", "");
    const app = createApp();
    try {
      const response = await app.fetch(new Request("http://192.0.2.10:4141/v1/models"));
      expect(response.status).toBe(200);
    } finally { app.close(); }
  });
  it("bounds request bodies before creating an upstream session", async () => {
    vi.stubEnv("M365_MAX_REQUEST_BYTES", "64");
    vi.stubEnv("M365_API_KEY", "");
    const app = createApp();
    const response = await app.fetch(new Request("http://localhost/v1/chat/completions", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(128) }] }) }));
    expect(response.status).toBe(413);
  });
});
