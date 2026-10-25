// Offline installed-runtime test. Isolated data, loopback listener, no Microsoft traffic.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const root = resolve(import.meta.dirname, ".."), launcher = resolve(process.argv[2] || join(root, "packages/proxy/bin/m365-proxy.mjs"));
const data = mkdtempSync(join(tmpdir(), "m365-operator-runtime-"));
const reservation = createServer(); await new Promise(r => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port; await new Promise(r => reservation.close(r));
const base = `http://127.0.0.1:${port}`;
writeFileSync(join(data, "server.json"), JSON.stringify({ host: "127.0.0.1", port }));
const env = { ...process.env, M365_DATA_DIR: data, M365_CACHE_FILE: join(data, "cache.json"), M365_SECRETS_FILE: join(data, "absent.json"), M365_API_KEY: "", M365_NO_INTERACTIVE: "1", M365_ENABLE_INTERACTIVE_APPROVAL: "0", M365_FORCE_AGENT: "0", M365_SERVICE_RESTARTS: "0" };
for (const key of ["HOST", "NITRO_HOST", "NITRO_PORT", "PORT", "NODE_PATH", "NITRO_UNIX_SOCKET", "M365_ALLOWED_ORIGINS", "M365_DEBUG", "M365_DUMP_FRAMES"]) delete env[key];
env.NODE_OPTIONS = `--import=${pathToFileURL(join(root, "scripts/fixtures/chat-loader.mjs")).href}`;
const command = async (...args) => (await promisify(execFile)(process.execPath, [launcher, ...args], { env, windowsHide: true, timeout: 30_000 })).stdout;
const child = spawn(process.execPath, [launcher, "serve"], { env, cwd: data, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; child.stdout.on("data", d => logs += d); child.stderr.on("data", d => logs += d);
async function ready(newPid) {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(base + "/v1/proxy/status", { signal: AbortSignal.timeout(1500) });
      if (r.ok) { const status = await r.json(); if ((!newPid || status.instance.pid !== newPid) && status.authentication.status === "ready") return status; }
    } catch {}
    await delay(200);
  }
  throw new Error(`Runtime did not become ready: ${logs.slice(-4000)}`);
}
let backupId;
try {
  const before = await ready(); assert.equal(before.service.available, true);
  await (await fetch(base + "/v1/models")).text();
  const grant = JSON.parse(await command("operator", "authorize"));
  assert(!readFileSync(join(data, "operator-access.json"), "utf8").includes(grant.token));
  const operator = async (value, headers = {}) => fetch(base + "/v1/proxy/operator", { method: "POST", headers: { origin: base, "content-type": "application/json", "x-m365-operator": grant.token, ...headers }, body: JSON.stringify(value) });
  assert.equal((await operator({ action: "key-create", label: "rejected" }, { origin: "https://untrusted.example" })).status, 403);
  assert.equal((await operator({ action: "unlock" }, { "x-m365-operator": "" })).status, 403);
  const created = await operator({ action: "key-create", label: "Dashboard app" }); assert.equal(created.status, 201);
  const key = await created.json(); assert(key.token);
  const metadata = await (await fetch(base + "/v1/proxy/status")).json();
  assert.equal(metadata.apiKeys.required, false); assert(!JSON.stringify(metadata).includes(key.token));
  await (await fetch(base + "/v1/models", { headers: { authorization: `Bearer ${key.token}` } })).text();
  assert.equal((await operator({ action: "key-rename", id: key.id, label: "Renamed" })).status, 200);
  assert.equal((await operator({ action: "key-revoke", id: key.id })).status, 200);
  const service = await operator({ action: "status" }); assert.equal(service.status, 200);
  assert.equal((await service.json()).available, true);
  const jsonJob = await operator({ action: "export-create", format: "json", query: { range: "all", limit: 1, offset: 999 } });
  assert.equal(jsonJob.status, 200); const download = await jsonJob.json();
  assert(download.snapshot.records > 1);
  const exported = await (await fetch(base + download.url)).json();
  assert.equal(exported.records.length, download.snapshot.records);
  assert.equal((await fetch(base + download.url)).status, 404);
  const csvJob = await (await operator({ action: "export-create", format: "csv", query: { range: "all" } })).json();
  const csv = await fetch(base + csvJob.url); assert.match(csv.headers.get("content-type"), /text\/csv/); assert.match(await csv.text(), /receivedAt/);
  const backup = await operator({ action: "backup-create" }); assert.equal(backup.status, 201);
  const saved = await backup.json(); backupId = saved.id; assert(saved.verified);
  const plan = await (await operator({ action: "backup-verify", id: backupId })).json(); assert.equal(plan.applied, false); assert.equal(plan.backup.verified, true);
  await assert.rejects(command("history", "restore", backupId, "--apply", "--confirm", backupId), /Stop the proxy/);
  console.log("PASS: complete JSON/CSV downloads, one-use capabilities, verified online backups and live-restore refusal (offline)");
  // Exercise the actual detached handoff and watchdog, using the inherited offline fixture.
  const restart = await operator({ action: "restart" }); assert.equal(restart.status, 202); await restart.text();
  const after = await ready(before.instance.pid); assert.notEqual(after.instance.id, before.instance.id);
  assert.equal(after.apiKeys.required, false); assert.equal(after.apiKeys.keys[0].label, "Renamed"); assert(after.apiKeys.keys[0].revokedAt);
  assert(after.sources.storage.storedRecords >= metadata.sources.storage.storedRecords);
  assert.equal((await fetch(base + "/v1/models")).status, 200);
  console.log("PASS: standalone operator grants, origin isolation, key management, service inspection, real restart and saved history (offline)");
} finally {
  // Only this temporary directory's nonce-protected instance can be stopped.
  if (existsSync(join(data, "instance.json"))) {
    const instance = JSON.parse(readFileSync(join(data, "instance.json"), "utf8"));
    writeFileSync(join(data, `shutdown-${instance.nonce}`), "stop");
    for (let i = 0; i < 80 && existsSync(join(data, "instance.json")); i++) await delay(100);
    assert(!existsSync(join(data, "instance.json")), `Temporary runtime did not stop: ${data}`);
  }
  if (child.exitCode === null) child.kill();
}

// Offline restore only after the instance has fully stopped; preserve keys/configuration.
const originalConfig = readFileSync(join(data, "server.json"), "utf8"), originalKeys = readFileSync(join(data, "proxy-api-keys.json"), "utf8");
const restored = JSON.parse(await command("history", "restore", backupId, "--apply", "--confirm", backupId));
assert(restored.applied && restored.safetyBackup);
assert.equal(readFileSync(join(data, "server.json"), "utf8"), originalConfig);
assert.equal(readFileSync(join(data, "proxy-api-keys.json"), "utf8"), originalKeys);
assert((JSON.parse(await command("history", "verify", restored.safetyBackup))).verified);
writeFileSync(join(data, "history-maintenance.lock"), "offline fixture");
try { await assert.rejects(command("serve"), /maintenance/); assert(!existsSync(join(data, "instance.json"))); }
finally { rmSync(join(data, "history-maintenance.lock")); }
console.log("PASS: explicit offline CLI restore, safety snapshot, configuration preservation and startup maintenance interlock");
