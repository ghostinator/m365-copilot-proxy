import { defineConfig } from "tsdown";
export default defineConfig({ entry: ["runtime.ts"], outDir: ".output/server", clean: false, format: "esm", deps: { alwaysBundle: [/^@m365-copilot\//], neverBundle: [/^(?!@m365-copilot\/)[@a-z]/] } });
