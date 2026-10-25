import { proxyApiKeys, type ApiKeyStore } from "./api-keys.js";
import { createHash } from "node:crypto";
import { authenticationStatus, boundedBytes, requestSignal, getToneForModel, positiveInt } from "@m365-copilot/core";

export async function readJsonBody(body: ReadableStream<Uint8Array> | null, length?: string | null, signal?: AbortSignal): Promise<unknown> {
  const headers = length ? { "content-length": length } : undefined;
  const bytes = await boundedBytes(new Response(body, { headers }), positiveInt(process.env.M365_MAX_REQUEST_BYTES, 32 * 1024 * 1024), requestSignal(signal, 30_000));
  return JSON.parse(bytes.toString("utf8"));
}

export function modelCapabilities(id: string) {
  const tone = getToneForModel(id);
  return { reasoning: /Reasoning/i.test(tone), input: ["text", "image"], contextWindow: positiveInt(process.env.M365_CONTEXT_WINDOW, 1_000_000), maxTokens: positiveInt(process.env.M365_MAX_OUTPUT_TOKENS, 1_000_000) };
}

export function readinessResponse(): Response {
  const state = authenticationStatus();
  return Response.json(state, { status: state.status === "ready" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const allowed = (process.env.M365_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (origin !== new URL(req.url).origin && !allowed.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Conversation-Id" };
}

export function requestGate(req: Request, keys: ApiKeyStore = proxyApiKeys): Response | null {
  if (req.headers.has("origin") && !corsHeaders(req)["Access-Control-Allow-Origin"]) return Response.json({ error: { type: "forbidden_origin", message: "This browser origin is not allowed" } }, { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (!new URL(req.url).pathname.startsWith("/v1/")) return null;
  if (new URL(req.url).pathname === "/v1/proxy/operator") return null; // Dedicated operator grant is checked by this route.
  try {
    if (!keys.authorize(req.headers).allowed) return Response.json({ error: { type: "authentication_error", message: "A valid proxy bearer token is required" } }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  } catch { return Response.json({ error: { type: "key_configuration_error", message: "Application key configuration is unavailable" } }, { status: 503 }); }

  return null;
}

export function callerIdentity(headers: Headers): string {
  return createHash("sha256").update(headers.get("authorization") ?? "local").digest("hex");
}

export function validateBind(host: string): void {
  if (!host || /[\s/'";]/.test(host)) throw new Error("Invalid bind host");
}
