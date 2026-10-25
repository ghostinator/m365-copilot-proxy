import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, "..");
async function statusJson(response) {
  const text = await response.text();
  assert(response.ok && text.length > 0, `Expected status JSON from ${response.url}; HTTP ${response.status}, ${text.length} bytes`);
  return JSON.parse(text);
}
async function start(authenticated, extra = {}) {
  const reserve = createServer(); await new Promise(r => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const dir = mkdtempSync(join(tmpdir(), "m365-startup-"));
  if (authenticated) {
    const account = createHash("sha256").update(JSON.stringify(["offline", "offline"])).digest("hex");
    writeFileSync(join(dir, `quota-observations-${account}.json`), JSON.stringify({ version: 1, budgets: { opus: { at: Date.now(), daily: 12, weekly: 30 } }, route: { at: Date.now(), requested: "claude-opus", served: "claude-opus-4.5" } }));
  }
  const env = { ...process.env, M365_DATA_DIR: dir, M365_CACHE_FILE: join(dir, "cache.json"), M365_SECRETS_FILE: join(dir, "absent.json"), M365_NO_INTERACTIVE: "1", M365_ENABLE_INTERACTIVE_APPROVAL: "0", M365_DEBUG: "", M365_TRACE: "", M365_LOG_STDOUT: "", M365_DUMP_FRAMES: "", M365_MAX_REQUEST_BYTES: "1024", ...extra };
  for (const key of ["HOST", "NITRO_HOST", "NITRO_PORT", "PORT", "NODE_OPTIONS", "NODE_PATH", "NITRO_UNIX_SOCKET", "M365_ALLOWED_ORIGINS"]) delete env[key];
  env.M365_FORCE_AGENT = "0";
  const args = authenticated ? ["--import", pathToFileURL(join(root, "scripts/fixtures/chat-loader.mjs")).href] : [];
  args.push(process.argv[2] || join(root, "packages/proxy/bin/m365-proxy.mjs"), String(port));
  const child = spawn(process.execPath, args, { cwd: dir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", d => { logs += d; }); child.stderr.on("data", d => { logs += d; });
  const exit = new Promise(r => child.once("exit", r));
  try {
    for (let i = 0; i < 100 && !logs.includes("Listening on") && child.exitCode === null; i++) await delay(100);
    if (!authenticated) {
      const code = await Promise.race([exit, delay(5000).then(() => "timeout")]);
      assert.equal(code, 78, logs);
      assert.match(logs, /Authentication failed/);
      console.log("PASS: missing credentials fail startup with configuration exit 78");
      return;
    }
    assert.match(logs, new RegExp(`Listening on http://127\\.0\\.0\\.1:${port}`), logs);
    const base = `http://127.0.0.1:${port}`;
    const dashboard = await fetch(base + "/dashboard");
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /M365 Copilot Proxy/);
    assert.equal((await fetch(base + "/dashboard-script")).status, 200);
    assert.equal((await fetch(base + "/v1/proxy/status")).status, extra.M365_API_KEY ? 401 : 200);
    const operator = await fetch(base + "/v1/proxy/status", { headers: extra.M365_API_KEY ? { authorization: `Bearer ${extra.M365_API_KEY}` } : {} });
    const operatorStatus = await statusJson(operator);
    assert.equal(operatorStatus.authentication.status, "ready");
    assert.equal(operatorStatus.budgets.find(b => b.id === "opus").allowance.daily, 12);
    assert.equal(operatorStatus.lastRoute.fallbackUsed, true);
    assert.equal((await fetch(base + "/health/ready")).status, 200);
    assert.equal((await fetch(base + "/health/live")).status, 200);
    assert.equal((await fetch(base + "/v1/models")).status, extra.M365_API_KEY ? 401 : 200);
    assert.equal((await fetch(base + "/v1/models", { headers: { origin: "https://untrusted.example" } })).status, 403);
    if (extra.M365_API_KEY) assert.equal((await fetch(base + "/v1/models", { headers: { authorization: `Bearer ${extra.M365_API_KEY}` } })).status, 200);
    const headers = { "content-type": "application/json", ...(extra.M365_API_KEY ? { authorization: `Bearer ${extra.M365_API_KEY}` } : {}) };
    await statusJson(await fetch(base + "/v1/proxy/status", { headers }));
    const oversized = await fetch(base + "/v1/chat/completions", { method: "POST", headers, body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(2000) }] }) });
    assert.equal(oversized.status, 413); await oversized.text();
    const malformed = await fetch(base + "/v1/chat/completions", { method: "POST", headers, body: "{broken" });
    assert.equal(malformed.status, 400); await malformed.text();
    const observed = await statusJson(await fetch(base + "/v1/proxy/status", { headers }));
    assert(observed.activity.categories.models >= 2);
    assert(observed.activity.categories.chat >= 2);
    assert(observed.activity.categories.health >= 2);
    assert(observed.activity.failed >= 3);
    const unchanged = await statusJson(await fetch(base + "/v1/proxy/status", { headers }));
    assert.equal(unchanged.activity.total, observed.activity.total, "dashboard polls must not inflate activity");
    assert.equal(unchanged.instance.id, operator.headers.get("x-m365-proxy-instance"));
      const inspection = await fetch(base + "/v1/proxy/checks", { headers });
      assert.equal(inspection.status, 200);
      const checked = await statusJson(inspection);
      assert.equal(checked.instance.id, unchanged.instance.id);
      assert.equal(checked.upstream, "not_probed");
      if (checked.listenerInspection === "available") assert(checked.listeners.some(listener => listener.thisInstance));
      const selfCheck = await fetch(base + "/v1/models", { headers: { ...headers, "x-m365-check": "1" } });
      await selfCheck.text();
      const afterCheck = await statusJson(await fetch(base + "/v1/proxy/status", { headers }));
      assert.equal(afterCheck.activity.selfChecks, unchanged.activity.selfChecks + 1);
      assert.equal(afterCheck.activity.applicationRequests, unchanged.activity.applicationRequests);
      assert.equal(afterCheck.activity.chats.upstreamAttempts, 0, "local checks must not start an upstream chat");
    const mode = extra.M365_TEST_CHAT_MODE || "success";
    const chatBody = { model: "claude-sonnet", messages: [{ role: "user", content: "private-offline-prompt" }] };
    const sendChat = (stream, signal) => fetch(base + "/v1/chat/completions", { method: "POST", headers, body: JSON.stringify({ ...chatBody, stream }), signal });
    if (mode === "hold") {
      const held = await sendChat(true);
      const reader = held.body.getReader(); await reader.read();
      for (let i = 0; i < 60; i++) {
        const inProgress = await statusJson(await fetch(base + "/v1/proxy/status", { headers }));
        if (inProgress.activity.chats.upstreamAttempts > 0) break;
        await delay(50);
      }
      await reader.cancel();
      await delay(150);
      const cancelled = await statusJson(await fetch(base + "/v1/proxy/status", { headers }));
      assert.equal(cancelled.activity.chats.cancelled, 1);
      assert.equal(cancelled.activity.chats.active, 0);
      assert(cancelled.activity.recent.some(event => event.outcome === "cancelled"));
    } else {
      const plain = await sendChat(false);
      assert.equal(plain.status, mode === "throttled" ? 429 : 200);
      const plainText = await plain.text();
      assert(plainText.includes(mode === "throttled" ? "m365_throttled" : "Offline fixture reply"));
      const streamed = await sendChat(true);
      assert.equal(streamed.status, 200);
      const streamText = await streamed.text();
      assert(streamText.includes("[DONE]"));
      assert(streamText.includes(mode === "throttled" ? "m365_throttled" : "Offline fixture reply"));
      const afterChat = await statusJson(await fetch(base + "/v1/proxy/status", { headers }));
      assert.equal(afterChat.activity.chats.validated, 2);
      assert.equal(afterChat.activity.chats.streamed, 1);
      assert.equal(afterChat.activity.chats.nonStreamed, 1);
      assert.equal(afterChat.activity.chats.active, 0);
      assert.equal(afterChat.activity.chats[mode === "throttled" ? "failed" : "completed"], 2);
      assert.equal(afterChat.activity.chats.upstreamAttempts, mode === "reconnect" ? 3 : 2);
      if (mode === "reconnect") assert.equal(afterChat.activity.chats.retries, 1);
      const chatEvents = afterChat.activity.recent.filter(event => event.streamed !== null);
      assert(chatEvents.every(event => event.responseBytes > 0 && event.firstByteMs !== null && event.queueMs !== null));
      assert.equal(chatEvents.find(event => event.id === plain.headers.get("x-m365-request-id")).responseBytes, Buffer.byteLength(plainText));
      assert.equal(chatEvents.find(event => event.id === streamed.headers.get("x-m365-request-id")).responseBytes, Buffer.byteLength(streamText));
      if (mode === "throttled") assert(chatEvents.some(event => event.status === 200 && event.applicationStatus === 429 && event.outcome === "error"));
      assert(!JSON.stringify(afterChat).includes("private-offline-prompt"));
      assert(!JSON.stringify(afterChat).includes("Offline fixture reply"));
    }
    console.log(`PASS: offline ${mode} chat activity and streaming lifecycle`);
    const instance = JSON.parse(readFileSync(join(dir, "instance.json"), "utf8"));
    writeFileSync(join(dir, `shutdown-${instance.nonce}`), "stop");
    assert.notEqual(await Promise.race([exit, delay(10_000).then(() => "timeout")]), "timeout", logs);
    console.log("PASS: loopback listener, readiness, origin/key policy, and graceful stop");
  } finally { if (child.exitCode === null) child.kill(); await Promise.race([exit, delay(1000)]); }
}
await start(false);
await start(true, { M365_API_KEY: "" });
await start(true, { M365_API_KEY: "offline-test-key" });
await start(true, { M365_API_KEY: "offline-test-key", M365_TEST_CHAT_MODE: "throttled" });
await start(true, { M365_API_KEY: "offline-test-key", M365_TEST_CHAT_MODE: "reconnect" });
await start(true, { M365_API_KEY: "offline-test-key", M365_TEST_CHAT_MODE: "hold" });
const clientDir = mkdtempSync(join(tmpdir(), "m365-clients-"));
const clientEnv = { ...process.env, M365_DATA_DIR: clientDir, M365_API_KEY: "offline-client-secret", HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: "4141", NITRO_PORT: "4141" };
delete clientEnv.NODE_OPTIONS;
const launcher = process.argv[2] || join(root, "packages/proxy/bin/m365-proxy.mjs");
for (const client of ["pi", "openclaw"]) {
  const path = join(clientDir, client, "config.json");
  const args = [launcher, "client", "setup", client, "--config", path];
  const dry = execFileSync(process.execPath, [...args, "--dry-run"], { env: clientEnv, windowsHide: true, encoding: "utf8" });
  assert(!existsSync(path));
  assert(!dry.includes("offline-client-secret"));
  execFileSync(process.execPath, args, { env: clientEnv, windowsHide: true });
  const config = JSON.parse(readFileSync(path, "utf8"));
  const provider = client === "pi" ? config.providers.m365 : config.models.providers.m365;
  assert.equal(provider.apiKey, "offline-client-secret");
  assert(provider.models.some(m => m.id === "claude-sonnet"));
}
const info = execFileSync(process.execPath, [launcher, "client", "info"], { env: clientEnv, windowsHide: true, encoding: "utf8" });
assert(!info.includes("offline-client-secret"));
assert.equal(JSON.parse(info).recommendedModel, "claude-sonnet");
console.log("PASS: isolated pi/OpenClaw configuration, dry-run and credential-free client info");
