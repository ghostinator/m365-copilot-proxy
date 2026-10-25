// Verify hashes and run the distributed CLI outside the workspace, with empty state.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const supplied = process.argv[2];
if (!supplied) throw new Error("Usage: node scripts/verify-release.mjs <release-directory>");
const source = resolve(supplied);
const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
for (const file of manifest.files) {
  const hash = createHash("sha256").update(readFileSync(join(source, file.path))).digest("hex");
  if (hash !== file.sha256) throw new Error(`Hash mismatch: ${file.path}`);
}
const temp = mkdtempSync(join(tmpdir(), "m365-release-check-"));
const app = join(temp, "app with spaces");
cpSync(source, app, { recursive: true });
const env = { ...process.env, M365_DATA_DIR: join(temp, "empty-state"), M365_NO_INTERACTIVE: "1", M365_ENABLE_INTERACTIVE_APPROVAL: "0" };
delete env.NODE_PATH;
const launcher = join(app, "bin/m365-proxy.mjs");
const executable = manifest.bundledNode ? join(app, process.platform === "win32" ? "node.exe" : "node") : process.execPath;
execFileSync(executable, [launcher, "--help"], { cwd: temp, env, windowsHide: true });
execFileSync(executable, [launcher, "setup", "--skip-browser"], { cwd: temp, env, windowsHide: true });
// doctor deliberately exits 1 if Chromium is absent on the clean runner.
const { spawnSync } = await import("node:child_process");
const doctor = spawnSync(executable, [launcher, "doctor"], { cwd: temp, env, encoding: "utf8", windowsHide: true });
const status = JSON.parse(doctor.stdout);
if (!status.builtServer || ![0, 1].includes(doctor.status)) throw new Error("The installed doctor failed");
execFileSync(executable, [join(import.meta.dirname, "test-installed-runtime.mjs"), launcher], { cwd: temp, env, windowsHide: true, stdio: "inherit" });
console.log(`Verified ${manifest.files.length} hashes and isolated CLI startup in ${app}`);
