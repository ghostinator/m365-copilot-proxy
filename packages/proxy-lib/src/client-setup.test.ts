import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { piProvider, setupPiClient } from "./client-setup.js";

it("preserves unrelated providers and exact backup bytes; dry-run does not write", () => {
  const path = join(mkdtempSync(join(tmpdir(), "m365-client-")), "models.json");
  const original = '{ "providers": { "other": { "apiKey": "preserve-me" } }, "extra": 42 }\n';
  writeFileSync(path, original);
  const dry = setupPiClient(path, "http://127.0.0.1:4141/v1", "proxy-secret", true);
  expect(readFileSync(path, "utf8")).toBe(original);
  expect(dry.backup).toBeNull();
  expect(JSON.stringify(dry)).not.toContain("proxy-secret");
  const result = setupPiClient(path, "http://127.0.0.1:4141/v1", "proxy-secret");
  expect(readFileSync(result.backup!, "utf8")).toBe(original);
  const merged = JSON.parse(readFileSync(path, "utf8"));
  expect(merged.extra).toBe(42);
  expect(merged.providers.other.apiKey).toBe("preserve-me");
  expect(merged.providers.m365.apiKey).toBe("proxy-secret");
  expect(merged.providers.m365.models.some((m: any) => m.id === "claude-sonnet")).toBe(true);
  expect(setupPiClient(path, "http://127.0.0.1:4141/v1", "proxy-secret").changed).toBe(false);
  expect(() => setupPiClient(path, "http://127.0.0.1:4142/v1", "proxy-secret")).toThrow(/--replace/);
  expect(setupPiClient(path, "http://127.0.0.1:4142/v1", "proxy-secret", true).changed).toBe(true);
  expect(JSON.parse(readFileSync(path, "utf8")).providers.m365.baseUrl).toBe("http://127.0.0.1:4141/v1");
});

it("never overwrites malformed configuration and creates no directories in dry-run", () => {
  const root = mkdtempSync(join(tmpdir(), "m365-client-invalid-"));
  const path = join(root, "models.json");
  writeFileSync(path, '{broken');
  expect(() => setupPiClient(path, "http://localhost:4141/v1", "")).toThrow();
  expect(readFileSync(path, "utf8")).toBe('{broken');
  const absent = join(root, "absent", "models.json");
  setupPiClient(absent, "http://localhost:4141/v1", "", true);
  expect(existsSync(join(root, "absent"))).toBe(false);
});

it("rejects credentials in URLs and plaintext remote endpoints", () => {
  for (const url of ["http://remote.example/v1", "https://user:pass@example.com/v1", "file:///v1", "https://example.com/v1?key=secret", "https://example.com/wrong"]) expect(() => piProvider(url, "")).toThrow();
  expect(piProvider("https://example.com/v1", "").baseUrl).toBe("https://example.com/v1");
});
