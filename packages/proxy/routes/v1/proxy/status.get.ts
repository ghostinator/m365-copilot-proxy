import { operatorStatus } from "@m365-copilot/proxy-lib";
import { pool } from "../../../server-pool";
export default defineEventHandler((event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  return operatorStatus(pool);
});
