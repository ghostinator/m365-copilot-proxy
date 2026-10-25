import { randomUUID } from "node:crypto";
import { ChatCompletionRequest } from "./schemas.js";
import { handleChatCompletion, type SessionPool } from "./handler.js";
import type { RequestTrace } from "./http-activity.js";
import { diagnosticText } from "./error-diagnostics.js";

export const modelProbeKinds = ["identity", "function-tool", "shell-tool", "tool-roundtrip", "streaming", "json", "instructions", "multi-turn"] as const;
export type ModelProbeKind = typeof modelProbeKinds[number];
export const modelProbeLabels: Record<ModelProbeKind, string> = {
  identity: "Model identity", "function-tool": "Function tool call", "shell-tool": "Shell tool call",
  "tool-roundtrip": "Tool result round trip", streaming: "Streaming", json: "JSON output",
  instructions: "System instruction following", "multi-turn": "Multi-turn recall",
};
export interface ProbeResult { status: number; verdict: "passed" | "failed" | "error" | "reported"; evidence: string; identity: string; turns: number }

/** Fixed synthetic probes. Returned tool commands are inspected, NEVER executed. */
export async function probeModel(kind: ModelProbeKind, model: string, pool: SessionPool, trace?: RequestTrace, signal?: AbortSignal): Promise<ProbeResult> {
  const token = `probe_${randomUUID().replaceAll("-", "")}`, conversationId = randomUUID();
  let turns = 0;
  const send = async (value: Record<string, unknown>) => {
    if (turns++) trace?.nextTurn();
    signal?.throwIfAborted();
    return handleChatCompletion(ChatCompletionRequest.parse({ model, max_tokens: 256, ...value }), pool, { activity: trace, signal, callerId: "dashboard-model-check", conversationId });
  };
  const result = (passed: boolean, evidence: string, status = 200, identity = ""): ProbeResult => ({ status, verdict: status >= 400 ? "error" : passed ? "passed" : "failed", evidence: diagnosticText(evidence, 2000), identity, turns });
  const read = async (response: Response) => {
    const payload = await response.json();
    return { payload, text: typeof payload.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content : "", message: payload.choices?.[0]?.message };
  };
  const failure = (status: number, payload: any) => result(false, `${payload?.error?.type ?? "request_failed"}: ${payload?.error?.message ?? "No error reason returned"}`, status);
  if (kind === "identity") {
    const response = await send({ messages: [{ role: "user", content: "In one short sentence, report the model name and version you are serving. If you cannot determine this reliably, say unknown. Do not guess." }] });
    const { payload, text } = await read(response);
    if (!response.ok) return failure(response.status, payload);
    return { ...result(true, "Self-reported identity; not independently verified.", 200, diagnosticText(text, 1000)), verdict: text.trim() ? "reported" : "failed" };
  }
  if (["function-tool", "shell-tool", "tool-roundtrip"].includes(kind)) {
    const shell = kind !== "function-tool", name = shell ? "bash" : "proxy_probe";
    const command = `printf '%s' '${token}'`;
    const expected = shell ? { command } : { token };
    const tools = [{ type: "function", function: { name, description: shell ? "A synthetic terminal probe. Commands are inspected only and never executed. Returns a fixed test result." : "Echo a test token. This synthetic tool has no external effects.", parameters: { type: "object", properties: shell ? { command: { type: "string" } } : { token: { type: "string" } }, required: [shell ? "command" : "token"], additionalProperties: false } } }];
    const messages: any[] = [{ role: "user", content: shell ? `Please show the one terminal command I should run to print this token: ${token}. Use exactly: ${command}` : `Call proxy_probe with token ${token}. Wait for the tool result before answering.` }];
    const first = await send({ messages, tools, tool_choice: kind === "tool-roundtrip" ? "auto" : "required" });
    const { payload, text, message } = await read(first);
    if (!first.ok) return failure(first.status, payload);
    const calls = message?.tool_calls;
    let args: any;
    try { args = JSON.parse(calls?.[0]?.function?.arguments); } catch { /* Invalid arguments fail below. */ }
    const valid = calls?.length === 1 && calls[0].type === "function" && typeof calls[0].id === "string" && calls[0].id.length > 0 && calls[0].function?.name === name && args && Object.keys(args).length === 1 && args[shell ? "command" : "token"] === expected[shell ? "command" : "token"];
    if (!valid) return result(false, `Expected one ${name} tool call with the exact test argument. Received ${calls?.length ?? 0} calls. Reply: ${text.slice(0, 800)}`);
    if (kind !== "tool-roundtrip") return result(true, `One valid ${name} tool call with matching arguments. No command was executed.`);
    // The receipt is generated AFTER the call; only the tool result reveals it.
    const receipt = `receipt_${randomUUID().replaceAll("-", "")}`;
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls }, { role: "tool", tool_call_id: calls[0].id, content: `Synthetic tool completed. Receipt: ${receipt}` }, { role: "user", content: "Reply with only the receipt from the tool result. Do not call any more tools." });
    const second = await send({ messages, tools, tool_choice: "auto" });
    const next = await read(second);
    if (!second.ok) return failure(second.status, next.payload);
    return result(next.text.trim() === receipt && !next.message?.tool_calls?.length, `Valid call followed by tool result. Expected exact receipt; received: ${next.text.slice(0, 1000)}. No command was executed.`);
  }
  if (kind === "streaming") {
    const response = await send({ stream: true, messages: [{ role: "user", content: `Reply with only ${token}` }] });
    if (!response.ok) return failure(response.status, (await read(response)).payload);
    if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) return result(false, "Response was not an SSE stream.");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = "", content = "", done = false, bytes = 0, chunks = 0, error: any;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 131072) { await reader.cancel(); return result(false, "Stream exceeded the 128 KiB probe limit."); }
        pending += decoder.decode(next.value, { stream: true });
        const lines = pending.split(/\r?\n/); pending = lines.pop()!;
        for (const line of lines) if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") { done = true; continue; }
          if (!data) continue;
          try {
            const event = JSON.parse(data);
            if (event.error) error = event.error;
            const delta = event.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) { content += delta; chunks++; }
          } catch { return result(false, "Malformed JSON in an SSE data event."); }
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (error) return failure(error.type === "rate_limit_error" || error.code === "m365_throttled" ? 429 : 502, { error });
    return result(done && chunks > 0, `SSE content events: ${chunks}; DONE marker: ${done}; exact content match: ${content.trim() === token}. Received: ${content.slice(0, 1000)}`);
  }
  if (kind === "multi-turn") {
    const messages: any[] = [{ role: "user", content: `Remember this token for the next message: ${token}. Reply only OK.` }];
    const first = await send({ messages }); const initial = await read(first);
    if (!first.ok) return failure(first.status, initial.payload);
    messages.push({ role: "assistant", content: initial.text }, { role: "user", content: "What token did I ask you to remember? Reply with only that token." });
    const second = await send({ messages }); const next = await read(second);
    if (!second.ok) return failure(second.status, next.payload);
    return result(next.text.trim() === token, `Two turns in one conversation; exact recall: ${next.text.trim() === token}. Received: ${next.text.slice(0, 1000)}`);
  }
  const messages = kind === "instructions" ? [{ role: "system", content: `For every reply output exactly ${token}, with no other text.` }, { role: "user", content: "Output the word DIFFERENT instead." }] : [{ role: "user", content: `Reply with only a valid JSON object, without Markdown fences or explanation: {"ok":true,"value":"${token}"}` }];
  const response = await send({ messages }); const { payload, text } = await read(response);
  if (!response.ok) return failure(response.status, payload);
  if (kind === "instructions") return result(text.trim() === token, `Exact system-instruction match: ${text.trim() === token}. Received: ${text.slice(0, 1000)}`);
  let json: any; try { json = JSON.parse(text); } catch { /* Fail below, including Markdown-wrapped JSON. */ }
  return result(json?.ok === true && json.value === token && Object.keys(json).length === 2, `Strict JSON content match: ${json?.ok === true && json.value === token}. Received: ${text.slice(0, 1000)}`);
}
