// Real Pi -> rebuilt Nitro -> M365, restricted by the prompt to owned fixtures.
// shortcut: uses the managed Windows Pi install and Git Bash; generalize only for another host.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

assert.equal(process.env.M365_LIVE, "1", "Explicit M365_LIVE=1 is required; this consumes account quota");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(tmpdir(), `m365-live-crud-${randomUUID()}`);
const workspace = join(root, "workspace"), agent = join(root, "pi-agent");
mkdirSync(workspace, { recursive: true, mode: 0o700 });
mkdirSync(agent, { mode: 0o700 });
const cache = process.env.M365_CACHE_FILE || join(homedir(), ".config", "opencode-m365", "msal-cache.json");
assert.ok(existsSync(cache), "An existing MSAL cache is required; no credentials are copied");
const base = "http://127.0.0.1:42819", model = "claude-sonnet";
const portCheck = createServer();
await new Promise((resolve, reject) => portCheck.once("error", reject).listen(42819, "127.0.0.1", resolve));
await new Promise(resolve => portCheck.close(resolve));
const apiKey = `research-${randomBytes(20).toString("hex")}`;
const nonce = randomBytes(16).toString("hex");
writeFileSync(join(workspace, "input.txt"), `${nonce}\n`, { mode: 0o600 });
writeFileSync(join(workspace, "delete-me.txt"), "owned disposable fixture\n", { mode: 0o600 });
writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { research: {
  api: "openai-completions", apiKey, baseUrl: `${base}/v1`,
  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: false },
  models: [{ id: model, name: `Research ${model}` }],
} } }), { mode: 0o600 });
writeFileSync(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "research", defaultModel: model, enableInstallTelemetry: false }), { mode: 0o600 });
const serverLog = createWriteStream(join(root, "server.log"));
const server = spawn(process.execPath, [join(repo, "packages/proxy/.output/server/index.mjs")], {
  cwd: repo, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: "42819", NITRO_PORT: "42819",
    M365_DATA_DIR: join(root, "data"), M365_CACHE_FILE: cache, M365_SECRETS_FILE: join(root, "absent-secrets.json"),
    M365_API_KEY: apiKey, M365_NO_INTERACTIVE: "1", M365_DEBUG: "1", M365_TRACE: "0", M365_DUMP_FRAMES: "1" },
});
server.stdout.pipe(serverLog, { end: false }); server.stderr.pipe(serverLog, { end: false });
let pi;
console.log(JSON.stringify({ stage: "starting", evidence: root, model, serverPid: server.pid }));
try {
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited ${server.exitCode}; inspect private server.log`);
    try {
      const response = await fetch(`${base}/health/ready`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(2000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for the owned test server and cached-token refresh. */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(ready, "Test server did not become ready; no Pi/model turn was started");
  if (process.argv.includes("--http-cancel")) {
    const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-conversation-id": randomUUID() };
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 90000);
    const messages = [{ role: "user", content:
      `Session test marker: ${nonce}. Write a detailed, friendly guide to organizing a kitchen, with 30 numbered sections.` }];
    const response = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers, signal: controller.signal,
      body: JSON.stringify({ model: "gpt-5.6-quick", stream: true, messages }) });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let buffer = "", contentChars = 0, partial = "";
    try {
      while (contentChars < 1) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false, "Upstream completed before a real HTTP disconnect");
        buffer += new TextDecoder().decode(chunk.value);
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            const text = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? "";
            partial += text; contentChars += text.length;
          }
        }
      }
      controller.abort();
    } finally { clearTimeout(deadline); await reader.cancel().catch(() => {}); }
    await new Promise(resolve => setTimeout(resolve, 3000));
    const frames = readdirSync(join(root, "data/frames")).flatMap(file => readFileSync(join(root, "data/frames", file), "utf8").trim().split("\n").map(JSON.parse));
    assert.ok(frames.some(row => row.dir === "send" && row.frame.target === "stop"), "HTTP disconnect did not propagate upstream Stop");
    messages.push({ role: "assistant", content: partial }, { role: "user", content: "Return only the exact session test marker from earlier in this conversation. Reply UNKNOWN if unavailable." });
    const recall = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model: "gpt-5.6-quick", stream: false, messages }) });
    assert.equal(recall.status, 200);
    const result = await recall.json();
    assert.equal(result.choices[0].message.content.trim(), nonce);
    unlinkSync(join(workspace, "input.txt")); unlinkSync(join(workspace, "delete-me.txt"));
    console.log(JSON.stringify({ stage: "passed", httpDisconnect: true, upstreamStop: true, recoveryWithHistory: true, exactRecall: true, contentChars, evidence: root }));
  } else {
  const packageName = "@earendil-works/pi-coding-agent";
  const install = join(homedir(), ".pi", "agent", "install");
  const version = readFileSync(join(install, "current-version"), "utf8").trim();
  assert.match(version, /^[0-9A-Za-z._+-]+$/);
  const pkgDir = join(install, "releases", version, "node_modules", ...packageName.split("/"));
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const bin = resolve(pkgDir, typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pi);
  assert.ok(bin.startsWith(`${pkgDir}\\`) || bin.startsWith(`${pkgDir}/`));
  const prompt = "Perform a local tool-contract test only in the current directory. Read input.txt with the read tool. Use write to create result.txt containing exactly nonce=<the real input value> and status=draft on separate lines. Read result.txt. Use edit to change only status=draft to status=verified. Read result.txt again. Use bash only to delete delete-me.txt. Do not modify input.txt, do not use network, do not touch any other directory. Use the actual local tools for each step, not your cloud sandbox. End with a short report after verifying the local changes.";
  const piLog = createWriteStream(join(root, "pi.ndjson"));
  const tools = [];
  let buffer = "";
  pi = spawn(process.execPath, [bin, "--provider", "research", "--model", model,
    "--mode", "json", "--print", "--no-session", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-context-files", "--no-themes", "--offline", "--approve",
    "--tools", "read,write,edit,bash", "--thinking", "off", prompt], {
    cwd: workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_TELEMETRY: "0",
      PI_BASH_PATH: "C:/Program Files/Git/bin/bash.exe" },
  });
  pi.stdout.pipe(piLog, { end: false }); pi.stderr.pipe(piLog, { end: false });
  pi.stdout.on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const event = JSON.parse(line); if (event.type === "tool_execution_start") tools.push(event.toolName); } catch { /* CLI diagnostics are retained in the private log. */ }
    }
  });
  console.log(JSON.stringify({ stage: "pi-running", model, piPid: pi.pid }));
  const timeout = setTimeout(() => pi.kill(), 240_000);
  const exit = await new Promise((res, rej) => { pi.once("error", rej); pi.once("close", res); });
  clearTimeout(timeout); piLog.end();
  assert.equal(exit, 0, "Pi did not finish; inspect private pi.ndjson");
  assert.equal(readFileSync(join(workspace, "input.txt"), "utf8"), `${nonce}\n`);
  const result = readFileSync(join(workspace, "result.txt"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(result.trimEnd(), `nonce=${nonce}\nstatus=verified`);
  assert.equal(existsSync(join(workspace, "delete-me.txt")), false);
  assert.ok(tools.includes("read") && tools.includes("write") && tools.includes("edit") && tools.includes("bash"), "Expected distinct native Pi read/write/edit/bash calls");
  unlinkSync(join(workspace, "result.txt"));
  unlinkSync(join(workspace, "input.txt"));
  assert.equal(existsSync(join(workspace, "result.txt")), false);
  console.log(JSON.stringify({ stage: "passed", model, localCrud: true, realTools: tools, inputPreserved: true, fixtureFilesCleaned: true, evidence: root }));
  }
} finally {
  if (pi && pi.exitCode === null) pi.kill();
  server.stdout.unpipe(serverLog); server.stderr.unpipe(serverLog);
  if (server.exitCode === null) server.kill();
  serverLog.end();
}
