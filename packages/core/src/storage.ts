import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

/** Keep the historical location unless the operator explicitly selects another. */
export const CONFIG_DIR = resolve(process.env.M365_DATA_DIR || join(homedir(), ".config", "opencode-m365"));

export function atomicWritePrivate(path: string, contents: string): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temp, contents, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
    if (process.platform !== "win32") chmodSync(path, 0o600);
  } catch (error) {
    const failure = new Error(`Cannot persist state at ${path}; check the directory permissions and available disk space`, { cause: error });
    failure.name = "StatePersistenceError";
    throw failure;
  } finally {
    rmSync(temp, { force: true });
  }
}

let browserQueue: Promise<unknown> = Promise.resolve();
/** Serialize browser scopes, and refuse a profile already owned by another process. */
export function withBrowserProfile<T>(profile: string, operation: () => Promise<T>): Promise<T> {
  const next = browserQueue.catch(() => {}).then(async () => {
    mkdirSync(dirname(profile), { recursive: true, mode: 0o700 });
    const lock = `${profile}.login-lock`;
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number(readFileSync(lock, "utf8"));
      let alive = true;
      try { process.kill(owner, 0); } catch (e: any) { if (e.code === "ESRCH") alive = false; }
      if (alive || !Number.isInteger(owner) || owner <= 0) throw new Error("The M365 browser profile is in use. Close the other login/proxy and retry.");
      rmSync(lock);
      fd = openSync(lock, "wx", 0o600);
    }
    try {
      writeFileSync(fd, String(process.pid));
      return await operation();
    } finally { closeSync(fd); rmSync(lock, { force: true }); }
  });
  browserQueue = next;
  return next;
}

export function statePaths() {
  return { dataDir: CONFIG_DIR, cache: process.env.M365_CACHE_FILE || join(CONFIG_DIR, "msal-cache.json"), secrets: process.env.M365_SECRETS_FILE || join(CONFIG_DIR, "secrets.json"), browserProfile: process.env.M365_BROWSER_PROFILE || join(CONFIG_DIR, "browser-profile") };
}
