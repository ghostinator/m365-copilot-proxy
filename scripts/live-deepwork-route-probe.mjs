// Test-only wire-tone substitution through the real fetch handler; no shipped model alias.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const WebSocket = createRequire(new URL("../packages/core/package.json", import.meta.url))("ws");

assert.equal(process.env.M365_LIVE, "1", "Requires explicit live-quota opt-in");
const root = join(tmpdir(), `m365-deepwork-${randomUUID()}`);
mkdirSync(root, { mode: 0o700 });
process.env.M365_CACHE_FILE ||= join(homedir(), ".config/opencode-m365/msal-cache.json");
process.env.M365_DATA_DIR = root;
process.env.M365_SECRETS_FILE = join(root, "absent-secrets.json");
process.env.M365_DUMP_FRAMES = "1";
process.env.M365_DEBUG = "1";
process.env.M365_TURN_TIMEOUT_MS = "90000";
process.env.M365_IDLE_TIMEOUT_MS = "45000";
process.env.M365_NO_CONFAB_RETRY = "1";
process.env.M365_NO_DISENGAGE_RETRY = "1";
process.env.M365_FORCE_AGENT = "0";
const { getToken, decodeJwt } = await import("../packages/core/dist/index.mjs");
const { oneTurn } = await import("./_probe-chat.mjs");
const { createApp } = await import("../packages/proxy-lib/dist/index.mjs");
const token = await getToken();
const summary = { evidence: root, negativeControl: {}, wire: [], responses: [] };
const save = () => writeFileSync(join(root, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ stage: "starting", evidence: root }));
// An invented tone must fail, otherwise mere acceptance cannot establish DeepWork routing.
const control = await oneTurn({ token, claims: decodeJwt(token), tone: "Research_Unknown_Tone_20261026",
  text: "Reply only READY.", timeoutMs: 30000, onFrame: frame => {
    if (frame.type === 7) summary.negativeControl.closeError = frame.error;
    if (frame.item?.result) summary.negativeControl.result = frame.item.result.value;
  } });
summary.negativeControl.error = control.error;
summary.negativeControl.hasText = !!control.fullText;
save();
assert.ok(!control.fullText && /Failed to invoke|invalid|error/i.test(JSON.stringify(summary.negativeControl)), "Unknown-tone control did not reject; stop");
await new Promise(resolve => setTimeout(resolve, 60000));
const originalSend = WebSocket.prototype.send;
let permit = false;
WebSocket.prototype.send = function(data, ...args) {
  const chunks = String(data).split("\x1e").filter(Boolean);
  let frames;
  try { frames = chunks.map(chunk => JSON.parse(chunk)); } catch { return originalSend.call(this, data, ...args); }
  for (const frame of frames) {
  if (frame.target === "chat" && frame.type === 4) {
    assert.ok(permit, "One upstream send per HTTP request; automatic retries blocked by research guard");
    permit = false;
    const request = frame.arguments[0];
    const route = new URL(this.url);
    const conversationId = route.searchParams.get("ConversationId");
    assert.ok(conversationId, "No actual Chathub conversation ID");
    assert.equal(route.searchParams.get("scenario"), "OfficeWebIncludedCopilot");
    request.tone = "DeepWork";
    summary.wire.push({ tone: request.tone, conversationId, scenario: route.searchParams.get("scenario"), licenseType: route.searchParams.get("licenseType"),
      agentAttached: !!request.threadLevelGptId?.id, optionsSets: request.optionsSets });
    save();
  }
  }
  return originalSend.call(this, frames.map(frame => JSON.stringify(frame)).join("\x1e") + "\x1e", ...args);
};
const app = createApp({ useAgent: false });
const fixture = join(root, "input.txt"), nonce = randomBytes(16).toString("hex");
writeFileSync(fixture, nonce, { mode: 0o600 });
const tools = [{ type: "function", function: { name: "read", description: "Read a local file by its exact absolute path", parameters: {
  type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }];
const messages = [{ role: "user", content: `Use the supplied read tool to read ${fixture}. The file exists only on my computer, not your remote sandbox. Return its exact contents after the tool result arrives.` }];
async function request() {
  permit = true;
  const response = await app.fetch(new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", "x-conversation-id": "deepwork-research" },
    body: JSON.stringify({ model: "claude-sonnet", messages, tools, stream: false }), signal: AbortSignal.timeout(95000),
  }));
  const body = await response.json();
  summary.responses.push({ status: response.status, body }); save();
  assert.equal(response.status, 200, "Candidate route failed; inspect private summary");
  return body.choices[0].message;
}
try {
  const reply = await request();
  assert.equal(summary.wire.length, 1, "Tone substitution was not observed; discard the response");
  const call = reply.tool_calls?.[0];
  assert.equal(reply.tool_calls?.length, 1, "No unique local tool call; no tool-loop capability established");
  assert.equal(call.function.name, "read");
  assert.deepEqual(JSON.parse(call.function.arguments), { path: fixture });
  messages.push(reply, { role: "tool", tool_call_id: call.id, content: readFileSync(fixture, "utf8") });
  const final = await request();
  assert.ok(final.content?.includes(nonce), "Candidate did not use the actual local tool result");
  assert.equal(summary.wire.length, 2);
  assert.equal(summary.wire[0].conversationId, summary.wire[1].conversationId);
  summary.localReadLoop = true;
  console.log(JSON.stringify({ stage: "passed", localReadLoop: true, evidence: root }));
} catch (error) {
  summary.failure = error.message;
  console.error(JSON.stringify({ stage: "inconclusive", message: error.message, evidence: root }));
  process.exitCode = 1;
} finally {
  unlinkSync(fixture);
  WebSocket.prototype.send = originalSend;
  app.close(); save();
}
