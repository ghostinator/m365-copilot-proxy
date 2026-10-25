import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(process.env.M365_DATA_DIR || join(homedir(), ".config", "opencode-m365"));
const configPath = join(dataDir, "server.json");
const runtimeUrl = pathToFileURL(join(root, ".output/server/runtime.mjs"));
const launcher = join(root, "bin/m365-proxy.mjs");

function settings() {
  let config = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, "utf8")); }
    catch { throw new Error(`Invalid ${configPath}; repair it before starting. It was not changed.`); }
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("server.json must be an object");
  }
  const port = Number(process.env.NITRO_PORT || process.env.PORT || config.port || 4141);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer from 1 to 65535");
  const host = process.env.NITRO_HOST || process.env.HOST || config.host || "127.0.0.1";
  if (typeof host !== "string" || !host || /[\s/'";]/.test(host)) throw new Error("Invalid bind host");
  if (config.apiKey !== undefined && (typeof config.apiKey !== "string" || !config.apiKey.trim())) throw new Error("server.json apiKey must be a nonempty string");
  if (config.allowedOrigins !== undefined && (!Array.isArray(config.allowedOrigins) || !config.allowedOrigins.every(v => typeof v === "string" && /^https?:\/\//.test(v)))) throw new Error("server.json allowedOrigins must be an array of HTTP(S) origins");
  if (config.apiKey && !process.env.M365_API_KEY) process.env.M365_API_KEY = config.apiKey;
  if (config.allowedOrigins && !process.env.M365_ALLOWED_ORIGINS) process.env.M365_ALLOWED_ORIGINS = config.allowedOrigins.join(",");
  return { host, port };
}

function run(executable, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  const result = spawnSync(executable, args, { stdio: "inherit", windowsHide: true, timeout: 600_000, ...spawnOptions });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${executable} exited with ${result.status}`);
  return result.status ?? 1;
}

function protectDataDir() {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dataDir, 0o700);
  if (process.platform === "win32") {
    const sid = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8", windowsHide: true });
    if (sid.status !== 0 || !/^S-1-/.test(sid.stdout.trim())) throw new Error("Cannot determine the current Windows identity");
    run("icacls.exe", [dataDir, "/inheritance:r", "/grant:r", `*${sid.stdout.trim()}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { stdio: "ignore" });
  }
}

export async function main(args) {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or later is required");
  let command = args[0] || "serve";
  if (/^\d+$/.test(command)) { process.env.NITRO_PORT = process.env.PORT = command; command = "serve"; }
  if (["--help", "-h", "help"].includes(command)) {
    console.log("m365-proxy setup [--skip-browser]\nm365-proxy login\nm365-proxy doctor [--live]\nm365-proxy serve [port]\nm365-proxy stop\nm365-proxy service install|status|start|stop|uninstall\nm365-proxy diagnostics [output.json]\nm365-proxy client setup pi|openclaw [--config path] [--base-url URL] [--dry-run] [--replace]\nm365-proxy client info\nDashboard: http://127.0.0.1:<port>/dashboard\n\nConfiguration: " + configPath);
    return;
  }
  if (command === "service") {
    if (process.platform !== "win32") throw new Error("The service commands manage a Windows per-user sign-in task. See docs/operations.md for systemd.");
    const action = args[1];
    if (!["install", "status", "start", "stop", "uninstall"].includes(action)) throw new Error("Choose service install, status, start, stop or uninstall");
    process.exitCode = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "windows/Service.ps1"), "-Action", action, "-Launcher", launcher, "-NodePath", process.execPath, "-DataDir", dataDir], { allowFailure: action === "status", timeout: 180_000 });
    return;
  }
  if (command === "stop") {
    const path = join(dataDir, "instance.json");
    if (!existsSync(path)) throw new Error("No running proxy is recorded for this data directory");
    const instance = JSON.parse(readFileSync(path, "utf8"));
    if (!/^[0-9a-f-]{36}$/.test(instance.nonce)) throw new Error("Invalid instance record; no process was stopped");
    writeFileSync(join(dataDir, `shutdown-${instance.nonce}`), "stop", { mode: 0o600 });
    for (let i = 0; i < 40; i++) {
      if (!existsSync(path)) { console.log("Proxy stopped"); return; }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error("Proxy did not acknowledge shutdown; use service stop to verify and stop a supervised process");
  }
  if (!["serve", "setup", "login", "doctor", "diagnostics", "client"].includes(command)) throw new Error(`Unknown command: ${command}; use --help`);
  if (command === "serve" && args[1]) process.env.NITRO_PORT = process.env.PORT = args[1];
  const config = settings();
  const runtime = await import(runtimeUrl.href);
  runtime.validateBind(config.host);
  if (command === "client") {
    if (args[1] === "info") {
      if (args.length !== 2) throw new Error("Use client info without additional arguments");
      const host = ["0.0.0.0", "::"].includes(config.host) ? "127.0.0.1" : config.host;
      console.log(JSON.stringify({ api: "OpenAI chat completions", baseUrl: `http://${host.includes(":") ? `[${host}]` : host}:${config.port}/v1`, authorization: process.env.M365_API_KEY ? "Authorization: Bearer <proxy API key>" : "No proxy key configured; use a placeholder if your client requires one", recommendedModel: "claude-sonnet", models: runtime.getAvailableModels(), verification: "No upstream request was sent" }, null, 2));
      return;
    }
    if (args[1] !== "setup" || !["pi", "openclaw"].includes(args[2])) throw new Error("Use client setup pi|openclaw [--config path] [--base-url URL] [--dry-run] [--replace]");
    const client = args[2];
    const options = {};
    for (let i = 3; i < args.length; i++) {
      const flag = args[i];
      if (["--dry-run", "--replace"].includes(flag)) options[flag] = true;
      else if (["--config", "--base-url"].includes(flag) && args[i + 1] && !args[i + 1].startsWith("--")) options[flag] = args[++i];
      else throw new Error(`Unknown or incomplete client option: ${flag}`);
    }
    const defaultPath = client === "pi" ? join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "models.json") : process.env.OPENCLAW_CONFIG_PATH || join(process.env.OPENCLAW_STATE_DIR || join(homedir(), ".openclaw"), "openclaw.json");
    const path = resolve(options["--config"] || defaultPath);
    const host = ["0.0.0.0", "::"].includes(config.host) ? "127.0.0.1" : config.host;
    const url = options["--base-url"] || `http://${host.includes(":") ? `[${host}]` : host}:${config.port}/v1`;
    const setup = client === "pi" ? runtime.setupPiClient : runtime.setupOpenClawClient;
    const result = setup(path, url, process.env.M365_API_KEY || "", !!options["--dry-run"], !!options["--replace"]);
    console.log(JSON.stringify(result, null, 2));
    console.log(client === "pi" ? "Connect with: pi --provider m365 --model claude-sonnet" : options["--dry-run"] ? "Dry run only; no OpenClaw configuration was changed." : "OpenClaw provider m365 is configured; select m365/claude-sonnet in your client.");
    return;
  }
  if (command === "setup") {
    protectDataDir();
    if (!existsSync(configPath)) runtime.atomicWritePrivate(configPath, JSON.stringify(config, null, 2) + "\n");
    // A write probe fails early without touching any credential/cache file.
    const probe = join(dataDir, `.${randomUUID()}.write-check`);
    runtime.atomicWritePrivate(probe, "ok"); rmSync(probe);
    if (!existsSync(runtime.browserExecutable()) && !args.includes("--skip-browser")) {
      const require = createRequire(runtimeUrl);
      const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
      run(process.execPath, [cli, "install", "chromium"]);
    }
    console.log(`Setup complete. Data: ${dataDir}\nNext: m365-proxy login, then m365-proxy serve`);
    return;
  }
  if (command === "login") {
    protectDataDir();
    process.env.M365_NO_INTERACTIVE = "0";
    process.env.M365_ENABLE_INTERACTIVE_APPROVAL = "1";
    await runtime.getToken();
    console.log("Sign-in complete. You can now run m365-proxy service install and m365-proxy service start.");
    return;
  }
  if (command === "doctor" || command === "diagnostics") {
    // Deliberately exclude cache contents, browser state, env dumps, logs and prompts.
    const status = { node: process.version, platform: process.platform, dataDir, configured: existsSync(configPath), builtServer: existsSync(join(root, ".output/server/index.mjs")), browserAvailable: existsSync(runtime.browserExecutable()), port: config.port, host: config.host, proxyKeyConfigured: !!process.env.M365_API_KEY };
    if (command === "doctor" && args.includes("--live")) {
      await runtime.getToken();
      status.authentication = runtime.authenticationStatus().status;
    }
    if (command === "diagnostics") {
      const output = resolve(args[1] || "m365-diagnostics.json");
      runtime.atomicWritePrivate(output, JSON.stringify(status, null, 2) + "\n");
      console.log(`Credential-free diagnostics: ${output}`);
    } else console.log(JSON.stringify(status, null, 2));
    if (!status.builtServer || !status.browserAvailable) process.exitCode = 1;
    return;
  }
  process.env.PORT = process.env.NITRO_PORT = String(config.port);
  process.env.HOST = process.env.NITRO_HOST = config.host;
  process.env.M365_NO_INTERACTIVE ??= "1";
  // Foreground server with a private, nonce-protected local shutdown request.
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const instance = { pid: process.pid, executable: process.execPath, launcher, nonce: randomUUID(), started: new Date(Date.now() - process.uptime() * 1000).toISOString() };
  const instancePath = join(dataDir, "instance.json");
  const stopPath = join(dataDir, `shutdown-${instance.nonce}`);
  const timer = setInterval(() => { if (existsSync(stopPath)) { rmSync(stopPath, { force: true }); process.emit("SIGTERM"); } }, 500);
  timer.unref();
  // Don't overwrite another instance's control record.
  if (existsSync(instancePath)) {
    const previous = JSON.parse(readFileSync(instancePath, "utf8"));
    let alive = false;
    try { process.kill(previous.pid, 0); alive = true; } catch (error) { if (error.code !== "ESRCH") alive = true; }
    if (alive) throw new Error("Another proxy instance is recorded in this data directory; stop it before starting another");
    rmSync(instancePath);
  }
  writeFileSync(instancePath, JSON.stringify(instance), { flag: "wx", mode: 0o600 });
  process.on("exit", () => {
    try { if (JSON.parse(readFileSync(instancePath, "utf8")).nonce === instance.nonce) rmSync(instancePath); } catch {}
    clearInterval(timer);
  });
  await import(pathToFileURL(join(root, ".output/server/index.mjs")).href);
}
