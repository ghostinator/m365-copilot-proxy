// Explicit offline integration fixture. Production never loads this hook.
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@azure/msal-node") return { url: new URL("./msal-offline.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "ws") return { url: new URL("./ws-offline.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const fixtureFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const allowed = process.env.M365_TEST_NOTIFICATION_URL;
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (allowed && url.href === allowed && url.hostname === "127.0.0.1") return fixtureFetch(input, options);
  throw new Error("Outbound HTTP is disabled by the offline chat fixture");
};
