import { operatorStatus, httpActivity, parseActivityQuery } from "@m365-copilot/proxy-lib";
import { pool } from "../../../server-pool";
export default defineEventHandler((event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  let query;
  try { query = parseActivityQuery(getRequestURL(event).searchParams); }
  catch { throw createError({ statusCode: 400, statusMessage: "Invalid activity range or pagination" }); }
  return operatorStatus(pool, httpActivity, query);
});
