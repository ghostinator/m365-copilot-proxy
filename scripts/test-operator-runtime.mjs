// Offline installed-runtime test. Isolated data, loopback listener, no Microsoft traffic.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
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
const receivedNotifications = [];
const receiver = httpServer(async (req, res) => { let body = ""; for await (const part of req) body += part; receivedNotifications.push(req.headers["content-type"]?.startsWith("text/plain") ? { event: "ntfy-test", body, title: req.headers.title, deliveryId: req.headers["x-m365-delivery-id"] } : JSON.parse(body)); res.end(req.headers["content-type"]?.startsWith("text/plain") ? JSON.stringify({ id: "offline-id", event: "message", topic: req.url.slice(1) }) : "ok"); });
await new Promise(resolve => receiver.listen(0, "127.0.0.1", resolve));
const notificationUrl = `http://127.0.0.1:${receiver.address().port}/offline-test`;
writeFileSync(join(data, "server.json"), JSON.stringify({ host: "127.0.0.1", port, metricsEnabled: true }));
const env = { ...process.env, M365_DATA_DIR: data, M365_CACHE_FILE: join(data, "cache.json"), M365_SECRETS_FILE: join(data, "absent.json"), M365_API_KEY: "", M365_NO_INTERACTIVE: "1", M365_ENABLE_INTERACTIVE_APPROVAL: "0", M365_FORCE_AGENT: "0", M365_SERVICE_RESTARTS: "0" };
for (const key of ["HOST", "NITRO_HOST", "NITRO_PORT", "PORT", "NODE_PATH", "NITRO_UNIX_SOCKET", "M365_ALLOWED_ORIGINS", "M365_DEBUG", "M365_DUMP_FRAMES", "M365_METRICS"]) delete env[key];
env.M365_TEST_NOTIFICATION_URL = notificationUrl;
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
  assert.equal(before.alerts.settings.enabled, false, "alerts must be opt-in");
  assert.equal(before.alerts.running, true, "standalone background evaluator must be wired");
  await (await fetch(base + "/v1/models")).text();
  const beforeScrape = await (await fetch(base + "/v1/proxy/status")).json();
  assert.equal(beforeScrape.metrics.enabled, true, "server.json enables metrics only in this isolated fixture");
  const scrape = await fetch(base + "/v1/proxy/metrics"); assert.equal(scrape.status, 200);
  assert.match(scrape.headers.get("content-type"), /version=0.0.4/);
  const metrics = await scrape.text(); assert.match(metrics, /m365_proxy_http_duration_seconds_count/);
  assert(!metrics.includes("127.0.0.1"));
  const afterScrape = await (await fetch(base + "/v1/proxy/status")).json();
  assert.equal(afterScrape.activity.total, beforeScrape.activity.total);
  assert.equal(afterScrape.sources.storage.storedRecords, beforeScrape.sources.storage.storedRecords);
  assert(afterScrape.sources.storage.growth.logicalBytes > 0);
  const grant = JSON.parse(await command("operator", "authorize"));
  assert(!readFileSync(join(data, "operator-access.json"), "utf8").includes(grant.token));
  const operator = async (value, headers = {}) => fetch(base + "/v1/proxy/operator", { method: "POST", headers: { origin: base, "content-type": "application/json", "x-m365-operator": grant.token, ...headers }, body: JSON.stringify(value) });
  const administratorPassword = "offline administrator password";
  assert.equal((await operator({ action: "admin-password", password: administratorPassword })).status, 200);
  const adminResponse = await operator({ action: "admin-login", password: administratorPassword }, { "x-m365-operator": "" });
  assert.equal(adminResponse.status, 200); const adminSession = await adminResponse.json();
  assert.equal((await operator({ action: "unlock" }, { "x-m365-operator": adminSession.token })).status, 200);
  assert.equal((await operator({ action: "admin-login", password: administratorPassword }, { origin: "https://foreign.example", "x-m365-operator": "" })).status, 403);
  assert(!readFileSync(join(data, "operator-password.json"), "utf8").includes(administratorPassword));
  console.log("PASS: administrator password setup, remote login, hashed storage and origin isolation");
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
  const alertSettings = { ...before.alerts.settings, enabled: true };
  const configuredAlerts = await operator({ action: "alerts-configure", settings: alertSettings });
  assert.equal(configuredAlerts.status, 200);
  assert.equal((await configuredAlerts.json()).settings.enabled, true);
  assert.equal((await operator({ action: "alerts-configure", settings: { ...alertSettings, webhook: "https://unrequested.invalid" } })).status, 400);
  for (const type of ["postal", "sendgrid"]) {
    const config = { type, apiKey: "synthetic-provider-key", from: "sender@example.invalid", to: ["recipient@example.invalid"], ...(type === "postal" ? { url: "https://postal.example.invalid" } : { region: "eu" }) };
    const saved = await operator({ action: "notifications-save", destination: { label: "Offline " + type, config, rules: ["failures"], events: ["opened"] } });
    assert.equal(saved.status, 200); const state = await saved.json(), item = state.destinations.find(d => d.type === type);
    assert(item && !item.enabled && item.credentialConfigured); assert(!JSON.stringify(state).includes(config.apiKey)); assert(!JSON.stringify(state).includes("example.invalid"));
    const preview = await operator({ action: "notifications-preview", id: item.id }); assert.equal(preview.status, 200); assert.equal((await preview.json()).type, type);
    assert.equal((await operator({ action: "notifications-test", id: item.id, confirm: true })).status, 409);
    assert.equal((await operator({ action: "notifications-remove", id: item.id, confirm: true })).status, 200);
  }
  assert.equal(receivedNotifications.length, 0);
  console.log("PASS: Postal/SendGrid disabled save, private preview and test refusal without provider network I/O");
  const destination = { label: "Offline receiver", config: { type: "webhook", url: notificationUrl, format: "generic", allowHttp: true }, rules: ["failures"], events: ["opened", "resolved"] };
  const savedDestination = await (await operator({ action: "notifications-save", destination })).json();
  assert.equal(savedDestination.destinations[0].enabled, false);
  assert(!JSON.stringify(savedDestination).includes(notificationUrl));
  const destinationId = savedDestination.destinations[0].id;
  const preview = await (await operator({ action: "notifications-preview", id: destinationId })).json();
  assert.match(preview.message.text, /explicitly requested test/); assert.equal(receivedNotifications.length, 0);
  assert.equal((await operator({ action: "notifications-test", id: destinationId, confirm: true })).status, 409);
  await operator({ action: "notifications-enable", id: destinationId, enabled: true });
  assert.equal((await operator({ action: "notifications-test", id: destinationId, confirm: true })).status, 202);
  for (let i = 0; i < 80 && !receivedNotifications.length; i++) await delay(200);
  assert.equal(receivedNotifications.length, 1); assert.equal(receivedNotifications[0].event, "test");
  let deliveryState;
  for (let i = 0; i < 80; i++) {
    deliveryState = await (await operator({ action: "notifications-status", offset: 0 })).json();
    if (deliveryState.deliveries[0]?.status === "sent") break;
    await delay(100);
  }
  assert.equal(deliveryState.deliveries[0].status, "sent");
  await operator({ action: "notifications-enable", id: destinationId, enabled: false });
  console.log("PASS: disabled destination save/preview, explicit local-only queued test, private metadata and durable delivery history");
  const pushConfig = { type: "ntfy", url: new URL(notificationUrl).origin, topic: "offline-test", allowHttp: true, bearer: "synthetic-ntfy-token" };
  const pushSave = await operator({ action: "notifications-save", destination: { label: "Offline push", config: pushConfig, rules: ["storage"], events: ["opened"] } });
  assert.equal(pushSave.status, 200); const pushState = await pushSave.json(), push = pushState.destinations.find(d => d.type === "ntfy");
  assert(push && !push.enabled); assert(!JSON.stringify(pushState).includes(pushConfig.topic)); assert(!JSON.stringify(pushState).includes(pushConfig.bearer));
  assert.equal((await operator({ action: "notifications-preview", id: push.id })).status, 200);
  assert.equal(receivedNotifications.length, 1);
  assert.equal((await operator({ action: "notifications-test", id: push.id, confirm: true })).status, 409);
  assert.equal((await operator({ action: "notifications-enable", id: push.id, enabled: true })).status, 200);
  assert.equal((await operator({ action: "notifications-test", id: push.id, confirm: true })).status, 202);
  for (let i = 0; i < 80 && receivedNotifications.length < 2; i++) await delay(200);
  assert.equal(receivedNotifications.length, 2); const pushMessage = receivedNotifications[1];
  assert.equal(pushMessage.event, "ntfy-test"); assert.match(pushMessage.body, /explicitly requested test/); assert.equal(pushMessage.title, "M365 Proxy notification test"); assert(pushMessage.deliveryId);
  for (let i = 0; i < 80; i++) {
    deliveryState = await (await operator({ action: "notifications-status", offset: 0 })).json();
    if (deliveryState.counts.sent === 2) break; await delay(100);
  }
  assert.equal(deliveryState.counts.sent, 2); await operator({ action: "notifications-enable", id: push.id, enabled: false });
  console.log("PASS: ntfy disabled save/preview, explicit loopback-only push and private durable delivery history");
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
  const downloadJob = await operator({ action: "backup-download", id: backupId }); assert.equal(downloadJob.status, 200);
  const backupDownload = await downloadJob.json(); assert.match(backupDownload.url, /^\/v1\/proxy\/download\/b_[A-Za-z0-9_-]{43}$/);
  assert.equal((await fetch(base + backupDownload.url, { headers: { origin: "https://foreign.example" } })).status, 404);
  const downloaded = await fetch(base + backupDownload.url); assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get("content-type"), /sqlite/);
  const matchingManifest = Object.fromEntries(["version","id","createdAt","bytes","sha256","schema","requests","modelReports"].map(key=>[key,backupDownload.backup[key]]));
  assert.deepEqual(matchingManifest, JSON.parse(readFileSync(join(data,"history-backups",backupId+".json"),"utf8")));
  assert.equal(backupDownload.backup.id, backupId); assert.equal(backupDownload.backup.sha256, saved.sha256);
  assert.equal(downloaded.headers.get("content-disposition"), `attachment; filename="${backupId}.sqlite"`);
  const backupBytes = Buffer.from(await downloaded.arrayBuffer()); assert.equal(createHash("sha256").update(backupBytes).digest("hex"), saved.sha256);
  assert.equal(downloaded.headers.get("x-checksum-sha256"), saved.sha256); assert.equal((await fetch(base + backupDownload.url)).status, 404);
  console.log("PASS: verified binary backup download, exact checksum, foreign-origin refusal and one-use capability");
  const plan = await (await operator({ action: "backup-verify", id: backupId })).json(); assert.equal(plan.applied, false); assert.equal(plan.backup.verified, true);
  await assert.rejects(command("history", "restore", backupId, "--apply", "--confirm", backupId), /Stop the proxy/);
  console.log("PASS: complete JSON/CSV downloads, one-use capabilities, verified online backups and live-restore refusal (offline)");
  // Exercise the actual detached handoff and watchdog, using the inherited offline fixture.
  const restart = await operator({ action: "restart" }); assert.equal(restart.status, 202); await restart.text();
  const after = await ready(before.instance.pid); assert.notEqual(after.instance.id, before.instance.id);
  assert.equal(after.apiKeys.required, false); assert.equal(after.apiKeys.keys[0].label, "Renamed"); assert(after.apiKeys.keys[0].revokedAt);
  assert.equal(after.alerts.settings.enabled, true, "alert settings survive detached restart");
  assert.equal(after.alerts.running, true);
  assert.equal((await operator({ action: "unlock" }, { "x-m365-operator": adminSession.token })).status, 200);
  assert.equal((await operator({ action: "admin-revoke" }, { "x-m365-operator": adminSession.token })).status, 200);
  assert.equal((await operator({ action: "unlock" }, { "x-m365-operator": adminSession.token })).status, 403);
  console.log("PASS: administrator session survives restart and revokes immediately");
  assert.equal(after.notifications.configured, 2);
  assert.equal(after.notifications.enabled, 0);
  assert.equal(after.notifications.counts.sent, 2);
  assert.equal(after.metrics.enabled, true);
  assert.equal((await fetch(base + "/v1/proxy/metrics")).status, 200);
  assert.equal((await operator({ action: "alerts-configure", settings: { ...alertSettings, enabled: false } })).status, 200);
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
  await new Promise(resolve => receiver.close(resolve));
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
