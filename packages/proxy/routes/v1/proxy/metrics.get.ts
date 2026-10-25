import { metricsResponse, httpActivity } from "@m365-copilot/proxy-lib";
export default defineEventHandler(() => metricsResponse(httpActivity));
