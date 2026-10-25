// Detached restart handoff. Never kills another PID or starts before the old instance exits.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
const [pidText, nonce, launcher] = process.argv.slice(2), pid = Number(pidText);
const data = process.env.M365_DATA_DIR;
if (!data || !Number.isSafeInteger(pid) || pid <= 0 || !/^[0-9a-f-]{36}$/.test(nonce) || !launcher) throw new Error("Invalid restart handoff");
const path = join(data, "instance.json");
const instance = JSON.parse(readFileSync(path, "utf8"));
if (instance.pid !== pid || instance.nonce !== nonce || instance.launcher !== launcher || instance.executable !== process.execPath) throw new Error("Restart instance changed");
process.send?.("ready");
const deadline = Date.now() + 30_000;
let exited = false;
while (Date.now() < deadline) {
  try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") { exited = true; break; } }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!exited || existsSync(path)) {
  appendFileSync(join(data, "restart-error.log"), `${new Date().toISOString()} Restart cancelled: previous process did not exit cleanly.\n`, { mode: 0o600 });
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [join(dirname(launcher), "supervise.mjs"), launcher], { detached: true, windowsHide: true, stdio: "ignore", env: process.env });
  child.on("error", () => { appendFileSync(join(data, "restart-error.log"), `${new Date().toISOString()} Replacement process could not start.\n`, { mode: 0o600 }); process.exitCode = 1; });
  child.unref();
}
