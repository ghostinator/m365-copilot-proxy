import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { OperatorAccess } from "./operator-access.js";
import { operatorAction } from "./operator-actions.js";
import { HttpActivity } from "./http-activity.js";
import { ApiKeyStore } from "./api-keys.js";
const password = "test administrator password";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m365-admin-")); let now = 100_000;
  const access = new OperatorAccess(dir, () => now), keys = new ApiKeyStore(dir), activity = new HttpActivity();
  const req = (value: unknown, token = "", origin = "http://localhost") => new Request("http://localhost/v1/proxy/operator", { method: "POST", headers: { origin, "content-type": "application/json", "x-m365-operator": token }, body: JSON.stringify(value) });
  return { dir, access, keys, activity, req, at: (at: number) => now = at, call: (value: unknown, token = "", origin?: string) => operatorAction(req(value, token, origin), activity, access, keys) };
}
it("requires an existing grant for setup and never gives application keys management access", async () => {
  const f = fixture();
  expect((await f.call({ action: "admin-password", password })).status).toBe(403);
  const app = f.keys.create("App"); expect((await f.call({ action: "admin-password", password }, app.token)).status).toBe(403);
  const grant = f.access.grant(); expect((await f.call({ action: "admin-password", password: "short" }, grant.token)).status).toBe(400);
  expect((await f.call({ action: "admin-password", password }, grant.token)).status).toBe(200);
  expect(f.keys.status().required).toBe(false);
  expect(readFileSync(join(f.dir, "operator-password.json"), "utf8")).not.toContain(password);
});
it("signs in remotely, persists hashed sessions across restart and expires/revokes them", async () => {
  const f = fixture(); await f.access.password.set(password);
  const response = await f.call({ action: "admin-login", password }); expect(response.status).toBe(200); const session = await response.json();
  expect(f.access.allows(f.req({ action: "unlock" }, session.token))).toBe(true);
  expect(new OperatorAccess(f.dir, () => 100_001).allows(f.req({}, session.token))).toBe(true);
  expect(readFileSync(join(f.dir, "operator-password.json"), "utf8")).not.toContain(session.token);
  expect((await f.call({ action: "unlock" }, session.token, "http://foreign.invalid")).status).toBe(403);
  expect((await f.call({ action: "admin-logout" }, session.token)).status).toBe(200);
  expect((await f.call({ action: "unlock" }, session.token)).status).toBe(403);
  const next = await (await f.call({ action: "admin-login", password })).json(); f.at(100_000+12*60*60_000);
  expect(f.access.allows(f.req({}, next.token))).toBe(false);
});
it("invalidates every session when password changes and preserves host recovery", async () => {
  const f = fixture(); await f.access.password.set(password);
  const first = await (await f.call({ action: "admin-login", password })).json(), second = await (await f.call({ action: "admin-login", password })).json();
  expect((await f.call({ action: "admin-password", password: "replacement administrator password" }, first.token)).status).toBe(200);
  expect(f.access.allows(f.req({}, first.token))).toBe(false); expect(f.access.allows(f.req({}, second.token))).toBe(false);
  expect((await f.call({ action: "admin-login", password })).status).toBe(403);
  const grant = f.access.grant(); expect((await f.call({ action: "admin-password", password }, grant.token)).status).toBe(200);
  const third = await (await f.call({ action: "admin-login", password })).json();
  expect((await f.call({ action: "admin-revoke" }, third.token)).status).toBe(200); expect(f.access.allows(f.req({}, third.token))).toBe(false);
});
it("bounds login hashing and rejects cross-origin login before credentials are checked", async () => {
  const f = fixture(); await f.access.password.set(password);
  expect((await f.call({ action: "admin-login", password }, "", "http://foreign.invalid")).status).toBe(403);
  for (let i=0;i<5;i++) expect((await f.call({ action: "admin-login", password: "incorrect" })).status).toBe(403);
  expect((await f.call({ action: "admin-login", password })).status).toBe(429);
  f.at(160_001); expect((await f.call({ action: "admin-login", password })).status).toBe(200);
});

it("allows only one password verification at a time", async () => {
  const f = fixture(); await f.access.password.set(password);
  const first = f.access.password.login(password);
  expect(await f.access.password.login(password)).toEqual({ limited: true });
  expect(await first).toHaveProperty("token");
});
