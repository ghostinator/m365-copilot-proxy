import { authenticationStatus } from "@m365-copilot/core";
import type { HttpActivity } from "./http-activity.js";

export const metricsEnabled = () => process.env.M365_METRICS === "1";
/** Fixed metric names and bounded constant labels. Never serializes request/client records. */
export function metricsResponse(activity: HttpActivity): Response {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!metricsEnabled()) return new Response("Metrics are disabled.\n", { status: 404, headers });
  const lines: string[] = [];
  function metric(name: string, type: "counter" | "gauge" | "histogram", help: string, samples: [string, number][]) {
    const full = "m365_proxy_" + name;
    lines.push(`# HELP ${full} ${help}`, `# TYPE ${full} ${type}`);
    for (const [suffix, value] of samples) if (Number.isFinite(value)) lines.push(`${full}${suffix} ${value}`);
  }
  const a = activity.metricsSnapshot(), c = a.chats;
  metric("uptime_seconds", "gauge", "Process uptime in seconds.", [["", process.uptime()]]);
  metric("auth_ready", "gauge", "Whether existing authentication is ready; never refreshes it.", [["", Number(authenticationStatus().status === "ready")]]);
  metric("http_requests_total", "counter", "Tracked requests received in this process, including explicit self-checks; excludes dashboard and metrics.", Object.entries(a.categories).map(([kind, n]) => [`{kind="${kind}"}`, n]));
  metric("http_completed_total", "counter", "Tracked responses completed in this process, including failures and cancellations.", [["", a.completed]]);
  metric("http_unsuccessful_total", "counter", "Tracked responses ending in error or cancellation, including application errors inside HTTP 200.", [["", a.failed]]);
  metric("http_active", "gauge", "Tracked requests not yet completed.", [["", a.active]]);
  metric("http_source_requests_total", "counter", "Tracked requests received by source.", [['{source="application"}', a.applicationRequests], ['{source="self_check"}', a.selfChecks]]);
  metric("http_duration_seconds", "histogram", "End-to-end tracked response duration, including errors, cancellations and explicit self-checks.", [
    ...a.duration.buckets.map(b => [`_bucket{le="${b.le}"}`, b.count] as [string, number]), ['_bucket{le="+Inf"}', a.duration.count], ["_sum", a.duration.sum], ["_count", a.duration.count] ]);
  metric("chats_total", "counter", "Validated chat outcomes, including manually requested model checks.", [['{outcome="success"}', c.completed], ['{outcome="error"}', c.failed], ['{outcome="cancelled"}', c.cancelled]]);
  metric("upstream_attempts_total", "counter", "Observed upstream chat attempts in this process.", [["", c.upstreamAttempts]]);
  metric("upstream_failures_total", "counter", "Observed upstream attempt failures in this process.", [["", c.upstreamFailures]]);
  metric("upstream_retries_total", "counter", "Observed upstream retry attempts in this process.", [["", c.retries]]);
  const state = activity.sources.storageStatistics(), s = state.storage;
  metric("history_available", "gauge", "Whether activity history is readable with no recorded save/loss error.", [["", Number(state.available)]]);
  metric("history_unsaved_records", "gauge", "Records awaiting a successful save.", [["", state.unsavedRecords]]);
  metric("history_lost_records", "gauge", "Records dropped because the bounded save buffer overflowed; resets on process restart.", [["", state.lostRecords]]);
  if (s) {
    metric("history_records", "gauge", "Saved timestamped request records, across restarts.", [["", s.storedRecords]]);
    metric("history_bytes", "gauge", "Physical activity files only; excludes backups, alerts and logs.", [['{component="database"}', s.databaseBytes], ['{component="wal"}', s.walBytes], ['{component="shared_memory"}', s.sharedMemoryBytes]]);
    metric("history_logical_bytes", "gauge", "Used SQLite pages including indexes and rollups; WAL churn excluded.", [["", s.growth.logicalBytes]]);
    if (s.growth.freeBytes !== null) metric("filesystem_available_bytes", "gauge", "Bytes available to this user on the activity filesystem; all applications share this volume.", [["", s.growth.freeBytes]]);
    if (s.growth.bytesPerDay !== null) metric("history_estimated_growth_bytes_per_day", "gauge", "Planning estimate from logical density and observed rate; not measured marginal growth.", [["", s.growth.bytesPerDay]]);
  }
  const alerts = activity.sources.alerts.snapshot();
  metric("alert_monitor_available", "gauge", "Whether alert settings and state are readable without an observed monitor error.", [["", Number(!alerts.error)]]);
  metric("alerts_enabled", "gauge", "Whether local alert monitoring is enabled.", [["", Number(alerts.settings.enabled)]]);
  metric("alerts_active", "gauge", "Active incidents by fixed rule; acknowledgement does not resolve them.", ["failures", "throttling", "authentication", "storage"].map(rule => [`{rule="${rule}"}`, alerts.active.filter(r => r.rule === rule).length]));
  return new Response(lines.join("\n") + "\n", { headers: { ...headers, "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
}
