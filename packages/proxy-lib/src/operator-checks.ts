import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { authenticationStatus, getAvailableModels } from "@m365-copilot/core";
import { httpActivity } from "./http-activity.js";

const execute = promisify(execFile);
export interface Listener { host: string; port: number; pid: number | null; thisInstance: boolean }
export function parseWindowsListeners(text: string, ownPid = process.pid): Listener[] {
  const value = JSON.parse(text || "[]");
  return (Array.isArray(value) ? value : [value]).filter(item => item && typeof item.LocalAddress === "string" && /^[a-f0-9:.%]+$/i.test(item.LocalAddress) && Number.isInteger(item.LocalPort) && Number.isInteger(item.OwningProcess)).map(item => ({ host: item.LocalAddress, port: item.LocalPort, pid: item.OwningProcess, thisInstance: item.OwningProcess === ownPid }));
}
export function parseLinuxListeners(text: string, ownPid = process.pid): Listener[] {
  return text.trim().split("\n").filter(Boolean).flatMap(line => {
    const address = line.trim().split(/\s+/)[3];
    const match = address?.match(/^(.*):(\d+)$/);
    if (!match) return [];
    const host = match[1].replace(/^\[|\]$/g, "");
    if (!/^[a-f0-9:.%*]+$/i.test(host)) return [];
    const pidMatch = line.match(/pid=(\d+)/);
    const pid = pidMatch ? Number(pidMatch[1]) : null;
    return [{ host, port: Number(match[2]), pid, thisInstance: pid === ownPid }];
  });
}
export async function operatorChecks() {
  const port = Number(process.env.NITRO_PORT || process.env.PORT || 4141);
  let listeners: Listener[] = [];
  let listenerInspection: "available" | "unavailable" = "unavailable";
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    try {
      if (process.platform === "win32") {
        const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 });
        listeners = parseWindowsListeners(stdout);
        listenerInspection = "available";
      } else if (process.platform === "linux") {
        const { stdout } = await execute("ss", ["-ltnpH", `sport = :${port}`], { timeout: 5000, maxBuffer: 64 * 1024 });
        listeners = parseLinuxListeners(stdout);
        listenerInspection = "available";
      }
    } catch { /* Do not turn unavailable OS inspection into a failed proxy. */ }
  }
  return { instance: httpActivity.instance, authentication: authenticationStatus(), registeredModels: getAvailableModels().length, listenerInspection, listeners, upstream: "not_probed", note: "These checks never send a Microsoft chat. Listener identity describes local processes only." };
}
