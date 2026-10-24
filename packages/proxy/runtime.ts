export { getToken, authenticationStatus, statePaths, atomicWritePrivate } from "@m365-copilot/core";
export { validateBind } from "@m365-copilot/proxy-lib";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
export function browserExecutable() { return process.env.CHROMIUM_PATH || chromium.executablePath(); }
