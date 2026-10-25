// Nitro traces chat imports but misses Playwright's CLI and browser registry files.
// Copy the exact locked packages, so a release works outside pnpm's workspace.
import { createRequire } from "node:module";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const require = createRequire(new URL("../core/package.json", import.meta.url));
const playwrightRequire = createRequire(require.resolve("playwright/package.json"));
for (const name of ["playwright", "playwright-core"]) {
  const source = dirname((name === "playwright" ? require : playwrightRequire).resolve(`${name}/package.json`));
  const target = join(import.meta.dirname, ".output/server/node_modules", name);
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, dereference: true });
}
copyFileSync(new URL("../../LICENSE", import.meta.url), new URL("./LICENSE", import.meta.url));
copyFileSync(new URL("../../docs/operations.md", import.meta.url), new URL("./OPERATIONS.md", import.meta.url));

for (const name of ["dashboard-operations.md", "api-keys.md", "history-management.md", "observability.md", "notification-delivery.md"]) writeFileSync(new URL("./" + name, import.meta.url), readFileSync(new URL("../../docs/" + name, import.meta.url), "utf8").split("\n## Screenshots")[0]);

const notificationRequire = createRequire(new URL("../proxy-lib/package.json", import.meta.url));
cpSync(dirname(notificationRequire.resolve("nodemailer/package.json")), join(import.meta.dirname, ".output/server/node_modules/nodemailer"), { recursive: true, dereference: true });
