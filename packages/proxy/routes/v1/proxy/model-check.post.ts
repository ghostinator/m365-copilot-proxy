import { runModelCheck, readJsonBody, httpActivity } from "@m365-copilot/proxy-lib";
import { pool } from "../../../server-pool";

export default defineEventHandler(async (event) => {
  let value: unknown;
  try { value = await readJsonBody(getRequestWebStream(event), getHeader(event, "content-length")); }
  catch { return Response.json({ error: { type: "invalid_request", message: "Expected a model selection" } }, { status: 400, headers: { "Connection": "close" } }); }
  const controller = new AbortController();
  const res = event.node.res;
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  event.node.req.once("aborted", abort); res.once("close", abort);
  return runModelCheck(value, pool, httpActivity, event.context.proxyActivity, controller.signal);
});
