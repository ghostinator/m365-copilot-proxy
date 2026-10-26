import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { ApiKeyStore } from "./api-keys.js";
import { callerIdentity, corsHeaders, requestGate } from "./http-policy.js";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep + "m365-client-auth-")).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  }
});
function requiredKey() {
  vi.stubEnv("M365_API_KEY", "");
  const directory = mkdtempSync(join(tmpdir(), "m365-client-auth-")); directories.push(directory);
  const store = new ApiKeyStore(directory), key = store.create("Messages test client");
  store.mode(true);
  return { store, key };
}

describe("client protocol authentication", () => {
  it("authenticates and attributes Messages x-api-key with the existing key policy", () => {
    const { store, key } = requiredKey(), headers = new Headers({ "x-api-key": key.token });
    expect(store.authorize(headers)).toEqual({ allowed: true, application: { id: key.id, label: key.label } });
    expect(requestGate(new Request("http://localhost/v1/messages", { method: "POST", headers }), store)).toBeNull();
  });
  it("uses one caller identity for the same bearer credential in either protocol", () => {
    const { key } = requiredKey();
    expect(callerIdentity(new Headers({ "x-api-key": key.token })))
      .toBe(callerIdentity(new Headers({ authorization: `Bearer ${key.token}` })));
    expect(callerIdentity(new Headers({ "x-api-key": key.token })))
      .not.toBe(callerIdentity(new Headers({ "x-api-key": "different" })));
  });
  it.each(["Bearer wrong", ""])("keeps explicit Authorization precedence (%j)", authorization => {
    const { store, key } = requiredKey();
    const request = new Request("http://localhost/v1/messages", { headers: { authorization, "x-api-key": key.token } });
    expect(requestGate(request, store)?.status).toBe(401);
  });
  it("retains origin checks and permits only declared client request headers", () => {
    const { store, key } = requiredKey();
    expect(requestGate(new Request("http://localhost/v1/messages", { headers: { "x-api-key": key.token, origin: "https://untrusted.example" } }), store)?.status).toBe(403);
    const headers = corsHeaders(new Request("http://localhost/v1/messages", { headers: { origin: "http://localhost" } }));
    const allowed = headers["Access-Control-Allow-Headers"].toLowerCase();
    expect(allowed).toContain("x-api-key"); expect(allowed).toContain("anthropic-version");
    expect(allowed).toContain("anthropic-beta");
  });
});
