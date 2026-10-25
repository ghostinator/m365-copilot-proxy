import { storageHistoryResponse, httpActivity } from "@m365-copilot/proxy-lib";
export default defineEventHandler(event => storageHistoryResponse(new Request(getRequestURL(event)), httpActivity));
