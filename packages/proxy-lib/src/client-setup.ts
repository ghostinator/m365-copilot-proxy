import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { atomicWritePrivate, getAvailableModels } from "@m365-copilot/core";
import { modelCapabilities } from "./http-policy.js";
import { generateOpenClawConfig } from "./openclaw-config.js";

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

/** Standalone setup uses the same model generator as the OpenClaw plugin. */
export function setupOpenClawClient(path: string, baseUrl: string, apiKey: string, dryRun = false, replace = false) {
  const endpoint = piProvider(baseUrl, apiKey); // same URL/transport validation
  const added = generateOpenClawConfig();
  added.models.providers.m365.baseUrl = endpoint.baseUrl;
  added.models.providers.m365.apiKey = endpoint.apiKey;
  let original: string | undefined;
  let config: Record<string, any> = {};
  if (existsSync(path)) {
    original = readFileSync(path, "utf8");
    try { config = object(JSON.parse(original), "OpenClaw configuration"); }
    catch { throw new Error("Cannot read OpenClaw configuration as JSON; the original file was not changed"); }
  }
  const models = config.models === undefined ? {} : object(config.models, "models");
  const providers = models.providers === undefined ? {} : object(models.providers, "providers");
  const agents = config.agents === undefined ? {} : object(config.agents, "agents");
  const defaults = agents.defaults === undefined ? {} : object(agents.defaults, "agents.defaults");
  const allowlist = defaults.models === undefined ? {} : object(defaults.models, "agents.defaults.models");
  const provider = added.models.providers.m365;
  const providerChanged = JSON.stringify(providers.m365) !== JSON.stringify(provider);
  if (providers.m365 !== undefined && providerChanged && !replace && !dryRun) throw new Error("The m365 provider already exists; use --replace after reviewing --dry-run");
  const merged = { ...config, models: { ...models, mode: "merge", providers: { ...providers, m365: provider } }, agents: { ...agents, defaults: { ...defaults, models: { ...added.agents.defaults.models, ...allowlist } } } };
  const changed = JSON.stringify(config) !== JSON.stringify(merged);
  let backup: string | null = null;
  if (!dryRun && changed) {
    if (original !== undefined) { backup = `${path}.${Date.now()}.${randomUUID()}.backup`; atomicWritePrivate(backup, original); }
    atomicWritePrivate(path, JSON.stringify(merged, null, 2) + "\n");
  }
  return { path, baseUrl: provider.baseUrl, modelCount: provider.models.length, keyConfigured: !!apiKey, changed, dryRun, backup };
}
