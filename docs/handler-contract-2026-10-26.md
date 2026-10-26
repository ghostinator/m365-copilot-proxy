# Handler contract and client-surface investigation — October 26, 2026

Historical pre-fix observations follow. See [later verification](research-verification-2026-10-26.md)
for the parser fix, successful full build, live Pi CRUD and subsequent regression results.
The endpoint-surface finding remains unchanged.

## Scope

Follow-up to the [offline parser findings](parser-boundaries-2026-10-26.md).
This phase exercised the real built handleChatCompletion renderer with a scripted
upstream session/pool, then checked the embeddable fetch app's endpoint surface.
No Microsoft request, local client tool, or model-generated command was executed.
Config/cache/secrets paths were isolated under a fresh temporary data path before
imports; external fetch was disabled. No deployed process was restarted or changed.

The workspace build completed core and proxy-lib. The bounded command capture
ended before standalone-server build completion was confirmed, so this report
does not claim a successful complete workspace/Nitro build. The two rebuilt
libraries were used for the checks below. No implementation fix was applied.

## Parser concerns reach API callers

Run the reproducible, read-only probe from the repository root:

```powershell
node scripts/offline-handler-contract-probe.mjs
```

The probe supplies six deterministic upstream replies and reads each through
JSON and SSE response paths. It does not start an HTTP listener or contact M365.
Its isolated fake pool/session avoids real auth and account state. Control cases
and lifecycle assertions fail the command if the probe stops exercising the
expected boundary; compatibility findings are reported as observations rather
than assertions that the bugs must remain forever.

| Scripted reply | JSON response | SSE response |
| --- | --- | --- |
| Valid string path body | correct tool argument | correct tool argument |
| Object-typed JSON body | config is a string | config is a string |
| Inline object header | options is a string | options is a string |
| YAML object header control | correct object | correct object |
| Valid JSON object-item array control | correct array | correct array |
| Truncated JSON object-item array | raw text becomes a string element | raw text becomes a string element |

All twelve returned HTTP 200. The six control responses matched their schemas;
the six problem responses still emitted tool_calls with incompatible argument
types/shapes. Each request used exactly one scripted upstream run and called the
fake pool's acknowledgement and admission-release callbacks once. This checks the
handler's callback lifecycle, not the real queue's complete behavior. The probe observed zero external fetch
requests. It does not establish whether a specific client rejects or repairs the
bad arguments, but the behavior is not confined to an internal parser helper.

Representative emitted arguments:

```json
{"config":"{\"mode\":\"safe\"}"}
```

```json
{"target":"main","options":"{\"mode\":\"safe\"}"}
```

```json
{"path":"C:/probe.txt","edits":["[{\"old_text\":\"a\",\"new_text\":"]}
```

Source review followed parseToolCalls -> handler parseReply/produce -> JSON/SSE
rendering. The relevant handler/index source was read directly because graph
coverage reported changed metadata. Graph results were navigation aids, not
freshness proof.

## Existing lifecycle regression checks

After rebuilding core/proxy-lib, this selection passed **192 tests in four files**:

```powershell
Remove-Item Env:M365_LIVE -ErrorAction SilentlyContinue
pnpm exec vitest run packages/core/src/fenced.test.ts packages/core/src/session.test.ts packages/core/src/session-connection.test.ts packages/proxy-lib/src/streaming.test.ts
```

The run also used an isolated M365_DATA_DIR. Existing coverage includes parser
guards, mocked socket timeout/close/cancellation behavior, reconnect handling,
SSE cancellation and signal propagation. These are deterministic tests, not a live
Stop acknowledgement, real-client reconnect, or account/session continuity test.
Their success does not contradict the new contract findings: those schema cases
were measured by the separate probe. No new unit tests or parser fix were added.

## API surface is separate from model/tool capability

An isolated createApp fetch check observed:

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | /health/live | 200 |
| GET | /v1/models | 200 |
| POST | /v1/responses | 404 |
| POST | /v1/messages | 404 |

External fetch and ModelSession.run were guarded; assertions verified zero calls
to either. The app was closed after the requests. Standalone route-file inspection
also found chat/completions and model routes, not Responses/Messages handlers.
References to these endpoint names in activity history classify requests/errors;
they do not implement those APIs. This is evidence about the inspected bare
fetch app and route files, not every installed release, companion gateway or
third-party adapter.

A client that requires one of the unsupported protocols needs an appropriate
adapter or supported Chat Completions mode. Changing model, reasoning tone or
content-protection settings does not add that HTTP API. No adapter was implemented
or client configuration changed in this investigation.

## What remains

At this phase, the [research checklist](research-follow-up.md) still required real local-client
CRUD with generated templates and exact parsed arguments, focused type-preservation
fixes/regressions, remote execution-result fixture coverage, and live context/route
checks. Verify the chosen client's actual protocol before spending model quota.
The later [verification report](research-verification-2026-10-26.md) records these
bounded checks and their outcomes. Neither passing unit tests nor an HTTP-200 tool_calls response proves that files
were changed correctly in the user's workspace.
