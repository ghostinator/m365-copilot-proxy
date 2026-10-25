import { operatorChecks } from "@m365-copilot/proxy-lib";
export default defineEventHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  return operatorChecks();
});
