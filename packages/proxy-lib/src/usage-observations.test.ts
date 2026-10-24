import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { UsageObservations } from "./usage-observations.js";

const accountA = "a".repeat(64), accountB = "b".repeat(64);
const at = Date.parse("2026-10-24T12:00:00Z");
const metering = { ClaudeOpusQueryDaily: 39, ClaudeOpusQuery75: 74 };

it("persists only allowlisted observations and keeps accounts isolated across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-quota-"));
  const store = new UsageObservations(dir);
  store.record(accountA, "claude-opus", "claude-opus-4.5", { ...metering, privatePrompt: 123 }, at);
  const restarted = new UsageObservations(dir);
  expect(restarted.snapshot(accountA, at).budgets.opus).toEqual({ at, daily: 39, weekly: 74 });
  expect(restarted.snapshot(accountA, at).route).toMatchObject({ requested: "claude-opus", served: "claude-opus-4.5", fallbackUsed: true });
  expect(restarted.snapshot(accountB, at)).toEqual({ budgets: {}, route: null });
  expect(restarted.snapshot(accountA, at).budgets.opus?.daily).toBe(39);
  expect(restarted.snapshot(null, at)).toEqual({ budgets: {}, route: null });
  expect(readFileSync(join(dir, `quota-observations-${accountA}.json`), "utf8")).not.toContain("privatePrompt");
});

it("does not present expired/future observations as balances and drops unsupported model text", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-quota-stale-"));
  const store = new UsageObservations(dir);
  store.record(accountA, "secret-in-model-id", "unknown", metering, at);
  expect(store.snapshot(accountA, at).route).toBeNull();
  expect(readFileSync(join(dir, `quota-observations-${accountA}.json`), "utf8")).not.toContain("secret-in-model-id");
  expect(store.snapshot(accountA, at + 6 * 60 * 60_000)).toEqual({ budgets: {}, route: null });
  expect(store.snapshot(accountA, at - 60_000)).toEqual({ budgets: {}, route: null });
  store.record(accountA, "claude-opus", "claude-opus", metering, Date.parse("2026-10-24T23:59:00Z"));
  expect(store.snapshot(accountA, Date.parse("2026-10-25T00:00:00Z"))).toEqual({ budgets: {}, route: null });
});

it("treats malformed files as unknown and never carries counts over from a different window", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-quota-corrupt-"));
  writeFileSync(join(dir, `quota-observations-${accountA}.json`), '{broken');
  const store = new UsageObservations(dir);
  expect(store.snapshot(accountA, at)).toEqual({ budgets: {}, route: null });
  store.record(accountA, "claude-opus", "claude-opus", metering, at);
  store.record(accountA, "claude-opus", "claude-opus", { ClaudeOpusQueryDaily: 38 }, at + 1000);
  expect(store.snapshot(accountA, at + 1000).budgets.opus).toEqual({ at: at + 1000, daily: 38 });
  expect(() => store.snapshot("../outside", at)).toThrow();
});
