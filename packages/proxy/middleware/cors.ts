/** Share the exact origin and API-key policy used by the embeddable app. */
import { corsHeaders, requestGate, httpActivity } from "@m365-copilot/proxy-lib";

export default defineEventHandler((event) => {
  const request = new Request(getRequestURL(event), { method: event.method, headers: getRequestHeaders(event) as HeadersInit });
  const finish = httpActivity.begin(request.method, new URL(request.url).pathname);
  if (finish) {
    event.node.res.once("finish", () => finish(event.node.res.statusCode));
    event.node.res.once("close", () => finish(event.node.res.writableFinished ? event.node.res.statusCode : 499));
  }
  for (const [key, value] of Object.entries(corsHeaders(request))) setResponseHeader(event, key, value);
  return requestGate(request) ?? undefined;
});
