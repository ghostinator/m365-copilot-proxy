import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { atomicWritePrivate, getAvailableModels } from "@m365-copilot/core";
import { modelCapabilities } from "./http-policy.js";

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object; configuration was not changed`);
  return value as Record<string, any>;
}

export function piProvider(baseUrl: string, apiKey: string) {
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use an HTTP(S) endpoint without credentials, query or fragment");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Use HTTPS for a remote client endpoint");
  url.pathname = url.pathname.replace(/\/$/, "");
  if (!url.pathname.endsWith("/v1")) throw new Error("The client endpoint must end in /v1");
  return {
    api: "openai-completions", baseUrl: url.href.replace(/\/$/, ""), apiKey: apiKey || "not-needed",
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: false },
    models: getAvailableModels().map(id => ({ id, name: id, ...modelCapabilities(id) })),
  };
}

/** Validate everything before writing, and preserve the exact previous bytes. */
export function setupPiClient(path: string, baseUrl: string, apiKey: string, dryRun = false, replace = false) {
  const provider = piProvider(baseUrl, apiKey);
  let original: string | undefined;
  let config: Record<string, any> = {};
  if (existsSync(path)) {
    original = readFileSync(path, "utf8");
    try { config = object(JSON.parse(original), "Pi configuration"); }
    catch { throw new Error("Cannot read pi configuration as an object; the original file was not changed"); }
  }
  const providers = config.providers === undefined ? {} : object(config.providers, "Pi providers");
  const previous = providers.m365;
  const changed = JSON.stringify(previous) !== JSON.stringify(provider);
  if (previous !== undefined && changed && !replace && !dryRun) throw new Error("The m365 provider already exists; use --replace to update it after reviewing --dry-run");
  let backup: string | null = null;
  if (!dryRun && changed) {
    if (original !== undefined) {
      backup = `${path}.${Date.now()}.${randomUUID()}.backup`;
      atomicWritePrivate(backup, original);
    }
    atomicWritePrivate(path, JSON.stringify({ ...config, providers: { ...providers, m365: provider } }, null, 2) + "\n");
  }
  return { path, baseUrl: provider.baseUrl, modelCount: provider.models.length, keyConfigured: !!apiKey, changed, dryRun, backup };
}
