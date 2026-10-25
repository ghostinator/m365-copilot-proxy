import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const result = spawnSync(process.execPath, [cli, "run"], { stdio: "inherit", env: { ...process.env, M365_LIVE: "1" } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
