# Client contracts, validation and API adapters

The user approved three additions: a real-client test pack, strict tool validation,
and Responses/Messages adapters. Repository context tools, MCP integration,
model-profile changes and replay-product features remain outside this work.

## Approach

Reuse the existing Chat Completions engine and session/admission machinery. Add
validation at its shared request/output boundaries, and translate the two new
wire formats around that engine. This keeps auth, cancellation, account pacing,
model routing and telemetry consistent. Independent engines would duplicate
those guarantees; executing local tools inside the proxy would change its role.

Work in a separate checkout. The deployed def9700 service and the 200-case
benchmark continue unchanged. New tests default to scripted, local-only model
responses and isolated account/config directories; no worker sends live M365 turns.

## Real-client pack

Exercise actual client libraries/processes, not only handcrafted HTTP fixtures:
OpenAI and Anthropic SDKs for their respective protocols, and the installed Pi
client for its native tool schemas/loop. Use disposable projects, independent file
verification and explicit summaries of passed/failed/skipped cases. Cover a
multi-file repair, structured edits, exact Unicode/whitespace preservation,
invalid arguments, and cancellation/retry without executing incomplete tool calls.
Keep generated shell execution in the Docker sandbox. Do not call a missing
client a passing test. OpenClaw support may be an explicit opt-in CLI smoke check;
its availability and execution must be reported separately.

## Tool validation

Use Ajv and standard formats, rather than implementing a partial schema engine.
Do not coerce data, apply defaults, remove properties, fetch references or execute
async schemas. Support local references and normal tool-schema unions/constraints.
Arguments must be JSON objects and match the declared tool. Validate tool schemas
and named tool_choice before admission. Invalid request schemas return 400 without
a model call. Invalid generated calls return a structured 502 (or an SSE error),
with paths/reasons but no argument values. They are never emitted as executable
tool calls, acknowledged as a successful reply, or automatically re-sent.

Validate after parsing and after existing shell-to-write conversion. Apply the
check to the entire batch selected for emission. Preserve string bodies exactly.
This is an output contract, not native constrained decoding or a local permission
grant. Clients retain execution approvals and filesystem policies.

## Client API adapters

Implement POST /v1/responses and POST /v1/messages in both fetchApp and Nitro.
Support text, existing image inputs, function tools/results, named tool selection,
non-streaming responses and protocol-native SSE. Responses also supports freeform
text custom tools through a single string argument. Reject grammar-constrained
custom tools explicitly until their validation is implemented.

Requests use full client history. Server-side response storage/retrieval,
previous_response_id, background runs, native vendor/server tools, encrypted
reasoning items and Responses compaction are not emulated. Unsupported semantic
features return clear 400 errors. Generation hints unsupported by M365 (including
reasoning/thinking/temperature/output token targets) are documented and exposed
as ignored-control response headers, never presented as honored controls.

Preserve call/result IDs and input ordering. Translate HTTP and in-stream errors;
an error never ends in a successful completion event. Streaming remains incremental
for text, buffers validated calls as the existing engine does, forwards usage and
keepalives, and propagates consumer cancellation to the source stream/Stop path.

Messages accepts x-api-key with the existing key policy; Authorization retains
precedence. Origin checks, body bounds, queue limits, client profiles and caller
isolation remain enforced. No new administrator bypass is introduced.

## Acceptance

Red/green regressions for validation and protocol translation; SDK round trips
for text, streaming, tools/results, malformed requests, failures and aborts; actual
Pi fixture-project results; full build/unit/installed-runtime checks. Optional live
checks run only sequentially after the existing benchmark can safely accommodate
them. Report unavailable clients and unsupported features explicitly; do not claim
complete Codex/Claude Code compatibility from SDK tests alone.
