import type { HttpActivity } from "./http-activity.js";
import { storageHistoryRange } from "./storage-history.js";
export function storageHistoryResponse(req: Request, activity: HttpActivity) {
  const params=new URL(req.url).searchParams;
  const parsed=storageHistoryRange.safeParse(params.get("range")??"7d");
  const headers={"Cache-Control":"no-store"};
  if(!parsed.success||params.size>1||[...params.keys()].some(k=>k!=="range"))return Response.json({error:{type:"invalid_storage_range",message:"Choose 24h, 7d, 30d, 90d, 365d or all."}},{status:400,headers});
  const result=activity.sources.storageHistory.snapshot(parsed.data);
  return Response.json(result,{status:result.error?503:200,headers});
}
