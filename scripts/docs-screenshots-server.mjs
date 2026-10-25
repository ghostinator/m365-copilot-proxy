// Documentation-only fixture. No production credentials or real Microsoft calls.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.DOCS_PORT || 44141);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("DOCS_PORT must be 1024..65535");
const directory = mkdtempSync(join(tmpdir(), "m365-docs-demo-"));
// Set before importing core/proxy-lib so all state remains inside temporary storage.
process.env.M365_DATA_DIR = directory;
const labels = { "192.0.2.20": "Build agent", "192.0.2.30": "Production host", "192.0.2.40": "Development laptop" };
writeFileSync(join(directory, "server.json"), JSON.stringify({ host: "127.0.0.1", port, sourceLabels: labels }));
const account = createHash("sha256").update(JSON.stringify(["offline", "offline"])).digest("hex");
writeFileSync(join(directory, `quota-observations-${account}.json`), JSON.stringify({ version: 1, budgets: { opus: { at: Date.now(), daily: 12, weekly: 30 } }, route: { at: Date.now(), requested: "claude-opus", served: "claude-opus-4.5" } }));
const { RequestSources } = await import(pathToFileURL(join(root, "packages/proxy-lib/dist/index.mjs")).href);
const store = new RequestSources(directory), addresses = Object.keys(labels), models = ["claude-sonnet", "gpt-5.5-think-deeper", "m365-copilot"];
const now = Date.now();
for (let i = 0; i < 420; i++) {
  const failed = i % 17 === 0, cancelled = i % 71 === 0 && !failed, chat = i % 7 !== 0;
  const status = cancelled ? 499 : failed && (i % 2 || !chat) ? 502 : 200;
  store.record({ id: randomUUID(), clientAddress: addresses[i % 3], clientSoftware: i % 2 ? "OpenAI Python" : "Node.js", receivedAt: new Date(now - (i % 12) * 86_400_000 - (i % 20) * 60_000).toISOString(), method: chat ? "POST" : "GET", endpoint: chat ? "/v1/chat/completions" : "/v1/models", source: "application", status, applicationStatus: cancelled ? 499 : failed ? 502 : 200, outcome: cancelled ? "cancelled" : failed ? "error" : "success", phase: cancelled ? "cancelled" : failed ? "failed" : "completed", responseBytes: 600 + i * 13, durationMs: 200 + i * 7, firstByteMs: 180, queueMs: 5, upstreamAttempts: chat ? 1 : 0, upstreamFailures: failed ? 1 : 0, streamed: chat ? i % 2 === 0 : null, model: chat ? models[i % 3] : null, servedModel: chat ? models[i % 3] : null, diagnostic: failed ? { type: "upstream_error", code: "demo_failure", message: "Synthetic documentation failure. No Microsoft request was sent.", phase: "upstream", stack: "Error: Synthetic documentation failure\n    at example (/demo/proxy-handler.ts:42:7)" } : cancelled ? { type: "client_disconnected", message: "Synthetic client timeout for documentation.", phase: "streaming" } : null });
}
for (const model of ["m365-copilot", "claude-sonnet", "gpt-5.5-think-deeper"]) {
  store.saveModelCheck(model, 200, "Demo fixture — identity unverified", 450, model, "identity", "reported", "Synthetic documentation sample, not a live model evaluation.", 1);
  store.saveModelCheck(model, 200, "", 820, model, "function-tool", "passed", "Demo: one valid synthetic function call. Not a live model evaluation.", 1);
  store.saveModelCheck(model, 200, "", 1600, model, "tool-roundtrip", "passed", "Demo: exact synthetic receipt read from a tool result. No command executed.", 2);
}
store.close();

const child = spawn(process.execPath, ["--import", pathToFileURL(join(root, "scripts/fixtures/chat-loader.mjs")).href, join(root, "packages/proxy/bin/m365-proxy.mjs"), "serve", String(port)], {
  cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, M365_DATA_DIR: directory, M365_CACHE_FILE: join(directory, "cache.json"), M365_SECRETS_FILE: join(directory, "absent.json"), M365_BROWSER_PROFILE: join(directory, "browser-profile"), M365_NO_INTERACTIVE: "1", M365_ENABLE_INTERACTIVE_APPROVAL: "0", M365_FORCE_AGENT: "0", M365_API_KEY: "", M365_OPUS_FALLBACK_MODEL: "claude-opus-4.5", HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: String(port), NITRO_PORT: String(port), M365_DEBUG: "", M365_TRACE: "", M365_DUMP_FRAMES: "", M365_LOG_STDOUT: "" },
});
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
console.log(`Synthetic documentation dashboard: http://127.0.0.1:${port}/dashboard (10-minute limit)`);
const timeout = setTimeout(() => child.kill(), 600_000);
process.once("SIGINT", () => child.kill()); process.once("SIGTERM", () => child.kill());
child.once("exit", code => { clearTimeout(timeout); process.exitCode = code ?? 0; });

// Never send synthetic chats to a pre-existing process occupying DOCS_PORT.
// Wait for THIS child's listen acknowledgement, then verify its reported PID.
await new Promise((resolveReady, reject) => {
  let output = "";
  const deadline = setTimeout(() => { child.kill(); reject(new Error("Documentation server did not start")); }, 30_000);
  child.stdout.on("data", chunk => {
    output = (output + chunk).slice(-8192);
    if (output.includes(`Listening on http://127.0.0.1:${port}`)) { clearTimeout(deadline); resolveReady(); }
  });
  child.once("exit", () => { clearTimeout(deadline); reject(new Error("Documentation server exited before startup")); });
});
const observed = await (await fetch(`http://127.0.0.1:${port}/v1/proxy/status`)).json();
if (observed.instance?.pid !== child.pid) { child.kill(); throw new Error("DOCS_PORT belongs to a different process; no synthetic chat was sent"); }
if (child.exitCode === null) {
  const base = `http://127.0.0.1:${port}`;
  await (await fetch(base + "/v1/models")).text();
  for (const stream of [false, true]) await (await fetch(base + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet", stream, messages: [{ role: "user", content: "Synthetic documentation example" }] }) })).text();
  await (await fetch(base + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid-demo" })).text();
}
