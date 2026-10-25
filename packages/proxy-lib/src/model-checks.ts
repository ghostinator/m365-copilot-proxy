import { diagnosticText } from "./error-diagnostics.js";
import { getAvailableModels } from "@m365-copilot/core";
import { z } from "zod/v4";
import type { SessionPool } from "./handler.js";
import { probeModel, modelProbeKinds, modelProbeLabels } from "./model-probes.js";
import type { HttpActivity, RequestTrace } from "./http-activity.js";

let runningModel: string | null = null;
let nextAllowedAt = 0;
export const modelCheckState = () => ({ runningModel, nextAllowedAt, cooldownMs: 30_000, tests: modelProbeKinds.map(kind => ({ kind, label: modelProbeLabels[kind], turns: ["tool-roundtrip", "multi-turn"].includes(kind) ? 2 : 1 })) });

/** Only called by an explicit POST. Never a startup, poll or scheduled probe. */
export async function runModelCheck(value: unknown, pool: SessionPool, activity: HttpActivity, trace?: RequestTrace, signal?: AbortSignal): Promise<Response> {
  const parsed = z.object({ model: z.string().refine(model => getAvailableModels().includes(model)), kind: z.enum(modelProbeKinds).default("identity") }).safeParse(value);
  if (!parsed.success) return Response.json({ error: { type: "invalid_model", message: "Choose a registered model" } }, { status: 400 });
  if (runningModel || pool.status.pending) return Response.json({ error: { type: "model_check_busy", message: "A request is already running; try again when it finishes" } }, { status: 409 });
  if (Date.now() < nextAllowedAt) return Response.json({ error: { type: "model_check_cooldown", message: "Wait before starting another model check" }, nextAllowedAt }, { status: 429 });
  const model = parsed.data.model, started = Date.now();
  runningModel = model;
  try {
    const result = await probeModel(parsed.data.kind, model, pool, trace, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(240_000)]));
    const servedModel = trace?.route() ?? null, durationMs = Date.now() - started;
    activity.sources.saveModelCheck(model, result.status, result.identity, durationMs, servedModel, parsed.data.kind, result.verdict, result.evidence, result.turns);
    trace?.result(result.status);
    return Response.json({ model, servedModel, kind: parsed.data.kind, ...result, durationMs, checkedAt: new Date().toISOString(), selfReported: parsed.data.kind === "identity", error: result.status >= 400 ? "check_failed" : null }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = signal?.aborted ? 499 : 502;
    const reason = diagnosticText(error instanceof Error ? error.message : "The model check did not complete",2000);
    trace?.diagnostic("model_check_failed", reason, error instanceof Error ? error.stack : undefined);
    trace?.result(status);
    activity.sources.saveModelCheck(model, status, "", Date.now() - started, trace?.route() ?? null, parsed.data.kind, "error", reason, 0);
    return Response.json({ model, kind: parsed.data.kind, verdict: "error", error: { type: "model_check_failed", message: "The model check did not complete; see Recent errors for diagnostics" } }, { status });
  } finally { runningModel = null; nextAllowedAt = Date.now() + 30_000; }
}
