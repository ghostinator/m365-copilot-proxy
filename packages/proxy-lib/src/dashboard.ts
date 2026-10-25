import { serviceState } from "./service-control.js";
import { metricsEnabled } from "./metrics.js";
import { proxyApiKeys } from "./api-keys.js";
import { html, script } from "./dashboard-ui.js";
import { authenticationStatus, authenticationAccountKey, getAvailableModels, METERED_BUDGETS, activePriorityAccessExhaustion, priorityAccessFallbackModel, recentOperationalErrors, type MeteredBudget } from "@m365-copilot/core";
import { usageObservations } from "./usage-observations.js";
import { httpActivity, type HttpActivity } from "./http-activity.js";
import type { SessionPool } from "./session-pool.js";
import type { ActivityQuery } from "./request-sources.js";
import { modelCheckState } from "./model-checks.js";

/** Local observations only: no login, token refresh, chat or quota probe. */
export function operatorStatus(pool: SessionPool, activity: HttpActivity = httpActivity, query: Partial<ActivityQuery> = {}) {
  const observed = usageObservations.snapshot(authenticationAccountKey());
  return {
    apiKeys: proxyApiKeys.status(),
    metrics: { enabled: metricsEnabled(), path: "/v1/proxy/metrics" },
    service: serviceState(),
    authentication: authenticationStatus(),
    uptimeSeconds: Math.floor(process.uptime()),
    requests: pool.status,
    instance: { ...activity.instance, host: process.env.NITRO_HOST || process.env.HOST || "127.0.0.1", port: Number(process.env.NITRO_PORT || process.env.PORT || 4141) },
    activity: activity.snapshot(),
    sources: activity.sources.snapshot(query),
    alerts: activity.sources.alerts.snapshot(),
    notifications: activity.sources.alerts.notifications.summary(),
    storageHistory: activity.sources.storageHistory.summary(),
    backupSchedule: activity.sources.backups.summary(),
    modelCheck: modelCheckState(),
    models: getAvailableModels(),
    lastRoute: observed.route,
    recentErrors: recentOperationalErrors(),
    budgets: Object.entries(METERED_BUDGETS).map(([key, value]) => {
      const exhausted = activePriorityAccessExhaustion(key);
      const allowance = observed.budgets[key as MeteredBudget];
      return { id: key, label: value.label, allowance: allowance ? { daily: allowance.daily ?? null, weekly: allowance.weekly ?? null } : null, observedAt: allowance ? new Date(allowance.at).toISOString() : null, observation: allowance ? "last_observed" : "unknown", exhausted: !!exhausted, window: exhausted?.window ?? null, resetsAt: exhausted?.resetsAt.toISOString() ?? null, fallbackModel: priorityAccessFallbackModel(key as MeteredBudget) };
    }),
  };
}

export function dashboardResponse(path: string): Response | null {
  if (!["/dashboard", "/dashboard-script"].includes(path)) return null;
  return new Response(path === "/dashboard" ? html : script, { headers: {
    "Content-Type": path === "/dashboard" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  } });
}
