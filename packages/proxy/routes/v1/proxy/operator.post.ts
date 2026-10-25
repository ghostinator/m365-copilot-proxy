import { operatorAction, incomingRequestBody, httpActivity } from "@m365-copilot/proxy-lib";
export default defineEventHandler(event => {
  const headers = getRequestHeaders(event) as HeadersInit;
  const req = new Request(getRequestURL(event), { method: "POST", headers, body: incomingRequestBody(event.node.req), duplex: "half" } as RequestInit);
  return operatorAction(req, httpActivity);
});
