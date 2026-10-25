import { historyDownloads } from "@m365-copilot/proxy-lib";
export default defineEventHandler(event => {
  const controller = new AbortController();
  event.node.res.once("close", () => controller.abort());
  return historyDownloads.consume(new Request(getRequestURL(event), { headers: getRequestHeaders(event) as HeadersInit, signal: controller.signal }));
});
