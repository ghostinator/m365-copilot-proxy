import { expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("bounds operator errors and excludes raw messages, credentials and unsafe component names", async () => {
  vi.stubEnv("M365_DATA_DIR", mkdtempSync(join(tmpdir(), "m365-operator-errors-")));
  vi.resetModules();
  const { createLogger, recentOperationalErrors } = await import("./log.js");
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    for (let i = 0; i < 25; i++) createLogger("handler").error("private prompt and Bearer super-secret", i);
    createLogger("private/user/path").error("password=hidden");
    const errors = recentOperationalErrors();
    expect(errors).toHaveLength(20);
    expect(errors.at(-1)?.component).toBe("runtime");
    expect(JSON.stringify(errors)).not.toMatch(/private|super-secret|hidden|password/);
    errors[0].summary = "changed outside the logger";
    expect(recentOperationalErrors()[0].summary).not.toBe("changed outside the logger");
  } finally { stderr.mockRestore(); vi.unstubAllEnvs(); }
});
