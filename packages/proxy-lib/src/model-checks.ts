import { getAvailableModels } from "@m365-copilot/core";
import { z } from "zod/v4";
import { ChatCompletionRequest } from "./schemas.js";
import { handleChatCompletion, type SessionPool } from "./handler.js";
import type { HttpActivity, RequestTrace } from "./http-activity.js";

let runningModel: string | null = null;
let nextAllowedAt = 0;
export const modelCheckState = () => ({ runningModel, nextAllowedAt, cooldownMs: 30_000 });

/** Only called by an explicit POST. Never a startup, poll or scheduled probe. */
export async function runModelCheck(value: unknown, pool: SessionPool, activity: HttpActivity, trace?: RequestTrace, signal?: AbortSignal): Promise<Response> {
  const parsed = z.object({ model: z.string().refine(model => getAvailableModels().includes(model)) }).safeParse(value);
  if (!parsed.success) return Response.json({ error: { type: "invalid_model", message: "Choose a registered model" } }, { status: 400 });
  if (runningModel || pool.status.pending) return Response.json({ error: { type: "model_check_busy", message: "A request is already running; try again when it finishes" } }, { status: 409 });
  if (Date.now() < nextAllowedAt) return Response.json({ error: { type: "model_check_cooldown", message: "Wait before starting another model check" }, nextAllowedAt }, { status: 429 });
  const model = parsed.data.model, started = Date.now();
  runningModel = model;
  try {
    const request = ChatCompletionRequest.parse({ model, stream: false, messages: [{ role: "user", content: "In one short sentence, report the model name and version you are serving. If you cannot determine this reliably, say unknown. Do not guess." }] });
    const response = await handleChatCompletion(request, pool, { activity: trace, signal, callerId: "dashboard-model-check" });
    const payload = await response.json();
    const identity = response.ok && typeof payload.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content.slice(0, 1000) : "";
    const servedModel = trace?.route() ?? null;
    const durationMs = Date.now() - started;
    activity.sources.saveModelCheck(model, response.status, identity, durationMs, servedModel);
    return Response.json({ model, servedModel, status: response.status, identity, durationMs, checkedAt: new Date().toISOString(), selfReported: true, error: response.ok ? null : String(payload.error?.type ?? "check_failed").replace(/[^a-z_]/g, "").slice(0, 64) }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    const status = signal?.aborted ? 499 : 502;
    trace?.result(status);
    activity.sources.saveModelCheck(model, status, "", Date.now() - started, trace?.route() ?? null);
    return Response.json({ error: { type: "model_check_failed", message: "The model check did not complete" } }, { status });
  } finally { runningModel = null; nextAllowedAt = Date.now() + 30_000; }
}
