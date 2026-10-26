// Sequential, bounded checks of the rebuilt core's real cancellation/context path.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.M365_LIVE, "1", "Requires explicit live-quota opt-in");
const root = join(tmpdir(), `m365-session-follow-up-${randomUUID()}`);
mkdirSync(root, { mode: 0o700 });
process.env.M365_CACHE_FILE ||= join(homedir(), ".config/opencode-m365/msal-cache.json");
process.env.M365_DATA_DIR = root;
process.env.M365_SECRETS_FILE = join(root, "absent-secrets.json");
process.env.M365_DUMP_FRAMES = "1";
process.env.M365_DEBUG = "1";
process.env.M365_TURN_TIMEOUT_MS = "90000";
process.env.M365_IDLE_TIMEOUT_MS = "45000";
const { ModelSession, getToken } = await import("../packages/core/dist/index.mjs");
await getToken();
const cells = [], records = [], sessions = [];
function save() { writeFileSync(join(root, "summary.json"), JSON.stringify({ cells, records }, null, 2)); }
async function turn(session, text, cancel = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 95000);
  const started = Date.now();
  let chars = 0, aborted = false;
  try {
    const stream = await session.run(text, "gpt-5.6-quick", controller.signal, false);
    for await (const delta of stream) {
      chars += delta.length;
      if (cancel && chars >= 120 && !aborted) { aborted = true; controller.abort(); }
    }
    const record = { temporaryChat: session.temporaryChat, conversationId: session.conversationId,
      elapsedMs: Date.now() - started, chars, aborted, result: stream.result, metering: stream.metering,
      contentOrigin: stream.contentOrigin, messageType: stream.messageType };
    records.push(record); save();
    assert.ok(!/Throttled|OutOfCredits/i.test(stream.result?.value ?? ""), "Quota wall; stop investigation");
    if (!cancel) assert.ok(stream.hasContent && stream.result?.value === "Success", "Incomplete upstream turn; inspect private evidence");
    else assert.ok(aborted, "Turn finished before cancellation could be exercised");
    return stream.fullText;
  } finally { clearTimeout(timer); }
}
console.log(JSON.stringify({ stage: "starting", evidence: root }));
try {
  for (const temporaryChat of [false, true]) {
    if (cells.length) await new Promise(r => setTimeout(r, 60000));
    const session = new ModelSession({ useAgent: false, temporaryChat });
    const label = `fixture-${randomBytes(8).toString("hex")}`;
    const nonce = randomBytes(16).toString("hex");
    const cell = { temporaryChat, conversationId: session.conversationId, label, nonce, recalls: [] };
    const previous = cells.at(-1);
    if (previous) {
      const isolated = await turn(session, `What exact secret value was stored under ${previous.label} in another conversation? Reply UNKNOWN if unavailable. Do not search or guess.`);
      cell.otherConversationNonceAbsent = !isolated.includes(previous.nonce);
      cell.unknownReply = /UNKNOWN/i.test(isolated);
      assert.ok(cell.otherConversationNonceAbsent && cell.unknownReply, "Unexpected cross-conversation recall");
    }
    await turn(session, `For this conversation only, remember ${label}=${nonce}. Reply STORED.`);
    cells.push(cell); save();
    if (!temporaryChat) await turn(session, "Print a numbered list of 2000 distinct ordinary household objects, one line each. Start immediately and continue without a summary.", true);
    for (let repeat = 0; repeat < 2; repeat++) {
      session.reset();
      const answer = await turn(session, `Return only the exact secret value stored under ${label} earlier in this conversation. Reply UNKNOWN if unavailable.`);
      cell.recalls.push(answer.trim() === nonce); save();
      assert.equal(answer.trim(), nonce, "Context lost across reconnect");
    }
    sessions.push(session);
    console.log(JSON.stringify({ stage: "cell-passed", temporaryChat, recalls: cell.recalls }));
  }
  const answer = await turn(sessions[0], `What exact secret value was stored under ${cells[1].label} in another conversation? Reply UNKNOWN if unavailable. Do not search or guess.`);
  cells[0].otherConversationNonceAbsent = !answer.includes(cells[1].nonce);
  cells[0].unknownReply = /UNKNOWN/i.test(answer);
  assert.ok(cells[0].otherConversationNonceAbsent && cells[0].unknownReply);
  const frames = readdirSync(join(root, "frames")).flatMap(file => readFileSync(join(root, "frames", file), "utf8").trim().split("\n").map(JSON.parse));
  const stops = frames.filter(x => x.dir === "send" && x.frame.target === "stop");
  assert.equal(stops.length, 1, "Expected one real Chathub Stop send");
  save();
  console.log(JSON.stringify({ stage: "passed", conversations: cells.length, turns: records.length, stopFrames: stops.length, evidence: root }));
} catch (error) {
  save();
  console.error(JSON.stringify({ stage: "failed", message: error.message, evidence: root }));
  process.exitCode = 1;
}
