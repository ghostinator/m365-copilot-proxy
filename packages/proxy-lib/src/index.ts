import { type ModelSessionOptions, getAvailableModels } from "@m365-copilot/core";
import { ChatCompletionRequest } from "./schemas.js";
import { SessionPool, handleChatCompletion } from "./handler.js";
import { dashboardResponse, operatorStatus } from "./dashboard.js";
export { dashboardResponse, operatorStatus } from "./dashboard.js";
export { setupPiClient, piProvider } from "./client-setup.js";
export { setupOpenClawClient } from "./client-setup.js";
export { generateOpenClawConfig, type OpenClawConfig, type OpenClawModelConfig, type OpenClawProviderConfig } from "./openclaw-config.js";
import { callerIdentity, corsHeaders, modelCapabilities, readJsonBody, readinessResponse, requestGate } from "./http-policy.js";
export { callerIdentity, corsHeaders, modelCapabilities, readJsonBody, readinessResponse, requestGate, validateBind } from "./http-policy.js";

export { SessionPool, handleChatCompletion } from "./handler.js";
export { ChatCompletionRequest, ChatMessage, ToolCall, ToolDefinition } from "./schemas.js";

// Re-export tool utilities from core
export {
  formatMessages,
  formatToolDefinitions,
  parseToolCalls,
  getMessageContent,
  type Message,
  type ToolDef,
  type ToolChoice,
  type ParsedToolCall,
  type ParseResult,
} from "@m365-copilot/core";

// --- Shared response payloads (reused by the Nitro routes in @m365-copilot/proxy) ---

/** Static liveness body; readiness is based on authentication state. */
export const HEALTH_PAYLOAD = { status: "ok" } as const;

// Window/output hints surfaced to harnesses on /v1/models so they can size
// context packing and output expectations. These are ADVERTISED hints only — M365
// enforces its own limits server-side; the number here just stops harnesses from
// pre-truncating our prompts/output. Empirically (docs/hypotheses.md F9) M365 accepts
// ≥500k tokens of input (retrieval-backed); the old ~3k output hint made harnesses
// cap generation far below what a coding turn needs. Advertise a roomy 1M window +
// 1M output (in line with modern large-context models) so nothing client-side clips.
// Override via env.
/** Build the OpenAI-compatible `GET /v1/models` payload. */
export function buildModelsPayload() {
  const created = Math.floor(Date.now() / 1000);
  return {
    object: "list",
    data: getAvailableModels().map((id) => ({
      id,
      object: "model",
      created,
      owned_by: "microsoft",
      // Non-standard but widely-read by OpenAI-compatible harnesses. Several
      // aliases because clients disagree on the key name. Unknown keys are
      // ignored by strict clients.
      context_window: modelCapabilities(id).contextWindow,
      max_context_length: modelCapabilities(id).contextWindow,
      max_input_tokens: modelCapabilities(id).contextWindow,
      max_output_tokens: modelCapabilities(id).maxTokens,
    })),
  };
}

function withCors(res: Response, req: Request): Response {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A minimal Web fetch handler — the same shape Hono exposed via `app.fetch`. */
export interface FetchApp {
  fetch(req: Request): Promise<Response>;
  close(): void;
}

/**
 * Create a framework-free fetch handler that serves an OpenAI-compatible API
 * backed by M365 Copilot. Each distinct conversation automatically gets its own
 * M365 session via the SessionPool.
 *
 * This is the embeddable entry point used by the tests, `proxy-verify`, and the
 * openclaw-plugin. The standalone server is the Nitro app in `@m365-copilot/proxy`,
 * whose routes reuse the same `handleChatCompletion` / `buildModelsPayload` helpers.
 */
export function createApp(sessionOptions: ModelSessionOptions = {}): FetchApp {
  const pool = new SessionPool(sessionOptions);

  async function fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const method = req.method.toUpperCase();

    const gate = requestGate(req);
    if (gate) return gate;

    if (method === "GET") {
      const dashboard = dashboardResponse(pathname);
      if (dashboard) return dashboard;
      if (pathname === "/v1/proxy/status") return withCors(Response.json(operatorStatus(pool), { headers: { "Cache-Control": "no-store" } }), req);
    }

    if (method === "GET" && ["/health", "/health/ready"].includes(pathname)) {
      return withCors(readinessResponse(), req);
    }
    if (method === "GET" && pathname === "/health/live") {
      return withCors(json(200, HEALTH_PAYLOAD), req);
    }

    if (method === "GET" && pathname === "/v1/models") {
      return withCors(json(200, buildModelsPayload()), req);
    }

    if (method === "POST" && pathname === "/v1/chat/completions") {
      let body: ReturnType<typeof ChatCompletionRequest.parse>;
      try {
        body = ChatCompletionRequest.parse(await readJsonBody(req.body, req.headers.get("content-length"), req.signal));
      } catch (err: any) {
        return withCors(
          json(/size limit/.test(err.message) ? 413 : 400, { error: { message: err.message, type: "invalid_request_error" } }), req,
        );
      }
      // req.signal aborts when the client disconnects → cancels the M365 turn.
      return withCors(await handleChatCompletion(body, pool, { signal: req.signal, conversationId: req.headers.get("x-conversation-id") ?? undefined, callerId: callerIdentity(req.headers) }), req);
    }

    return withCors(
      json(404, { error: { message: "Not found", type: "invalid_request_error" } }), req,
    );
  }

  return { fetch, close: () => pool.close() };
}
