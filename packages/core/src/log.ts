import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { CONFIG_DIR } from "./storage.js";
// M365_LOG_FILE and M365_FRAME_DIR are relative to CONFIG_DIR (an absolute path
// is taken as is), so a bench sweep can point each proxy straight into its archive.
const LOG_FILE = resolve(CONFIG_DIR, process.env.M365_LOG_FILE || "debug.log");
const LOG_DIR = dirname(LOG_FILE);
/** Where M365_DUMP_FRAMES=1 writes one `<requestId>.ndjson` per turn. */
export const FRAME_DIR = resolve(CONFIG_DIR, process.env.M365_FRAME_DIR || "frames");

// M365_TRACE implies debug logging and disables all payload truncation, so
// every WS frame, prompt, and response is recorded in full for reverse
// engineering. M365_DEBUG keeps the lighter, truncated logging.
const flag = (value: string | undefined) => !!value && !/^(0|false|no|off)$/i.test(value);
const trace = flag(process.env.M365_TRACE);
const enabled = flag(process.env.M365_DEBUG) || trace;
// Tailing ~/.config/opencode-m365/debug.log in a second terminal is the usual
// way to watch a run; this mirrors the same lines to the proxy's own stdout so
// one terminal is enough. Safe here because the proxy speaks HTTP — stdout is
// not a protocol channel.
const stdoutEnabled = flag(process.env.M365_LOG_STDOUT);

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: string, component: string, ...args: unknown[]) {
  if (level === "DEBUG" && !enabled) return;
  if (!enabled && !stdoutEnabled && level !== "ERROR") return;
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
    .join(" ");
  const safe = msg.replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]").replace(/((?:access_token|refresh_token|password|mfaSecret)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, "$1[redacted]");
  const line = `[${timestamp()}] [${level}] [${component}] ${safe.slice(0, trace ? 1_000_000 : 16_000)}\n`;
  if (stdoutEnabled || level === "ERROR") process.stderr.write(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    if (statSync(LOG_FILE, { throwIfNoEntry: false })?.size! > 10 * 1024 * 1024) {
      rmSync(`${LOG_FILE}.1`, { force: true });
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
    appendFileSync(LOG_FILE, line, { mode: 0o600 });
  } catch {
    // best effort
  }
}

export function createLogger(component: string) {
  return {
    info: (...args: unknown[]) => write("INFO", component, ...args),
    error: (...args: unknown[]) => write("ERROR", component, ...args),
    debug: (...args: unknown[]) => write("DEBUG", component, ...args),
  };
}

/**
 * Truncate a string for logging unless M365_TRACE is set, in which case the
 * full value is returned so the debug file captures complete payloads.
 */
export function trunc(value: string, limit: number): string {
  if (trace) return value;
  return value.slice(0, limit);
}

export const LOG_PATH = LOG_FILE;

/** Whether this process writes its debug log (M365_DEBUG / M365_TRACE). */
export function fileLoggingEnabled(): boolean {
  return enabled || stdoutEnabled;
}
