import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ApiKeyStore, proxyApiKeys } from "./api-keys.js";
import { requestGate } from "./http-policy.js";
import { createApp } from "./index.js";
import { diagnosticText } from "./error-diagnostics.js";
import { ActivityDatabase } from "./activity-database.js";
import { activityQuery, entry } from "./activity-schema.js";
import { randomUUID } from "node:crypto";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const headers = (token?: string) => new Headers(token ? { authorization: "Bearer " + token } : {});
const temporary = () => mkdtempSync(join(tmpdir(), "m365-application-keys-"));

it("creates independent named keys, retains only digests, and leaves keyless access optional", () => {
  vi.stubEnv("M365_API_KEY", "");
  const store = new ApiKeyStore(temporary()), first = store.create("Production app"), second = store.create("Development app");
  expect(first.token).not.toBe(second.token);
  expect(store.authorize(headers(first.token))).toMatchObject({ allowed: true, application: { id: first.id, label: "Production app" } });
  expect(store.authorize(headers(second.token)).application?.id).toBe(second.id);
  expect(store.authorize(headers())).toEqual({ allowed: true, application: null });
  expect(store.authorize(headers("placeholder"))).toEqual({ allowed: true, application: null });
  const disk = readFileSync(store.path, "utf8"), metadata = JSON.stringify(store.status());
  expect(disk).not.toContain(first.token);
  expect(disk).not.toContain(second.token);
  expect(metadata).not.toMatch(/hash|m365_/);
  expect(diagnosticText("Failure with " + first.token)).not.toContain(first.token);
});

it("requires keys only on explicit selection, supports the legacy key and applies revoke/rename without restart", () => {
  vi.stubEnv("M365_API_KEY", "");
  const store = new ApiKeyStore(temporary());
  expect(() => store.mode(true)).toThrow("Create an application key");
  const first = store.create("First"), second = store.create("Second");
  store.mode(true);
  const req = (token?: string) => new Request("http://localhost/v1/models", { headers: headers(token) });
  expect(requestGate(req(), store)?.status).toBe(401);
  expect(requestGate(req("invalid"), store)?.status).toBe(401);
  expect(requestGate(req(first.token), store)).toBeNull();
  store.rename(first.id, "Renamed");
  expect(new ApiKeyStore(dirname(store.path)).authorize(headers(first.token)).application?.label).toBe("Renamed");
  store.revoke(first.id);
  expect(requestGate(req(first.token), store)?.status).toBe(401);
  expect(requestGate(req(second.token), store)).toBeNull();
  vi.stubEnv("M365_API_KEY", "existing-legacy-token");
  expect(store.authorize(headers("existing-legacy-token")).application?.id).toBe("legacy");
  store.mode(false);
  expect(requestGate(req(), store)?.status).toBe(401); // Legacy configuration still requires a token.
  vi.stubEnv("M365_API_KEY", "");
  expect(requestGate(req(), store)).toBeNull();
  expect(store.authorize(headers(first.token))).toEqual({ allowed: true, application: null });
});

it("fails closed on corrupt key configuration and keeps origin checks for valid keys", () => {
  vi.stubEnv("M365_API_KEY", "");
  const store = new ApiKeyStore(temporary()), key = store.create("Example");
  expect(requestGate(new Request("http://localhost/v1/models", { headers: { authorization: "Bearer " + key.token, origin: "https://other.example" } }), store)?.status).toBe(403);
  writeFileSync(store.path, "{broken");
  expect(requestGate(new Request("http://localhost/v1/models"), store)?.status).toBe(503);
});

it("attributes two applications on one IP and exposes metadata without tokens in dashboard/history", async () => {
  vi.stubEnv("M365_API_KEY", "");
  const store = new ApiKeyStore(temporary()), first = store.create("Production"), second = store.create("Development");
  vi.spyOn(proxyApiKeys, "authorize").mockImplementation(value => store.authorize(value));
  vi.spyOn(proxyApiKeys, "status").mockImplementation(() => store.status());
  const app = createApp();
  try {
    for (const token of [first.token, second.token, first.token]) await (await app.fetch(new Request("http://localhost/v1/models", { headers: headers(token) }), { remoteAddress: "192.0.2.20" })).text();
    const status = await (await app.fetch(new Request("http://localhost/v1/proxy/status"))).json();
    expect(status.sources.keyActivity).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, label: "Production", requests: 2, systems: 1 }),
      expect.objectContaining({ id: second.id, label: "Development", requests: 1, systems: 1 }),
    ]));
    const selected = await (await app.fetch(new Request("http://localhost/v1/proxy/status?requestKey=" + second.id))).json();
    expect(selected.sources.history.total).toBe(1);
    expect(selected.sources.recent[0]).toMatchObject({ apiKeyId: second.id, apiKeyLabel: "Development" });
    expect(JSON.stringify(status)).not.toContain(first.token);
    expect(JSON.stringify(status)).not.toContain(second.token);
    expect(JSON.stringify(status.apiKeys)).not.toContain("hash");
  } finally { app.close(); }
});

it("migrates schema 4 without inventing attribution and saves key metadata across restart", () => {
  const directory = temporary(), original = new ActivityDatabase(directory), id = randomUUID();
  original.write([entry.parse({ id, address: "192.0.2.20", receivedAt: new Date().toISOString(), method: "GET", endpoint: "/v1/models", source: "application", status: 200, outcome: "success", durationMs: 10, responseBytes: 20, firstByteMs: 3 })]);
  original.db.exec("DROP INDEX requests_application_time; ALTER TABLE requests DROP COLUMN application_id; DROP TABLE request_applications; PRAGMA user_version=4");
  original.close();
  const upgraded = new ActivityDatabase(directory);
  const old = upgraded.snapshot(activityQuery.parse({}));
  expect(old.recent[0]).toMatchObject({ id, firstByteMs: 3, apiKeyId: null, apiKeyLabel: null });
  const key = new ApiKeyStore(directory).create("Production");
  upgraded.write([entry.parse({ ...old.recent[0], id: randomUUID(), apiKeyId: key.id, apiKeyLabel: key.label })]);
  upgraded.close();
  const reopened = new ActivityDatabase(directory);
  const selected = reopened.snapshot(activityQuery.parse({ requestKey: key.id }));
  expect(selected.history.total).toBe(1);
  expect(selected.recent[0]).toMatchObject({ apiKeyId: key.id, apiKeyLabel: "Production" });
  expect(reopened.db.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
  reopened.close();
});
