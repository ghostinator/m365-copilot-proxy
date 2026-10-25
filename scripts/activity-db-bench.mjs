// Local synthetic telemetry only: never authenticates or sends a model request.
import { RequestSources } from "../packages/proxy-lib/dist/index.mjs";
import { randomUUID } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "m365-activity-bench-"));
const store = new RequestSources(directory), count = 10000, now = Date.now(), start = performance.now();
for (let i = 0; i < count; i++) {
  store.record({ id: randomUUID(), clientAddress: `100.64.0.${i % 8 + 1}`, clientSoftware: "OpenAI Python", method: "POST", endpoint: "/v1/chat/completions", source: "application", receivedAt: new Date(now - (i % 8760) * 3600000).toISOString(), status: i % 17 ? 200 : 429, applicationStatus: i % 17 ? 200 : 429, outcome: i % 17 ? "success" : "error", durationMs: 300, responseBytes: 1234, model: i % 2 ? "claude-sonnet" : "gpt-6-sol", servedModel: i % 2 ? "claude-sonnet" : "gpt-6-sol", streamed: false });
}
store.flush();
const writeMs = Math.round(performance.now() - start), queries = [];
for (const range of ["24h", "7d", "30d", "90d", "365d", "all"]) {
  const before = performance.now(), state = store.snapshot({ range });
  queries.push({ range, requests: state.summary.total, queryMs: Math.round((performance.now() - before) * 100) / 100 });
}
store.close();
const bytes = statSync(join(directory, "activity.sqlite")).size;
console.log(JSON.stringify({ records: count, writeMs, committedDatabaseBytes: bytes, bytesPerRecordIncludingIndexesAndRollups: bytes / count, queries }, null, 2));
