import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { atomicWritePrivate } from "@m365-copilot/core";
import type { OpenClawConfig } from "./index.js";

function object(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object; configuration was not changed`);
  return value as Record<string, any>;
}
export function mergeOpenClawConfig(existing: unknown, added: OpenClawConfig): Record<string, any> {
  const next = structuredClone(object(existing, "OpenClaw config"));
  const ensure = (parent: Record<string, any>, key: string) => parent[key] === undefined ? (parent[key] = {}) : object(parent[key], key);
  const models = ensure(next, "models");
  models.mode = "merge";
  ensure(models, "providers").m365 = added.models.providers.m365;
  Object.assign(ensure(ensure(ensure(next, "agents"), "defaults"), "models"), added.agents.defaults.models);
  return next;
}

export function updateOpenClawConfig(path: string, config: OpenClawConfig, dryRun = false) {
  // Parsing/validation MUST finish before either the original or its backup changes.
  const exists = existsSync(path);
  let existing: unknown = {};
  if (exists) {
    try { existing = JSON.parse(readFileSync(path, "utf8")); }
    catch { throw new Error(`Cannot parse ${path}; repair it first. The original file was not changed.`); }
  }
  const merged = mergeOpenClawConfig(existing, config);
  let backup: string | undefined;
  if (!dryRun) {
    if (exists) { backup = `${path}.${Date.now()}.${randomUUID()}.backup`; copyFileSync(path, backup); }
    atomicWritePrivate(path, JSON.stringify(merged, null, 2) + "\n");
  }
  return { merged, backup };
}
