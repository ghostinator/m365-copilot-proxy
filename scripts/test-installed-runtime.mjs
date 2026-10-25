import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFile, execFileSync } from "node:child_process";
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
  let logs = "", stage = "startup";
  const request = (url, options) => { stage = (options?.method || "GET") + " " + new URL(url).pathname; return globalThis.fetch(url, options); };
  child.stdout.on("data", d => { logs += d; }); child.stderr.on("data", d => { logs += d; });
  const exit = new Promise(r => child.once("exit", r));
  try {
    for (let i = 0; i < 100 && !logs.includes("Listening on") && child.exitCode === null; i++) await delay(100);
    if (!authenticated) {
      const code = await Promise.race([exit, delay(5000).then(() => "timeout")]);
      assert.equal(code, 78, logs || "No startup diagnostics were emitted before the timeout");
      assert.match(logs, /Authentication failed/);
      console.log("PASS: missing credentials fail startup with configuration exit 78");
      return;
    }
    assert.match(logs, new RegExp(`Listening on http://127\\.0\\.0\\.1:${port}`), logs);
    const base = `http://127.0.0.1:${port}`;
    const dashboard = await request(base + "/dashboard");
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /M365 Copilot Proxy/);
    assert.equal((await request(base + "/dashboard-script")).status, 200);
    assert.equal((await request(base + "/v1/proxy/status")).status, extra.M365_API_KEY ? 401 : 200);
    const operator = await request(base + "/v1/proxy/status", { headers: extra.M365_API_KEY ? { authorization: `Bearer ${extra.M365_API_KEY}` } : {} });
    const operatorStatus = await statusJson(operator);
    assert.equal(operatorStatus.authentication.status, "ready");
    assert.equal(operatorStatus.budgets.find(b => b.id === "opus").allowance.daily, 12);
    assert.equal(operatorStatus.lastRoute.fallbackUsed, true);
    assert.equal((await request(base + "/health/ready")).status, 200);
    assert.equal((await request(base + "/health/live")).status, 200);
    assert.equal((await request(base + "/v1/models")).status, extra.M365_API_KEY ? 401 : 200);
    assert.equal((await request(base + "/v1/models", { headers: { origin: "https://untrusted.example" } })).status, 403);
    if (extra.M365_API_KEY) assert.equal((await request(base + "/v1/models", { headers: { authorization: `Bearer ${extra.M365_API_KEY}` } })).status, 200);
    const headers = { "content-type": "application/json", ...(extra.M365_API_KEY ? { authorization: `Bearer ${extra.M365_API_KEY}` } : {}) };
    await statusJson(await request(base + "/v1/proxy/status", { headers }));
    const oversized = await request(base + "/v1/chat/completions", { method: "POST", headers, body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(2000) }] }) });
    assert.equal(oversized.status, 413); await oversized.text();
    const malformed = await request(base + "/v1/chat/completions", { method: "POST", headers, body: "{broken" });
    assert.equal(malformed.status, 400); await malformed.text();
    const observed = await statusJson(await request(base + "/v1/proxy/status", { headers }));
    assert(observed.activity.categories.models >= 2);
    assert(observed.activity.categories.chat >= 2);
    assert(observed.activity.categories.health >= 2);
    assert(observed.activity.failed >= 3);
    const unchanged = await statusJson(await request(base + "/v1/proxy/status", { headers }));
    assert.equal(unchanged.activity.total, observed.activity.total, "dashboard polls must not inflate activity");
    assert.equal(unchanged.sources.persistent, true);
    assert.equal(unchanged.sources.systems[0].address, "127.0.0.1");
    const beforeForged = unchanged.sources.systems[0].applicationRequests;
    await (await request(base + "/v1/models", { headers: { ...headers, "x-forwarded-for": "100.64.99.99", "x-real-ip": "100.64.99.99" } })).text();
    const afterForged = await statusJson(await request(base + "/v1/proxy/status", { headers }));
    assert.equal(afterForged.sources.systems[0].applicationRequests, beforeForged + 1);
    assert(!JSON.stringify(afterForged.sources).includes("100.64.99.99"));
    assert.equal(unchanged.instance.id, operator.headers.get("x-m365-proxy-instance"));
      const inspection = await request(base + "/v1/proxy/checks", { headers });
      assert.equal(inspection.status, 200);
      const checked = await statusJson(inspection);
      assert.equal(checked.instance.id, unchanged.instance.id);
      assert.equal(checked.upstream, "not_probed");
      if (checked.listenerInspection === "available") assert(checked.listeners.some(listener => listener.thisInstance));
      const selfCheck = await request(base + "/v1/models", { headers: { ...headers, "x-m365-check": "1" } });
      await selfCheck.text();
      const afterCheck = await statusJson(await request(base + "/v1/proxy/status", { headers }));
      assert.equal(afterCheck.activity.selfChecks, unchanged.activity.selfChecks + 1);
      assert.equal(afterCheck.activity.applicationRequests, afterForged.activity.applicationRequests);
      assert.equal(afterCheck.activity.chats.upstreamAttempts, 0, "local checks must not start an upstream chat");
    const mode = extra.M365_TEST_CHAT_MODE || "success";
    const chatBody = { model: "claude-sonnet", messages: [{ role: "user", content: "private-offline-prompt" }] };
    const sendChat = (stream, signal) => request(base + "/v1/chat/completions", { method: "POST", headers, body: JSON.stringify({ ...chatBody, stream }), signal });
    if (mode === "hold") {
      const held = await sendChat(true);
      const reader = held.body.getReader(); await reader.read();
      for (let i = 0; i < 60; i++) {
        const inProgress = await statusJson(await request(base + "/v1/proxy/status", { headers }));
        if (inProgress.activity.chats.upstreamAttempts > 0) {
          assert(inProgress.activity.live.some(row => row.endpoint === "/v1/chat/completions" && row.outcome === "pending" && row.elapsedMs >= 0));
          break;
        }
        await delay(50);
      }
      await reader.cancel();
      await delay(150);
      const cancelled = await statusJson(await request(base + "/v1/proxy/status", { headers }));
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
      const afterChat = await statusJson(await request(base + "/v1/proxy/status", { headers }));
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
    const history = await statusJson(await request(base + "/v1/proxy/status?range=24h&limit=1", { headers }));
    assert.equal(history.sources.storage.engine, "SQLite");
    assert.equal(history.sources.storage.retention, "unlimited");
    assert.equal(history.sources.recent.length, 1);
    assert(history.sources.errorHistory.total >= 2, "validation failures must appear without internal logger errors");
    const invalid = history.sources.errors.find(event => event.status === 400);
    assert.equal(invalid.diagnostic.type, "invalid_request_error");
    assert.match(invalid.diagnostic.message, /Malformed JSON/);
    assert(history.sources.errors.some(event => event.status === 413 && /size limit/.test(event.diagnostic.message)));
    if (mode === "throttled") {
      const streamError = history.sources.errors.find(event => event.status === 200 && event.applicationStatus === 429);
      assert(streamError, "HTTP-200 SSE errors must be saved in Recent errors");
      assert.equal(streamError.diagnostic.type, "rate_limit_error");
      assert.match(streamError.diagnostic.message, /throttl/i);
      assert(streamError.upstreamAttempts > 0);
    }
    assert.equal((await request(base + "/v1/proxy/status?range=invalid", { headers })).status, 400);
    if (mode === "success" && !extra.M365_API_KEY) {
      assert.equal(history.sources.modelChecks.length, 0, "status polling must never run a model check");
      const check = await statusJson(await request(base + "/v1/proxy/model-check", { method: "POST", headers, body: JSON.stringify({ model: "claude-sonnet" }) }));
      assert.equal(check.selfReported, true);
      assert(check.identity.includes("Offline fixture reply"));
      assert.equal(check.servedModel, "claude-sonnet");
      assert.equal((await request(base + "/v1/proxy/model-check", { method: "POST", headers, body: JSON.stringify({ model: "claude-sonnet" }) })).status, 429);
      const checked = await statusJson(await request(base + "/v1/proxy/status?range=24h", { headers }));
      assert.equal(checked.sources.modelChecks.length, 1);
      assert(checked.sources.modelActivity.some(row => row.model === "claude-sonnet" && row.address === "127.0.0.1"));
    }
    if (mode === "success" && extra.M365_API_KEY) {
      assert.equal(history.modelCheck.tests.length, 8);
      const check = await statusJson(await request(base + "/v1/proxy/model-check", { method: "POST", headers, body: JSON.stringify({ model: "claude-sonnet", kind: "function-tool" }) }));
      assert.equal(check.kind, "function-tool");
      assert.equal(check.verdict, "failed", "plain prose must not pass a tool capability check");
      assert.equal(check.turns, 1);
      const saved = await statusJson(await request(base + "/v1/proxy/status", { headers }));
      assert(saved.sources.modelChecks.some(row => row.kind === "function-tool" && row.verdict === "failed"));
    }
    if (mode === "success" && !extra.M365_API_KEY) {
      const keyCommand = async (...command) => (await promisify(execFile)(process.execPath, [process.argv[2] || join(root, "packages/proxy/bin/m365-proxy.mjs"), "keys", ...command], { env, cwd: dir, windowsHide: true, encoding: "utf8" })).stdout;
      const production = JSON.parse(await keyCommand("create", "Production fixture"));
      const development = JSON.parse(await keyCommand("create", "Development fixture"));
      const useKey = async token => { const response = await request(base + "/v1/models", { headers: { authorization: "Bearer " + token } }); await response.text(); return response.status; };
      assert.equal(await useKey(production.token), 200);
      assert.equal(await useKey(development.token), 200);
      const usage = await statusJson(await request(base + "/v1/proxy/status"));
      assert(usage.sources.keyActivity.some(row => row.id === production.id && row.label === "Production fixture"));
      assert(usage.sources.keyActivity.some(row => row.id === development.id && row.label === "Development fixture"));
      assert(!JSON.stringify(usage).includes(production.token));
      assert(!JSON.stringify(usage.apiKeys).includes("hash"));
      await keyCommand("rename", production.id, "Renamed production");
      await keyCommand("mode", "required");
      assert.equal((await request(base + "/v1/models")).status, 401);
      assert.equal(await useKey(development.token), 200);
      await keyCommand("revoke", production.id);
      assert.equal(await useKey(production.token), 401);
      await keyCommand("mode", "optional");
      assert.equal((await request(base + "/v1/models")).status, 200);
      assert(!readFileSync(join(dir, "proxy-api-keys.json"), "utf8").includes(development.token));
      console.log("PASS: named application keys, hot reload, attribution, optional/required mode and revocation");
    }
    console.log(`PASS: offline ${mode} chat activity and streaming lifecycle`);
    const instance = JSON.parse(readFileSync(join(dir, "instance.json"), "utf8"));
    writeFileSync(join(dir, `shutdown-${instance.nonce}`), "stop");
    assert.notEqual(await Promise.race([exit, delay(10_000).then(() => "timeout")]), "timeout", logs);
    const sourceHistory = new DatabaseSync(join(dir, "activity.sqlite"), { readOnly: true });
    assert.equal(sourceHistory.prepare("SELECT address FROM systems LIMIT 1").get().address, "127.0.0.1");
    assert(sourceHistory.prepare("SELECT COUNT(*) AS count FROM requests").get().count > 0);
    assert.equal(sourceHistory.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert(!JSON.stringify(sourceHistory.prepare("SELECT * FROM requests").all()).includes("private-offline-prompt"));
    sourceHistory.close();
    console.log("PASS: loopback listener, readiness, origin/key policy, and graceful stop");
  } catch (error) {
    error.message += "\nStage: " + stage + "\nIsolated fixture server log:\n" + logs.slice(-8000);
    throw error;
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

const keyEnv = { ...clientEnv, M365_API_KEY: "" };
const clientCommand = async (...args) => (await promisify(execFile)(process.execPath, [launcher, ...args], { env: keyEnv, windowsHide: true, encoding: "utf8" })).stdout;
const appKey = JSON.parse(await clientCommand("keys", "create", "Guided setup fixture"));
await clientCommand("keys", "mode", "required");
assert(JSON.parse(await clientCommand("client", "info")).authorization.includes("Bearer"));
keyEnv.M365_APPLICATION_KEY = appKey.token;
for (const client of ["pi", "openclaw"]) {
  const path = join(clientDir, client, "named-config.json");
  const output = await clientCommand("client", "setup", client, "--config", path, "--api-key-env", "M365_APPLICATION_KEY");
  assert(!output.includes(appKey.token));
  const config = JSON.parse(readFileSync(path, "utf8"));
  assert.equal((client === "pi" ? config.providers.m365 : config.models.providers.m365).apiKey, appKey.token);
}
console.log("PASS: guided client setup selects a named key from an environment variable without printing it");
