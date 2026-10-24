/** Share the exact origin and API-key policy used by the embeddable app. */
import { corsHeaders, requestGate } from "@m365-copilot/proxy-lib";

export default defineEventHandler((event) => {
  const request = new Request(getRequestURL(event), { method: event.method, headers: getRequestHeaders(event) as HeadersInit });
  for (const [key, value] of Object.entries(corsHeaders(request))) setResponseHeader(event, key, value);
  return requestGate(request) ?? undefined;
});
