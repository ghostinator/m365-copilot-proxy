// Explicit offline integration fixture. Production never loads this hook.
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@azure/msal-node") return { url: new URL("./msal-offline.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "ws") return { url: new URL("./ws-offline.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
globalThis.fetch = async () => { throw new Error("Outbound HTTP is disabled by the offline chat fixture"); };
