import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ text: "", runs: 0 }));
vi.mock("./usage-observations.js", () => ({ recordUsageObservation: vi.fn() }));
vi.mock("@m365-copilot/core", async (importActual) => {
  const actual = await importActual<typeof import("@m365-copilot/core")>();
  class ModelSession {
    turnCount = 0;
    conversationId = "validation-fixture";
    reset() {}
    async run() {
      fixture.runs++;
      this.turnCount++;
      return {
        fullText: fixture.text, hasContent: true, result: { value: "Success" },
        images: [], throttle: null, contentOrigin: "Claude", messageType: null,
        scores: null, turnCount: this.turnCount,
        async *[Symbol.asyncIterator]() { yield fixture.text; },
      };
    }
  }
  return { ...actual, ModelSession, awaitTurnBudget: async () => ({ waitedMs: 0 }),
    longHeredocAsWrite: (call: Parameters<typeof actual.longHeredocAsWrite>[0], tools: Parameters<typeof actual.longHeredocAsWrite>[1]) => actual.longHeredocAsWrite(call, tools, "win32"),
  };
});
const { handleChatCompletion, SessionPool } = await import("./handler.js");
const { ChatCompletionRequest } = await import("./schemas.js");
const tool = {
  type: "function", function: { name: "edit", parameters: {
    type: "object", properties: { enabled: { type: "boolean" }, edits: {
      type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    } }, required: ["enabled", "edits"], additionalProperties: false,
  } },
};
afterEach(() => { fixture.runs = 0; fixture.text = ""; vi.unstubAllEnvs(); });

async function respond(text: string, stream = false, tools: unknown[] = [tool], extra = {}) {
  fixture.text = text;
  const pool = new SessionPool();
  const acquire = vi.spyOn(pool, "acquire");
  const acknowledge = vi.spyOn(pool, "acknowledge");
  const response = await handleChatCompletion(ChatCompletionRequest.parse({
    model: "claude-sonnet", messages: [{ role: "user", content: "Apply the edit" }], tools, stream, ...extra,
  }), pool);
  return { response, wire: await response.text(), acquire, acknowledge };
}
const fence = (args: object) => "```edit\n" + Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n") + "\n```";

describe("handler tool output contract", () => {
  it.each([false, true])("rejects invalid arguments without call leakage or acknowledgement (stream=%s)", async stream => {
    const { response, wire, acknowledge } = await respond(fence({ enabled: "secret-invalid-boolean", edits: [] }), stream);
    expect(response.status).toBe(stream ? 200 : 502);
    expect(wire).toContain("tool_validation_error");
    expect(wire).not.toContain("secret-invalid-boolean");
    expect(wire).not.toContain('"tool_calls"');
    expect(wire).not.toContain('"finish_reason":"stop"');
    expect(acknowledge).not.toHaveBeenCalled();
    expect(fixture.runs).toBe(1);
  });
  it("validates the second call when batching is enabled", async () => {
    vi.stubEnv("M365_ALLOW_MULTI_TOOL", "1");
    const { response, acknowledge } = await respond(fence({ enabled: true, edits: [] }) + "\n" + fence({ enabled: true, edits: [{ text: 1 }] }));
    expect(response.status).toBe(502);
    expect(acknowledge).not.toHaveBeenCalled();
  });
  it("validates only selected calls when batching is disabled", async () => {
    const { response, acknowledge } = await respond(fence({ enabled: true, edits: [] }) + "\n" + fence({ enabled: "wrong", edits: [] }));
    expect(response.status).toBe(200);
    expect(acknowledge).toHaveBeenCalledOnce();
  });
  it.each([false, true])("validates rewritten writes against their final schema (extra required field=%s)", async invalid => {
    const content = "  雪\t" + "x".repeat(9000) + "  \n";
    const tools = [
      { type: "function", function: { name: "bash", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
      { type: "function", function: { name: "write", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, confirmed: { type: "boolean" } }, required: invalid ? ["path", "content", "confirmed"] : ["path", "content"] } } },
    ];
    const { response, wire, acknowledge } = await respond("```bash\ncat > file.txt <<'EOF'\n" + content + "EOF\n```", false, tools);
    expect(response.status).toBe(invalid ? 502 : 200);
    if (invalid) {
      expect(acknowledge).not.toHaveBeenCalled();
      expect(wire).not.toContain('"tool_calls"');
    } else {
      const emitted = JSON.parse(wire).choices[0].message.tool_calls[0].function;
      expect(emitted.name).toBe("write");
      expect(JSON.parse(emitted.arguments).content).toBe(content);
    }
  });
  it.each([
    { tools: [{ ...tool, function: { ...tool.function, parameters: { type: "invalid" } } }] },
    { tools: [tool, tool] },
    { tool_choice: { type: "function", function: { name: "missing" } } },
  ])("rejects invalid tool requests before admission", async extra => {
    const { response, acquire } = await respond("ignored", false, [tool], extra);
    expect(response.status).toBe(400);
    expect(acquire).not.toHaveBeenCalled();
    expect(fixture.runs).toBe(0);
  });
});
