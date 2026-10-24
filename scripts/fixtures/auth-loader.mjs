// Only loaded explicitly by offline installed-runtime tests, never by production.
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@azure/msal-node") return { url: new URL("./msal-offline.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
