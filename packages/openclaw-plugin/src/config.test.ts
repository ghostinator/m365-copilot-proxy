import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { generateOpenClawConfig } from "./index.js";
import { updateOpenClawConfig } from "./config.js";
describe("safe config update", () => {
  it("leaves malformed configuration byte-for-byte intact and creates no backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "m365-config-")); const path = join(dir, "openclaw.json");
    writeFileSync(path, "{broken");
    expect(() => updateOpenClawConfig(path, generateOpenClawConfig())).toThrow("not changed");
    expect(readFileSync(path, "utf8")).toBe("{broken"); expect(readdirSync(dir)).toHaveLength(1);
  });
  it("preserves other settings, creates an exact backup, and supports dry-run", () => {
    const dir = mkdtempSync(join(tmpdir(), "m365-config-")); const path = join(dir, "openclaw.json");
    const original = JSON.stringify({ custom: true, models: { providers: { other: { key: "keep" } } } });
    writeFileSync(path, original);
    updateOpenClawConfig(path, generateOpenClawConfig(), true);
    expect(readFileSync(path, "utf8")).toBe(original);
    const updated = updateOpenClawConfig(path, generateOpenClawConfig());
    expect(readFileSync(updated.backup!, "utf8")).toBe(original);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ custom: true, models: { providers: { other: { key: "keep" } } } });
  });
});
