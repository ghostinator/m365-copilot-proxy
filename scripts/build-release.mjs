// Build a versioned, self-contained runtime archive; never includes user state.
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
// Git Bash GNU tar treats Windows drive letters as remote hosts. Use Windows bsdtar.
const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "packages/proxy/package.json"), "utf8")).version;
const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const destination = resolve(root, "release", `m365-proxy-${version}-${process.platform}-${process.arch}-${Date.now()}`);
mkdirSync(destination, { recursive: true });
for (const name of [".output", "bin", "windows"]) cpSync(join(root, "packages/proxy", name), join(destination, name), { recursive: true, dereference: true });
for (const name of ["LICENSE", "README.md"]) copyFileSync(join(root, name), join(destination, name));
copyFileSync(join(root, "docs/operations.md"), join(destination, "OPERATIONS.md"));
for (const name of ["dashboard-operations.md", "api-keys.md"]) copyFileSync(join(root, "packages/proxy", name), join(destination, name));
const includeNode = process.argv.includes("--include-node");
if (includeNode) copyFileSync(process.execPath, join(destination, process.platform === "win32" ? "node.exe" : "node"));
if (includeNode) {
  const candidates = [process.env.NODE_LICENSE_FILE, join(dirname(process.execPath), "LICENSE"), join(dirname(process.execPath), "..", "LICENSE")].filter(Boolean);
  const local = candidates.find(path => existsSync(path));
  if (local) copyFileSync(local, join(destination, "NODE_LICENSE.txt"));
  else {
    const url = `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Cannot retrieve the exact Node runtime license (${response.status}); set NODE_LICENSE_FILE to its local path`);
    writeFileSync(join(destination, "NODE_LICENSE.txt"), await response.text());
  }
}
writeFileSync(join(destination, "m365-proxy.cmd"), '@echo off\r\nif exist "%~dp0node.exe" (\r\n  "%~dp0node.exe" "%~dp0bin\\m365-proxy.mjs" %*\r\n) else (\r\n  node "%~dp0bin\\m365-proxy.mjs" %*\r\n)\r\nexit /b %errorlevel%\r\n');
writeFileSync(join(destination, "INSTALL.cmd"), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\\Install.ps1" %*\r\nexit /b %errorlevel%\r\n');
writeFileSync(join(destination, "m365-proxy"), '#!/bin/sh\nbase=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ -x "$base/node" ]; then exec "$base/node" "$base/bin/m365-proxy.mjs" "$@"; fi\nexec node "$base/bin/m365-proxy.mjs" "$@"\n', { mode: 0o755 });
const files = [];
function walk(dir, prefix = "") {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix + e.name;
    if (e.isDirectory()) walk(join(dir, e.name), relative + "/");
    else files.push({ path: relative, sha256: createHash("sha256").update(readFileSync(join(dir, e.name))).digest("hex") });
  }
}
walk(destination);
writeFileSync(join(destination, "manifest.json"), JSON.stringify({ version, revision, localChanges: !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(), platform: process.platform, architecture: process.arch, nodeVersion: process.version, bundledNode: includeNode, files }, null, 2) + "\n");
const archive = destination + ".tar.gz";
execFileSync(tar, ["-czf", archive, "-C", destination, "."], { windowsHide: true });
writeFileSync(archive + ".sha256", createHash("sha256").update(readFileSync(archive)).digest("hex") + "  " + archive.split(/[\\/]/).pop() + "\n");
let windowsArchive;
if (process.platform === "win32") {
  windowsArchive = destination + ".zip";
  execFileSync(tar, ["-a", "-cf", windowsArchive, "-C", destination, "."], { windowsHide: true });
  writeFileSync(windowsArchive + ".sha256", createHash("sha256").update(readFileSync(windowsArchive)).digest("hex") + "  " + windowsArchive.split(/[\\/]/).pop() + "\n");
}
console.log(JSON.stringify({ directory: destination, archive, windowsArchive }, null, 2));
