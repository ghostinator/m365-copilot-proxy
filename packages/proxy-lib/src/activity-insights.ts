import type { DatabaseSync } from "node:sqlite";
import { entry, type ActivityQuery } from "./activity-schema.js";

const durations = { "24h": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000, "90d": 90 * 86400000, "365d": 365 * 86400000 };

/** Exact samples, not interpolated estimates; missing historical timing stays null. */
export function activityInsights(db: DatabaseSync, query: ActivityQuery, now: number) {
  const conditions = ["r.received_ms<=?"], bindings: (number | string)[] = [now];
  if (query.range !== "all") { conditions.push("r.received_ms>=?"); bindings.push(now - durations[query.range]); }
  if (query.model) { conditions.push("r.model=?"); bindings.push(query.model); }
  if (query.address) { conditions.push("r.system_id=(SELECT id FROM systems WHERE address=?)"); bindings.push(query.address); }
  // Health checks and model-list polls have very different latency from chat.
  conditions.push("r.self_check=0", `r.endpoint=${entry.shape.endpoint.options.indexOf("/v1/chat/completions")}`);
  const from = `FROM requests r LEFT JOIN request_timings t ON r.request_id=t.request_id WHERE ${conditions.join(" AND ")}`;
  const summary = db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(r.outcome=0),0) AS succeeded,
    COALESCE(SUM(r.outcome=1),0) AS failed,COALESCE(SUM(r.outcome=2),0) AS cancelled,
    AVG(t.first_byte_ms) AS firstByteMs,COUNT(t.first_byte_ms) AS firstByteSamples,
    AVG(t.queue_ms) AS queueMs,COUNT(t.queue_ms) AS queueSamples,MIN(r.received_ms) AS firstAt ${from}`).get(...bindings)!;
  const quantiles = db.prepare(`WITH ranked AS(SELECT r.duration_ms,ROW_NUMBER() OVER(ORDER BY r.duration_ms) AS rank,COUNT(*) OVER() AS n ${from})
    SELECT MIN(CASE WHEN rank>=((n*50+99)/100) THEN duration_ms END) AS p50Ms,
      MIN(CASE WHEN rank>=((n*95+99)/100) THEN duration_ms END) AS p95Ms FROM ranked`).get(...bindings)!;
  const start = query.range === "all" ? Number(summary.firstAt ?? now - durations["24h"]) : now - durations[query.range];
  const bucketMs = Math.max(60000, Math.ceil((now - start + 1) / 48 / 60000) * 60000);
  const rows = db.prepare(`SELECT CAST((r.received_ms-?)/? AS INTEGER) AS bucket,COUNT(*) AS total,
    SUM(r.outcome=0) AS succeeded,SUM(r.outcome=1) AS failed,SUM(r.outcome=2) AS cancelled,
    AVG(r.duration_ms) AS durationMs,AVG(t.first_byte_ms) AS firstByteMs,AVG(t.queue_ms) AS queueMs
    ${from} GROUP BY bucket ORDER BY bucket`).all(start, bucketMs, ...bindings);
  const indexed = new Map(rows.map(row => [Number(row.bucket), row]));
  const buckets = Array.from({ length: Math.min(48, Math.floor((now - start) / bucketMs) + 1) }, (_, bucket) => ({
    at: start + bucket * bucketMs, total: 0, succeeded: 0, failed: 0, cancelled: 0,
    durationMs: null as number | null, firstByteMs: null as number | null, queueMs: null as number | null,
    ...indexed.get(bucket),
  }));
  return { ...summary, ...quantiles, successRate: Number(summary.total) ? Number(summary.succeeded) / Number(summary.total) : null,
    scope: "completed application chat requests", bucketMs, buckets };
}

/** Check reports are not attributed to a client: one check can span two requests. */
export function modelCheckHistory(db: DatabaseSync, query: ActivityQuery, now: number) {
  const conditions = ["checked_ms<=?"], bindings: (number | string)[] = [now];
  if (query.range !== "all") { conditions.push("checked_ms>=?"); bindings.push(now - durations[query.range]); }
  if (query.model) { conditions.push("model=?"); bindings.push(query.model); }
  if (query.checkKind !== "all") { conditions.push("kind=?"); bindings.push(query.checkKind); }
  const where = `FROM model_checks WHERE ${conditions.join(" AND ")}`;
  const total = Number(db.prepare(`SELECT COUNT(*) AS count ${where}`).get(...bindings)!.count);
  const offset = Math.min(query.checkOffset, Math.max(0, Math.ceil(total / query.checkLimit) - 1) * query.checkLimit);
  const reports = db.prepare(`SELECT seq,model,kind,verdict,evidence,turns,
    (SELECT previous.verdict FROM model_checks previous WHERE previous.model=model_checks.model AND previous.kind=model_checks.kind AND previous.seq<model_checks.seq ORDER BY previous.seq DESC LIMIT 1) AS previousVerdict,
    (SELECT previous.served_model FROM model_checks previous WHERE previous.model=model_checks.model AND previous.kind=model_checks.kind AND previous.seq<model_checks.seq ORDER BY previous.seq DESC LIMIT 1) AS previousServedModel,checked_ms AS checkedAt,status,identity,
    served_model AS servedModel,duration_ms AS durationMs ${where} ORDER BY checked_ms DESC,seq DESC LIMIT ? OFFSET ?`).all(...bindings, query.checkLimit, offset);
  const summary = db.prepare(`SELECT model,kind,COUNT(*) AS samples,SUM(verdict='passed') AS passed,
    SUM(verdict='failed') AS failed,SUM(verdict='error') AS errors,SUM(verdict NOT IN('passed','failed','error')) AS reported,
    AVG(duration_ms) AS averageDurationMs ${where} GROUP BY model,kind ORDER BY model,kind`).all(...bindings);
  return { reports, summary, total, offset, limit: query.checkLimit, clientFilterApplies: false };
}
