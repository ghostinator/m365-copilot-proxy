import type { DatabaseSync } from "node:sqlite";
import { entry, CHAT_ENDPOINT_SQL_IDS, type ActivityQuery } from "./activity-schema.js";

const day = 86_400_000;
const windows = { "24h": day, "7d": 7 * day, "30d": 30 * day, "90d": 90 * day, "365d": 365 * day };
const counts = "COUNT(*) AS total,SUM(outcome=0) AS succeeded,SUM(outcome=1) AS failed,SUM(outcome=2) AS cancelled";
function metrics(row: Record<string, unknown> | undefined) {
  const total = Number(row?.total ?? 0), succeeded = Number(row?.succeeded ?? 0);
  return { total, succeeded, failed: Number(row?.failed ?? 0), cancelled: Number(row?.cancelled ?? 0),
    successRate: total ? succeeded / total : null, averageDurationMs: row?.averageDurationMs == null ? null : Number(row.averageDurationMs),
    p95Ms: row?.p95Ms == null ? null : Number(row.p95Ms) };
}

/** Observations only. Never sends a model request or interprets HTTP success as answer quality. */
export function modelReliability(db: DatabaseSync, query: ActivityQuery, now: number) {
  const span = query.range === "all" ? null : windows[query.range], start = span === null ? null : now - span;
  const conditions = ["r.received_ms<=?", "r.self_check=0", `r.endpoint IN(${CHAT_ENDPOINT_SQL_IDS})`];
  const bindings: (string | number)[] = [now];
  if (span !== null) { conditions.push("r.received_ms>?"); bindings.push(now - 2 * span); }
  if (query.model) { conditions.push("r.model=?"); bindings.push(query.model); }
  if (query.address) { conditions.push("r.system_id=(SELECT id FROM systems WHERE address=?)"); bindings.push(query.address); }
  if (query.requestKey === "unattributed") conditions.push("r.application_id IS NULL");
  else if (query.requestKey) { conditions.push("r.application_id IN(SELECT id FROM request_applications WHERE key_id=?)"); bindings.push(query.requestKey); }
  // Period boundaries are exclusive at the lower end, inclusive at the upper end.
  const base = `WITH selected AS(SELECT r.model,r.servedModel,r.outcome,r.duration_ms,r.received_ms,${start === null ? "1" : `CASE WHEN r.received_ms>${start} THEN 1 ELSE 0 END`} AS period
    FROM requests r WHERE ${conditions.join(" AND ")})`;
  const totals = db.prepare(`${base} SELECT period,${counts},AVG(duration_ms) AS averageDurationMs,MIN(received_ms) AS firstAt FROM selected GROUP BY period`).all(...bindings);
  const current = metrics(totals.find(r => r.period === 1)), previous = span === null ? null : metrics(totals.find(r => r.period === 0));
  const rows = db.prepare(`${base},ranked AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY model,servedModel,period ORDER BY duration_ms) AS rank,
    COUNT(*) OVER(PARTITION BY model,servedModel,period) AS n FROM selected),
    grouped AS(SELECT model,servedModel,period,${counts},AVG(duration_ms) AS averageDurationMs,
    MIN(CASE WHEN rank>=((n*95+99)/100) THEN duration_ms END) AS p95Ms FROM ranked GROUP BY model,servedModel,period),
    routes AS(SELECT model,servedModel,SUM(CASE WHEN period=1 THEN total ELSE 0 END) AS volume,
    SUM(total) AS combined FROM grouped GROUP BY model,servedModel)
    SELECT a.model,a.servedModel,a.volume,a.combined,COUNT(*) OVER() AS groups,
    c.total,c.succeeded,c.failed,c.cancelled,c.averageDurationMs,c.p95Ms,
    p.total AS previousTotal,p.succeeded AS previousSucceeded,p.failed AS previousFailed,p.cancelled AS previousCancelled,
    p.averageDurationMs AS previousAverageDurationMs,p.p95Ms AS previousP95Ms FROM routes a
    LEFT JOIN grouped c ON c.model=a.model AND c.servedModel=a.servedModel AND c.period=1
    LEFT JOIN grouped p ON p.model=a.model AND p.servedModel=a.servedModel AND p.period=0
    ORDER BY a.volume DESC,a.combined DESC,a.model,a.servedModel LIMIT 100`).all(...bindings);
  const routes = rows.map(row => {
    const current = metrics(row), previous = span === null ? null : metrics({ total: row.previousTotal, succeeded: row.previousSucceeded,
      failed: row.previousFailed, cancelled: row.previousCancelled, averageDurationMs: row.previousAverageDurationMs, p95Ms: row.previousP95Ms });
    return { model: String(row.model) || null, servedModel: String(row.servedModel) || null, current, previous,
      changePoints: current.successRate === null || previous?.successRate == null ? null : (current.successRate - previous.successRate) * 100 };
  });
  const bucketStart = start ?? Number(totals.find(r => r.period === 1)?.firstAt ?? now - day);
  const bucketMs = Math.max(60_000, Math.ceil((now - bucketStart + 1) / 48 / 60_000) * 60_000);
  const buckets = db.prepare(`${base} SELECT CAST((received_ms-?)/? AS INTEGER) AS bucket,${counts},AVG(duration_ms) AS averageDurationMs
    FROM selected WHERE period=1 GROUP BY bucket ORDER BY bucket`).all(...bindings, bucketStart, bucketMs);
  const indexed = new Map(buckets.map(row => [Number(row.bucket), row]));
  return { current, previous, from: start, to: now, previousFrom: span === null ? null : now - 2 * span,
    scope: "completed application chat requests", routeLimit: 100, routeCount: Number(rows[0]?.groups ?? 0), routes, bucketMs,
    buckets: Array.from({ length: Math.min(48, Math.floor((now - bucketStart) / bucketMs) + 1) }, (_, i) => ({ at: bucketStart + i * bucketMs, ...metrics(indexed.get(i)) })) };
}
