import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dockerProject } from "./docker-project.mjs";

export async function runPiPack() {
  const results = [];
  const managed = join(homedir(), ".pi/agent/install");
  const marker = join(managed, "current-version");
  if (!existsSync(marker) && !process.env.CLIENT_TEST_PI_MODULES) return {
    passed: 0, failed: 0, skipped: 2, results: [{ client: "Pi", status: "skipped", reason: "Managed Pi install unavailable; set CLIENT_TEST_PI_MODULES" },
      { client: "OpenClaw", status: "skipped", reason: "No OpenClaw CLI run requested" }],
  };
  const version = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "explicit";
  assert.match(version, /^[0-9A-Za-z._+-]+$/);
  const modules = process.env.CLIENT_TEST_PI_MODULES || join(managed, "releases", version, "node_modules");
  const load = path => import(pathToFileURL(join(modules, path)).href);
  const root = mkdtempSync(join(tmpdir(), "m365-client-pack-"));
  const priorEnv = { ...process.env };
  const priorFetch = globalThis.fetch;
  let externalRequests = 0, active;
  // No inherited provider credentials, settings or real M365 account state.
  for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^M365_|^PI_|^OPENAI_|^ANTHROPIC_/i.test(key)) delete process.env[key];
  Object.assign(process.env, { M365_DATA_DIR: root, M365_CACHE_FILE: join(root, "absent-cache"),
    M365_SECRETS_FILE: join(root, "absent-secrets"), M365_NO_INTERACTIVE: "1", M365_NO_CONFAB_RETRY: "1",
    M365_AVOID_THROTTLING: "0", M365_FORCE_AGENT: "0", M365_DEBUG: "0", M365_TRACE: "0",
    PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1", PI_TELEMETRY: "0" });
  globalThis.fetch = async (input, options) => {
    const request = new Request(input, options);
    if (request.url !== "http://fixture.invalid/v1/chat/completions") {
      externalRequests++;
      throw new Error("Client pack blocks external fetch");
    }
    assert.ok(active, "Unexpected provider request outside a fixture");
    const body = await request.json();
    active.requests.push(body);
    assert.equal(body.stream, true);
    assert.equal(request.headers.get("authorization"), "Bearer fixture-only");
    const response = await active.handle(active.schema.parse(body), active.pool, { signal: request.signal });
    return response;
  };
  try {
    const { Agent } = await load("@earendil-works/pi-agent-core/dist/agent.js");
    const { streamSimple } = await load("@earendil-works/pi-ai/dist/api/openai-completions.js");
    const { createReadTool } = await load("@earendil-works/pi-coding-agent/dist/core/tools/read.js");
    const { createWriteTool } = await load("@earendil-works/pi-coding-agent/dist/core/tools/write.js");
    const { createEditTool } = await load("@earendil-works/pi-coding-agent/dist/core/tools/edit.js");
    const { createBashTool } = await load("@earendil-works/pi-coding-agent/dist/core/tools/bash.js");
    const { handleChatCompletion, ChatCompletionRequest } = await import("../../packages/proxy-lib/dist/index.mjs");
    const model = { id: "claude-sonnet", name: "Scripted Pi fixture", api: "openai-completions", provider: "fixture",
      baseUrl: "http://fixture.invalid/v1", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: false } };
    const fence = (tool, body) => `\`\`\`${tool}\n${body}\n\`\`\``;
    const fixtures = [
      { name: "multi-file-repair-and-test", initial: { "math.py": "def add(a, b):\n    return a - b\n", "test_math.py": "from math import add\nassert add(2, 3) == 5\n" },
        replies: [fence("read", "path: math.py"), fence("edit", 'path: math.py\nedits: [{"oldText":"return a - b","newText":"return a + b"}]'),
          fence("edit", 'path: test_math.py\nedits: [{"oldText":"from math import add","newText":"from calc import add"}]'),
          fence("bash", "mv math.py calc.py && python -B test_math.py"), "Verified."],
        expected: { "calc.py": "def add(a, b):\n    return a + b\n", "test_math.py": "from calc import add\nassert add(2, 3) == 5\n" }, actions: ["read", "edit", "edit", "bash"], shell: 1 },
      { name: "structured-edits-unicode-whitespace", initial: { "unicode.txt": "  café 😀\n\talpha\n\tomega\n\n" },
        replies: [fence("edit", 'path: unicode.txt\nedits:\n  - oldText: alpha\n    newText: βeta\n  - oldText: omega\n    newText: Ωmega'),
          fence("write", "path: exact.txt\n\n\n  naïve 😀\n\tkept  "), "Verified."],
        expected: { "unicode.txt": "  café 😀\n\tβeta\n\tΩmega\n\n", "exact.txt": "\n  naïve 😀\n\tkept  " }, actions: ["edit", "write"], shell: 0 },
      { name: "tool-failure-then-repair", initial: { "state.txt": "draft\n" },
        replies: [fence("edit", 'path: state.txt\nedits: [{"oldText":"missing","newText":"bad"}]'),
          fence("edit", 'path: state.txt\nedits: [{"oldText":"draft","newText":"verified"}]'), "Verified."],
        expected: { "state.txt": "verified\n" }, actions: ["edit", "edit"], errors: 1, shell: 0 },
      { name: "invalid-arguments-never-execute", initial: { "state.txt": "untouched\n" },
        replies: [fence("edit", 'path: state.txt\nedits: [{"oldText":42,"newText":"bad"}]')],
        expected: { "state.txt": "untouched\n" }, actions: [], shell: 0, providerError: true },
      { name: "abort-incomplete-call-and-retry", initial: { "state.txt": "untouched\n" },
        replies: ["ABORT", fence("read", "path: state.txt"), "Recovered."],
        expected: { "state.txt": "untouched\n" }, actions: ["read"], shell: 0, abort: true },
    ];
    for (const fixture of fixtures) {
      let project;
      try {
        const cwd = resolve(root, "workspace");
        project = dockerProject(cwd);
        project.verifyIsolation();
        await assert.rejects(project.operations.readFile(resolve(cwd, "..", "outside.txt")), /leaves fixture/);
        for (const [path, value] of Object.entries(fixture.initial)) project.write(`/task/${path}`, value);
        let runs = 0, releases = 0, acknowledgements = 0, abortObserved = false;
        const requests = [];
        const session = { turnCount: 0, conversationId: fixture.name, async run(_text, _model, signal) {
          const reply = fixture.replies[runs++];
          assert.ok(reply, "Unexpected extra model turn/retry");
          this.turnCount++;
          if (reply === "ABORT") return {
            fullText: "```write\npath: forbidden.txt\nincomplete", hasContent: true,
            result: { value: "Success" }, images: [],
            async *[Symbol.asyncIterator]() {
              yield "```write\npath: forbidden.txt\nincomplete";
              abortObserved = true;
              queueMicrotask(() => agent.abort());
              await new Promise((_resolve, reject) => {
                const stop = () => reject(new DOMException("Fixture aborted", "AbortError"));
                if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
              });
            },
          };
          return { fullText: reply, hasContent: true, result: { value: "Success" }, images: [], throttle: { current: runs, max: 600 },
            async *[Symbol.asyncIterator]() { yield reply; } };
        } };
        const state = { session, sentMessageCount: 0, lastAccessedAt: Date.now(), pendingNote: null, history: [], identity: "fixture" };
        const pool = { shutdown: new AbortController(), async acquire() { return () => { releases++; }; },
          resolve() { return state; }, acknowledge() { acknowledgements++; } };
        active = { handle: handleChatCompletion, schema: ChatCompletionRequest, requests, pool };
        const tools = [createReadTool(cwd, { operations: project.operations }), createWriteTool(cwd, { operations: project.operations }),
          createEditTool(cwd, { operations: project.operations }), createBashTool(cwd, { operations: project.bash, exposeSessionEnvironment: false })];
        const agent = new Agent({ initialState: { model, tools, systemPrompt: "Offline scripted client conformance." },
          streamFn: (m, context, options) => streamSimple(m, context, { ...options, apiKey: "fixture-only", maxRetries: 0 }),
          getApiKey: () => "fixture-only", toolExecution: "sequential" });
        const actions = [], errors = [];
        agent.subscribe(event => { if (event.type === "tool_execution_start") actions.push(event.toolName);
          if (event.type === "tool_execution_end" && event.isError) errors.push({ tool: event.toolName, result: event.result }); });
        const deadline = setTimeout(() => agent.abort(), 45_000);
        try {
          await agent.prompt("Run the deterministic fixture.");
          if (fixture.abort) {
            assert.equal(abortObserved, true);
            assert.deepEqual(actions, [], "Aborted incomplete turn executed a tool");
            await agent.prompt("Retry safely with full history.");
          }
        } finally { clearTimeout(deadline); }
        assert.deepEqual(actions, fixture.actions);
        assert.equal(errors.length, fixture.errors || 0, JSON.stringify(errors));
        assert.equal(project.shellCalls, fixture.shell);
        assert.equal(runs, fixture.replies.length, "No extra retries/turns");
        assert.equal(releases, runs, "Every request releases admission");
        assert.equal(acknowledgements, runs - (fixture.abort || fixture.providerError ? 1 : 0), "Failed/aborted turns are not acknowledged");
        for (const [path, value] of Object.entries(fixture.expected)) assert.deepEqual(project.read(`/task/${path}`), Buffer.from(value), `${fixture.name}: exact ${path} bytes`);
        assert.deepEqual(project.files(), Object.keys(fixture.expected).sort(), "No missing or unexpected project files");
        assert.equal(requests.at(-1).messages.filter(m => m.role === "tool").length, actions.length, "Pi returns actual tool results in history");
        assert.deepEqual(requests[0].tools.map(t => t.function.name), ["read", "write", "edit", "bash"]);
        assert.equal(requests[0].tools.find(t => t.function.name === "edit").function.parameters.properties.edits.type, "array");
        if (fixture.providerError) assert.ok(agent.state.messages.some(m => m.role === "assistant" && m.stopReason === "error"));
        results.push({ case: fixture.name, status: "passed", actions, shellCalls: project.shellCalls, requests: runs,
          exactFileBytes: true, acknowledgements });
      } catch (error) { results.push({ case: fixture.name, status: "failed", reason: error.message }); }
      finally { active = undefined; project?.close(); }
    }
    assert.equal(externalRequests, 0);
  } finally {
    globalThis.fetch = priorFetch;
    for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
    Object.assign(process.env, priorEnv);
    rmSync(root, { recursive: true, force: true });
  }
  results.push({ client: "OpenClaw", status: "skipped", reason: "Optional CLI not exercised; no compatibility claim" });
  return { mode: "scripted model conformance; not live model performance", piVersion: version, externalRequests,
    passed: results.filter(r => r.status === "passed").length, failed: results.filter(r => r.status === "failed").length,
    skipped: results.filter(r => r.status === "skipped").length, results };
}
