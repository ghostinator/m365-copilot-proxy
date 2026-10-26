// Script the upstream reply; inspect real handler output without executing tools.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolated = join(tmpdir(), `m365-handler-probe-${randomUUID()}`);
Object.assign(process.env, {
  M365_DATA_DIR: isolated,
  M365_CACHE_FILE: join(isolated, "absent-cache.json"),
  M365_SECRETS_FILE: join(isolated, "absent-secrets.json"),
  M365_NO_INTERACTIVE: "1",
  M365_NO_CONFAB_RETRY: "1",
  M365_AVOID_THROTTLING: "0",
  M365_FORCE_AGENT: "0",
  M365_DEBUG: "0",
  M365_TRACE: "0",
});
let externalRequests = 0;
globalThis.fetch = async () => {
  externalRequests++;
  throw new Error("Network is disabled in this probe");
};
const { handleChatCompletion, ChatCompletionRequest } = await import("../packages/proxy-lib/dist/index.mjs");
const tool = (name, properties) => ({ type: "function", function: {
  name, parameters: { type: "object", properties, required: Object.keys(properties) },
} });
const arrayTool = tool("edit_file", {
  path: { type: "string" }, edits: { type: "array", items: { type: "object" } },
});
const objectTool = tool("set_options", { target: { type: "string" }, options: { type: "object" } });
const cases = [
  { name: "string-control", control: true, tool: tool("read_file", { path: { type: "string" } }),
    reply: "```read_file\nC:/probe.txt\n```", expected: { path: "C:/probe.txt" } },
  { name: "object-body", tool: tool("configure", { config: { type: "object" } }),
    reply: '```configure\n{"mode":"safe"}\n```', expected: { config: { mode: "safe" } } },
  { name: "object-header", tool: objectTool,
    reply: '```set_options\ntarget: main\noptions: {"mode":"safe"}\n```',
    expected: { target: "main", options: { mode: "safe" } } },
  { name: "yaml-object-control", control: true, tool: objectTool,
    reply: "```set_options\ntarget: main\noptions:\n  mode: safe\n```",
    expected: { target: "main", options: { mode: "safe" } } },
  { name: "json-array-control", control: true, tool: arrayTool,
    reply: '```edit_file\npath: C:/probe.txt\nedits: [{"old_text":"a","new_text":"b"}]\n```',
    expected: { path: "C:/probe.txt", edits: [{ old_text: "a", new_text: "b" }] } },
  { name: "truncated-array", tool: arrayTool,
    reply: '```edit_file\npath: C:/probe.txt\nedits: [{"old_text":"a","new_text":\n```', expected: null },
];

const results = [];
for (const fixture of cases) for (const streaming of [false, true]) {
  let upstreamRuns = 0, releases = 0, acknowledgements = 0;
  const session = {
    turnCount: 0, conversationId: randomUUID(),
    async run() {
      upstreamRuns++;
      this.turnCount++;
      return {
        fullText: fixture.reply, hasContent: true, result: { value: "Success" },
        images: [], throttle: { current: 1, max: 600 },
        async *[Symbol.asyncIterator]() { yield fixture.reply; },
      };
    },
  };
  const state = { session, sentMessageCount: 0, lastAccessedAt: Date.now(), pendingNote: null, history: [], identity: "offline" };
  const pool = {
    shutdown: new AbortController(),
    async acquire() { return () => { releases++; }; },
    resolve() { return state; },
    acknowledge() { acknowledgements++; },
  };
  const response = await handleChatCompletion(ChatCompletionRequest.parse({
    model: "claude-sonnet", stream: streaming,
    messages: [{ role: "user", content: "Offline scripted tool-contract fixture" }], tools: [fixture.tool],
  }), pool);
  const raw = await response.text();
  let emitted = [];
  if (streaming) {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") continue;
      const chunk = JSON.parse(line.slice(6));
      emitted.push(...(chunk.choices?.[0]?.delta?.tool_calls ?? []));
    }
  } else emitted = JSON.parse(raw).choices?.[0]?.message?.tool_calls ?? [];
  assert.equal(response.status, 200);
  assert.equal(upstreamRuns, 1);
  assert.equal(releases, 1);
  assert.equal(acknowledgements, 1);
  assert.ok(emitted.length <= 1);
  const args = emitted.length ? JSON.parse(emitted[0].function.arguments) : null;
  let schemaExpected = true;
  try { assert.deepEqual(args, fixture.expected); } catch { schemaExpected = false; }
  if (fixture.control) assert.ok(schemaExpected, `${fixture.name} control failed`);
  results.push({ case: fixture.name, transport: streaming ? "SSE" : "JSON", status: response.status,
    args, schemaExpected, upstreamRuns, queueReleased: releases === 1 });
}
assert.equal(externalRequests, 0);
console.log(JSON.stringify({ offline: true, requests: results.length, externalRequests,
  incompatible: results.filter(r => !r.schemaExpected).length, results }, null, 2));
