import { z } from "zod/v4";
import type { AlertFact } from "./alert-store.js";

export const alertModelId = z.string().min(1).max(96).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const modelAlertRule = z.object({ model: alertModelId, failures: z.boolean(), throttling: z.boolean(),
  minRequests: z.number().int().min(1).max(10000), minFailures: z.number().int().min(1).max(10000),
  failurePercent: z.number().int().min(1).max(100),
}).strict().refine(r => r.minFailures <= r.minRequests, { message: "Minimum model failures must not exceed minimum model requests" });
export type ModelAlertRule = z.infer<typeof modelAlertRule>;
export interface ModelAlertSample { model: string; total: number; failed: number; throttled: number }
export function modelAlertFacts(rules: ModelAlertRule[], samples: ModelAlertSample[] | undefined, storageError: boolean, windowMinutes: number): AlertFact[] {
  return rules.flatMap(rule => {
    const sample = samples?.find(s => s.model === rule.model);
    const known = !storageError && !!sample && sample.total >= rule.minRequests;
    return (["failures", "throttling"] as const).map(kind => ({ rule: kind, model: rule.model,
      triggered: !rule[kind] ? false : !known ? null : kind === "failures"
        ? sample!.failed >= rule.minFailures && sample!.failed / sample!.total * 100 >= rule.failurePercent
        : sample!.throttled >= rule.minFailures,
      evidence: `${kind === "failures" ? sample?.failed ?? 0 : sample?.throttled ?? 0} ${kind === "failures" ? "errors" : "throttled requests"} / ${sample?.total ?? 0} completed application chats in ${windowMinutes} minutes.`,
    }));
  });
}
