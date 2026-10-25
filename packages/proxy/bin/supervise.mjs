// Foreground watchdog with bounded logs and bounded child restarts.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const launcher = process.argv[2];
if (!launcher || !process.env.M365_DATA_DIR) throw new Error("Supervisor requires a launcher and M365_DATA_DIR");
const data = process.env.M365_DATA_DIR, logs = join(data, "service-logs");
mkdirSync(logs, { recursive: true, mode: 0o700 });
let child, restartTimer, stopping = false, failures = 0;
const configured = Number(process.env.M365_SERVICE_RESTARTS ?? 3);
const maxRestarts = Number.isInteger(configured) && configured >= 0 && configured <= 10 ? configured : 3;
function log(name, chunk) {
  const file = join(logs, name);
  const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  if (size > 0 && size + Buffer.byteLength(chunk) > 10 * 1024 * 1024) {
    rmSync(file + ".1", { force: true }); renameSync(file, file + ".1");
  }
  appendFileSync(file, chunk, { mode: 0o600 });
}
function capture(name, chunk) {
  try { log(name, chunk); }
  catch { stopping = true; child?.kill(); process.stderr.write("Cannot write service logs; check disk space and permissions\n"); process.exitCode = 1; }
}
function launch() {
  child = spawn(process.execPath, [launcher, "serve"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => capture("stdout.log", data));
  child.stderr.on("data", data => capture("stderr.log", data));
  child.on("error", error => { capture("stderr.log", String(error)); stopping = true; process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0 && code !== 78 && failures++ < maxRestarts) {
      capture("stderr.log", `[supervisor] child failed (${code ?? signal}); restarting in 5 seconds (${failures}/${maxRestarts})\n`);
      if (!stopping) restartTimer = setTimeout(launch, 5000);
      return;
    }
    // Preserve ordinary exit codes without assigning a Windows NTSTATUS to Node.
    process.exitCode = stopping ? (process.exitCode ?? 0) : code === 0 ? 0 : code === 78 ? 78 : Number.isInteger(code) && code > 0 && code <= 255 ? code : 1;
  });
}
launch();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  stopping = true; clearTimeout(restartTimer);
  try {
    const record = JSON.parse(readFileSync(join(data, "instance.json"), "utf8"));
    if (record.pid === child?.pid && /^[0-9a-f-]{36}$/.test(record.nonce)) writeFileSync(join(data, `shutdown-${record.nonce}`), "stop", { mode: 0o600 });
    else child?.kill();
  } catch { child?.kill(); }
});
