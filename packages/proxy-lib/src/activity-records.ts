import type { ActivityQuery } from "./activity-schema.js";
import { entry, CHAT_ENDPOINT_SQL_IDS } from "./activity-schema.js";
export type Binding = string | number | Uint8Array | null;
export const uuidBytes = (id: string) => Buffer.from(id.replaceAll("-", ""), "hex");
const uuidText = (id: Uint8Array) => Buffer.from(id).toString("hex").replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/, "$1-$2-$3-$4-$5");
const endpoints = entry.shape.endpoint.options, hour = 3_600_000;
const windows = { "24h": 24 * hour, "7d": 7 * 24 * hour, "30d": 30 * 24 * hour, "90d": 90 * 24 * hour, "365d": 365 * 24 * hour };
export const errorTypeSql = "COALESCE(json_extract((SELECT detail FROM request_errors WHERE request_id=r.request_id),'$.diagnostic.type'),'unknown')";
export const errorCodeSql = "COALESCE(json_extract((SELECT detail FROM request_errors WHERE request_id=r.request_id),'$.diagnostic.code'),'')";
export const errorCategorySql = `CASE WHEN r.outcome=2 THEN 'cancelled'
  WHEN ${errorTypeSql} LIKE '%auth%' OR COALESCE(r.application_status,r.status) IN(401,403) THEN 'authentication'
  WHEN ${errorTypeSql} LIKE '%throttl%' OR ${errorTypeSql} LIKE '%quota%' OR ${errorTypeSql} LIKE '%credit%' OR COALESCE(r.application_status,r.status)=429 THEN 'throttling'
  WHEN ${errorTypeSql} LIKE '%disengag%' OR ${errorTypeSql} LIKE '%model%' OR ${errorTypeSql} LIKE '%empty%' THEN 'model'
  WHEN ${errorTypeSql} LIKE '%valid%' OR COALESCE(r.application_status,r.status) IN(400,413,422) THEN 'validation'
  WHEN ${errorTypeSql} LIKE '%transport%' OR ${errorTypeSql} LIKE '%timeout%' OR ${errorTypeSql} LIKE '%network%' OR COALESCE(r.application_status,r.status) IN(502,503,504) THEN 'transport' ELSE 'other' END`;

/** The page and full export use exactly the same filters. SQL identifiers are fixed. */
export function requestSelection(query: ActivityQuery, now: number) {
  const conditions: string[] = [], bindings: Binding[] = [];
  if (query.range !== "all") { conditions.push("r.received_ms>=? AND r.received_ms<=?"); bindings.push(now - windows[query.range], now); }
  if (query.address) { conditions.push("s.address=?"); bindings.push(query.address); }
  if (query.model) { conditions.push("r.model=?"); bindings.push(query.model); }
  if (query.requestKind === "chat") conditions.push(`r.endpoint IN(${CHAT_ENDPOINT_SQL_IDS},${endpoints.indexOf("/v1/proxy/model-check")})`);
  if (query.requestKind === "errors") conditions.push("r.outcome<>0");
  if (query.requestKind === "checks") conditions.push("r.self_check=1");
  if (query.requestKey === "unattributed") conditions.push("r.application_id IS NULL");
  else if (query.requestKey) { conditions.push("r.application_id IN(SELECT id FROM request_applications WHERE key_id=?)"); bindings.push(query.requestKey); }
  if (query.requestId) { conditions.push("r.request_id=?"); bindings.push(uuidBytes(query.requestId)); }
  if (query.errorCategory !== "all") { conditions.push("r.outcome<>0", `(${errorCategorySql})=?`); bindings.push(query.errorCategory); }
  return { conditions, bindings, from: "FROM requests r JOIN systems s ON r.system_id=s.id" + (conditions.length ? " WHERE " + conditions.join(" AND ") : "") };
}
export const requestColumns = "r.*,s.address,a.key_id AS api_key_id,a.label AS api_key_label,t.first_byte_ms,t.queue_ms,t.attempts,t.failures,t.timeline,t.truncated,d.detail";
export function withRequestDetails(from: string) { return from.replace("JOIN systems s ON r.system_id=s.id", "JOIN systems s ON r.system_id=s.id LEFT JOIN request_applications a ON a.id=r.application_id LEFT JOIN request_timings t ON t.request_id=r.request_id LEFT JOIN request_errors d ON d.request_id=r.request_id"); }
export function decodeRequest(row: Record<string, unknown>) {
  return { id: uuidText(row.request_id as Uint8Array), address: String(row.address), receivedAt: new Date(Number(row.received_ms)).toISOString(), method: entry.shape.method.options[Number(row.method)], endpoint: endpoints[Number(row.endpoint)], source: Number(row.self_check) ? "self-check" : "application", status: Number(row.status), outcome: ["success", "error", "cancelled"][Number(row.outcome)], responseBytes: Number(row.bytes), durationMs: Number(row.duration_ms), model: row.model || null, servedModel: row.servedModel || null, clientSoftware: String(row.clientSoftware), streamed: row.streamed === null ? null : !!row.streamed, apiKeyId: row.api_key_id ?? null, apiKeyLabel: row.api_key_label ?? null, applicationStatus: row.application_status, firstByteMs: row.first_byte_ms ?? null, queueMs: row.queue_ms ?? null, upstreamAttempts: row.attempts ?? null, upstreamFailures: row.failures ?? null, timeline: row.timeline ? JSON.parse(String(row.timeline)) : [], timelineTruncated: !!row.truncated, timingRecorded: row.timeline !== null, diagnostic: row.detail ? JSON.parse(String(row.detail)).diagnostic ?? null : null };
}
