# Client API adapters and tool contracts

The local implementation adds `POST /v1/responses` and `POST /v1/messages`
alongside Chat Completions, in both the embeddable fetch app and Nitro server.
All three use the same session pool, admission queue, application profiles,
request limits and disconnect cancellation. This is wire compatibility for the
documented subset, not a claim that every Codex or Claude Code CLI feature works.
The new routes participate in chat history filters, reliability/latency reports,
alerts and update/restart draining. Historical materialized totals keep the
classification saved by the version that recorded them.

| Surface | Supported |
| --- | --- |
| Responses | Text and image URLs, instructions, full history, function tools, plain-text custom tools, JSON and SSE |
| Messages | Text, URL/base64 images, system messages, full tool-use/result history, JSON and SSE |
| Authentication | Bearer keys; Messages SDK `x-api-key` also uses the existing key policy. Explicit Authorization takes precedence. |
| Tool arguments | Local draft-07 JSON Schema validation, formats, required fields, enums, nested objects/arrays and local references |

Send complete conversation history, including exact tool call IDs and results.
Response IDs are not stored continuation handles. Stored/background responses,
`previous_response_id`, conversation storage, retrieval, native vendor tools,
grammar constraints and structured output formats are rejected with HTTP 400.
Encrypted reasoning and compaction blocks are unsupported.

Generation controls such as reasoning effort, thinking, temperature and output
token limits are accepted as compatibility hints and listed in
`x-m365-ignored-controls`; they do not change upstream inference settings.
Choosing an existing model ID still selects its existing route.

Tool schemas compile before admission. Generated arguments are validated after
the existing parser and heredoc conversion, before any executable call is emitted.
Invalid request schemas return 400. Invalid generated arguments return 502, or an
error event if streaming has begun, with no tool-call emission, acknowledgement
or validation-triggered upstream retry. Validation does not coerce values, insert
defaults or remove properties. Remote/async schemas are rejected; tool counts,
schema bytes and nesting are bounded. This proxy returns calls to the client; it
does not execute local tools itself.

New validation diagnostics contain structural errors rather than argument values.
Existing explicitly enabled raw debug/frame capture remains raw; that facility
is separate from operational diagnostics.

Run `pnpm test:clients` after installing dependencies. The SDK tests use real
OpenAI and Anthropic clients against the in-process fetch app with a scripted
M365 session. The [Pi pack](client-test-pack.md) additionally runs native client
tools in disposable Docker containers with networking disabled. Neither test
suite measures live model compliance or establishes complete CLI compatibility.

## Verification on October 26, 2026

The Windows workspace build passed. The full unit run passed 701 tests with six
live tests skipped (`pnpm exec vitest run --maxWorkers=2 --testTimeout=15000`).
This includes the actual SDK text/tool/history/stream/error cases and new saved
activity, reliability and restart-drain regressions for both adapters. The native
Pi pack passed five cases, skipped OpenClaw, and attempted zero external fetches.

The standalone offline test uses the real Nitro listener and actual SDKs with
Microsoft auth/WebSocket fixtures. The full standalone run passed: JSON/SSE,
key-policy, malformed/oversized bodies, throttling, reconnect and SDK aborts.
Both actual SDK aborts released admission, and the server stopped gracefully.
Run it with `pnpm test:installed` alongside `pnpm test:clients`.
The standalone harness now waits for actual authentication readiness within a
30-second startup deadline; opening a listener alone is insufficient. One cold
startup exceeded the old test window before any diagnostics; its retry passed.
The missing-credentials case still requires configuration exit 78.

The follow-up repaired the SQLite response types, incomplete fixtures, notification
ID type and CLI helper declarations. `pnpm typecheck` now passes for the workspace
and generated Nitro server without relaxing compiler settings. An independent
review was requested but could not run because the reviewer hit its usage limit;
local source review found and repaired the new-route monitoring/drain omissions.

Further streaming regressions confirmed and fixed stale model labels after quota
fallback and dropped safe tool-validation details. Content and terminal Responses
events now report the served model. Messages sends pings until the actual reply
starts, so `message_start` can report the served model rather than the initial
requested route. Cancellation before `message_start` remains supported. The new
regressions failed before the fix; the targeted streaming/SDK run passed 107 tests.

These findings apply to the local client-contracts branch. The deployed def9700
service remains the baseline of the ongoing live model benchmark. Live acceptance
of the new build and complete Codex/Claude Code CLI compatibility remain unverified.
