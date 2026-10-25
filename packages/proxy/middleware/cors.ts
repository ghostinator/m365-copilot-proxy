/** Share the exact origin and API-key policy used by the embeddable app. */
import { corsHeaders, requestGate, httpActivity, proxyApiKeys, drainingResponse } from "@m365-copilot/proxy-lib";

export default defineEventHandler((event) => {
  const request = new Request(getRequestURL(event), { method: event.method, headers: getRequestHeaders(event) as HeadersInit });
  setResponseHeader(event, "X-M365-Proxy-Instance", httpActivity.instance.id);
  setResponseHeader(event, "X-M365-Proxy-Version", httpActivity.instance.version);
  const finish = httpActivity.begin(request.method, new URL(request.url).pathname, (request.headers.get("x-m365-check") === "1" || new URL(request.url).pathname === "/v1/proxy/model-check"), event.node.req.socket.remoteAddress, request.headers.get("user-agent") ?? undefined);
  event.context.proxyActivity = finish;
  if (finish) {
    setResponseHeader(event, "X-M365-Request-Id", finish.id);
    const response = event.node.res;
    const originalWrite = response.write;
    const originalEnd = response.end;
    let errorText = "";
    const count = (chunk: unknown, encoding: unknown) => {
      if (response.statusCode >= 400 && errorText.length < 16384 && (typeof chunk === "string" || chunk instanceof Uint8Array)) errorText += (typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")).slice(0,16384-errorText.length);
      if (typeof chunk === "string") finish.output(Buffer.byteLength(chunk, typeof encoding === "string" ? encoding as BufferEncoding : "utf8"));
      else if (chunk instanceof Uint8Array) finish.output(chunk.byteLength);
    };
    response.write = function (...args: any[]) { count(args[0], args[1]); return (originalWrite as any).apply(this, args); } as typeof response.write;
    response.end = function (...args: any[]) { count(args[0], args[1]); return (originalEnd as any).apply(this, args); } as typeof response.end;
    event.node.res.once("finish", () => { if (errorText) finish.errorBody(errorText); finish(event.node.res.statusCode); });
    event.node.res.once("close", () => finish(event.node.res.writableFinished ? event.node.res.statusCode : 499));
  }
  for (const [key, value] of Object.entries(corsHeaders(request))) setResponseHeader(event, key, value);
  const gate = requestGate(request) ?? drainingResponse(request);
  if (!gate && new URL(request.url).pathname !== "/v1/proxy/operator") finish?.applicationKey(proxyApiKeys.authorize(request.headers).application);
  return gate ?? undefined;
});
