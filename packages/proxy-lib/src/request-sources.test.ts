import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HttpActivity } from "./http-activity.js";
import { RequestSources, sourceAddress } from "./request-sources.js";
import { createApp } from "./index.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("canonicalizes real IP addresses without retaining arbitrary client strings", () => {
  expect(sourceAddress("::ffff:100.64.0.2")).toBe("100.64.0.2");
  expect(sourceAddress("::ffff:6440:2")).toBe("100.64.0.2");
  expect(sourceAddress("2001:0DB8:0:0::1")).toBe("2001:db8::1");
  expect(sourceAddress("fe80::1%eth0")).toBe("fe80::1");
  expect(sourceAddress("private-hostname-or-key")).toBe("unknown");
});

it("persists source rankings and errors once across restart, separately from self-checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-sources-"));
  const store = new RequestSources(dir), activity = new HttpActivity(store);
  const complete = activity.begin("POST", "/v1/chat/completions", false, "::ffff:100.64.0.2")!;
  complete.chat("claude-sonnet", true); complete.result(429); complete.output(123); complete(200); complete(500);
  activity.begin("GET", "/v1/models", false, "100.64.0.2")!(200);
  for (let i = 0; i < 4; i++) activity.begin("GET", "/health/live", true, "100.64.0.3")!(200);
  activity.begin("POST", "/secret-path", false, "100.64.0.2")!(499);
  store.flush();
  const restored = new RequestSources(dir).snapshot();
  expect(restored.persistent).toBe(true);
  expect(restored.systems[0]).toMatchObject({ address: "100.64.0.2", total: 3, applicationRequests: 3, chats: 1, failed: 1, cancelled: 1, responseBytes: 123 });
  expect(restored.systems[1]).toMatchObject({ address: "100.64.0.3", applicationRequests: 0, selfChecks: 4 });
  expect(restored.recent).toHaveLength(7);
  expect(readFileSync(join(dir, "request-sources.json"), "utf8")).not.toContain("secret-path");
});

it("uses transport context and ignores forged forwarding or system-name headers", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const app = createApp();
  try {
    const req = () => new Request("http://localhost/v1/models", { headers: { "x-forwarded-for": "100.64.99.99", "x-real-ip": "100.64.99.99", "x-client-name": "private-client-name" } });
    await (await app.fetch(req(), { remoteAddress: "100.64.0.4" })).text();
    await (await app.fetch(req())).text();
    const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status"))).json();
    expect(status.sources.systems.map((row: any) => row.address).sort()).toEqual(["100.64.0.4", "unknown"]);
    expect(JSON.stringify(status.sources)).not.toMatch(/100\.64\.99\.99|private-client-name/);
  } finally { app.close(); }
});

it("bounds history and systems and expires inactive sources", () => {
  const activity = new HttpActivity();
  for (let i = 0; i < 600; i++) activity.begin("GET", "/v1/models", false, `10.0.${Math.floor(i / 256)}.${i % 256}`)!(200);
  expect(activity.sources.snapshot().systems).toHaveLength(512);
  expect(activity.sources.snapshot().recent).toHaveLength(500);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 24 * 60 * 60_000);
  expect(activity.sources.snapshot().systems).toHaveLength(0);
  expect(activity.sources.snapshot().recent).toHaveLength(0);
});

it("treats corrupt storage and failed persistence as diagnostic errors rather than failed requests", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-sources-invalid-"));
  writeFileSync(join(dir, "request-sources.json"), "{broken");
  expect(new RequestSources(dir).snapshot().error).toContain("could not be loaded");
  const file = join(dir, "not-a-directory"); writeFileSync(file, "fixture");
  const store = new RequestSources(file), activity = new HttpActivity(store);
  expect(() => activity.begin("GET", "/v1/models", false, "127.0.0.1")!(200)).not.toThrow();
  store.flush();
  expect(store.snapshot().error).toContain("could not be saved");
  expect(activity.snapshot().failed).toBe(0);
});
