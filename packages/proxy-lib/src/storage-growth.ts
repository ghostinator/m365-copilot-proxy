import type { DatabaseSync } from "node:sqlite";
import { filesystemCapacity } from "./storage-footprint.js";

const day = 86_400_000;
/** A planning estimate, not measured marginal growth. WAL churn is excluded from density. */
export function storageGrowth(db: DatabaseSync, directory: string | undefined, now: number) {
  const row = db.prepare(`SELECT (SELECT MIN(received_ms) FROM requests WHERE received_ms<=?) AS firstAt,
    (SELECT COUNT(*) FROM requests WHERE received_ms>? AND received_ms<=?) AS recent,
    (SELECT COUNT(*) FROM requests) AS records`).get(now, now - 7 * day, now)!;
  const records = Number(row.records), recent = Number(row.recent);
  const logicalBytes = (Number(db.prepare("PRAGMA page_count").get()!.page_count) - Number(db.prepare("PRAGMA freelist_count").get()!.freelist_count)) * Number(db.prepare("PRAGMA page_size").get()!.page_size);
  const observedMs = row.firstAt == null ? 0 : Math.min(7 * day, Math.max(0, now - Number(row.firstAt)));
  const { freeBytes, capacityBytes } = filesystemCapacity(directory);
  const ready = !!directory && records >= 20 && recent >= 20 && observedMs >= 3_600_000;
  const bytesPerRecord = records ? logicalBytes / records : null;
  const requestsPerDay = ready ? recent / observedMs * day : null;
  const bytesPerDay = requestsPerDay === null || bytesPerRecord === null ? null : requestsPerDay * bytesPerRecord;
  return { logicalBytes, records, recentRequests: recent, observedMs, windowDays: 7, bytesPerRecord, requestsPerDay, bytesPerDay,
    bytesPer30Days: bytesPerDay === null ? null : bytesPerDay * 30, bytesPer365Days: bytesPerDay === null ? null : bytesPerDay * 365,
    freeBytes, capacityBytes, activityOnlyCapacityDays: bytesPerDay && freeBytes !== null ? freeBytes / bytesPerDay : null,
    basis: "logical activity database density × observed request rate; excludes backup/alert/log growth",
    status: !directory ? "in-memory" : ready ? "estimate" : "insufficient-samples" };
}
