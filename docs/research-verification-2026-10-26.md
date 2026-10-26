# Local implementation and live verification — October 26, 2026

This follows the earlier browser/parser reports. After reviewing these bounded
findings, the user authorized publication in the existing draft PR #90. Private
evidence directories below contain account traffic and must not be
committed. Only sanitized observations are included here.

## Parser fixes and real local files

The shared fenced parser now coerces schema-typed bodies and inline JSON object
headers. Malformed JSON arrays/objects are rejected rather than becoming a
different argument type. String file bodies, YAML values and scalar array
shorthand retain their existing behavior. This is not a general JSON Schema
validator: clients still validate their own tool arguments.

Eleven regressions were added: nine failed before the fix, all eleven passed
afterwards. All 114 fenced-parser tests passed. The rebuilt handler probe now
returns **zero incompatible responses out of twelve**, with no external calls
and all admission releases observed, versus six incompatible before the fix.

One real Pi session against a separate rebuilt Nitro instance passed local CRUD:
`read → write → read → edit → read → bash`. The parent process independently
checked the fresh nonce, edited file bytes, unchanged input and deleted fixture,
then removed its remaining fixture files. Pi used Chat Completions with the
included `claude-sonnet` route and real read/write/edit/bash tools. This is one
successful harness run, not a model ranking or a Sonnet 5 result.

Evidence: private temp directory `m365-live-crud-71c7543c-5c8b-421f-8e26-a5b47dc2d2d6`.
Reproduce with `M365_LIVE=1 node scripts/live-local-crud-probe.mjs`.

This is the useful capability beyond the browser's observed execution: the caller
can supply tools that operate on its actual local filesystem or shell, validate
their arguments and return real results. Browser Copilot's native executions in
these studies used remote sandboxes. The proxy does not independently grant
filesystem access; Pi or another compatible harness supplies and authorizes it.
No additional backend privilege or hidden reasoning setting was demonstrated.

## Cancellation, reconnect and exact response assembly

The initial normal-chat probe stored the correct nonce upstream, sent Stop during
a long answer, received a type-3 acknowledgement, then recalled the nonce after
reconnect. It exposed a proxy bug: a one-character message preview was combined
with a delta that repeated that character. The final server snapshot was correct;
the assembled proxy answer had an extra leading character.

A transport regression reproduced `cc0ffee` instead of `c0ffee` before the fix.
When the cursor names a card text field, assembly now uses that field's value
(including an empty string), retaining the old message-text fallback for other
shapes. It does not guess which repeated characters to remove. Existing
multi-message/fence and late-snapshot tests continue passing.

The repeated live core check passed nine turns in two conversations: normal and
temporary chats each recalled their own fresh nonce exactly after two explicit
reconnects; each returned UNKNOWN for the other conversation's label. One abort
sent a real Chathub Stop and the following turn retained context. These finite
observations do not establish a general privacy guarantee or identify a memory
implementation. Temporary chat is already the proxy default (`disableMemory=1`);
`M365_SAVE_HISTORY=1` opts into persistent history.

Evidence: private `m365-session-follow-up-5981f969-e7c8-4054-815f-f613f630bb8c`
(first failure) and `m365-session-follow-up-4a0ced3a-c9ef-495b-aa50-1626313f523c`
(successful repeat). Reproduce with `M365_LIVE=1 node scripts/live-session-follow-up.mjs`.

A separate **actual HTTP disconnect against rebuilt Nitro** also passed: cancel
the SSE fetch after the first content character, observe Chathub Stop and its
type-3 acknowledgement, then recover the exact marker using the full client
transcript. The first HTTP attempt ended in a short upstream refusal before its
old length threshold, so it did not test cancellation. The second did cancel,
but its follow-up omitted history and correctly created a fresh conversation
(UNKNOWN). The corrected third attempt passed cancellation and history replay.

This distinction is intentional: the pool resumes only a unique, acknowledged
transcript prefix and matching assistant reply. `x-conversation-id` labels request
activity; it is not a session-resumption capability. An interrupted request may
require a new upstream conversation with replayed client history. The core
session test above separately establishes continuity when its explicit session
IDs are reused. Do not conflate the two results.

Evidence: private `m365-live-crud-98eef840-621c-4ab3-b71e-9a19bbb1c986`
(short refusal), `m365-live-crud-8d92121c-e2b9-415f-a83a-fd4b0ac3f55e`
(cancel passed, missing-history recovery check invalid) and
`m365-live-crud-1db524c2-779b-409e-92a9-adfe8f6483bf` (corrected pass).
Reproduce with `M365_LIVE=1 node scripts/live-local-crud-probe.mjs --http-cancel`.

Four sanitized offline transport fixtures cover CodeInterpreter/Internal,
CodeGenerator/GeneratedCode, CodeInterpreter/GeneratedCode and
BashExecutor/Internal. The observed interpreter result keys include executedCode,
status, exitCode, stdout, stderr and outputFiles; BashExecutor lacks executedCode
and outputFiles. These control messages produce no local tool call or visible
file-operation success. They remain observable in private frame dumps; no new
public execution telemetry API was added.

## DeepWork on Chathub through the proxy handler

An invented-tone negative control was rejected with "Failed to invoke 'Chat'".
The accepted candidate used the actual rebuilt fetch handler, formatter, parser,
session pool and Chathub transport. A test-only WebSocket send substitution changed
the outgoing tone to `DeepWork`; it did not add a model alias. Two sends in one
conversation were recorded with no agent attached and the ordinary agent-less
options. Both returned HTTP 200 and final `Success`, content origin `DeepLeo`,
on `OfficeWebIncludedCopilot` / `Starter`.

The first response produced exactly one correctly parsed local read call. The
probe read a fresh nonce from its own local file and supplied the real tool
result; the second response contained that nonce. Neither final throttling object
contained a metering field (conversation counts 1 and 2 of 600). Absence in two
turns does not establish universal entitlement or absence of future charges.
`DeepLeo` does not identify a particular underlying model. No independent
reasoning-effort control was demonstrated.

The first attempt at tone substitution missed the combined Chat/Metrics payload
and ran ordinary Sonnet instead; its two turns are excluded from DeepWork results.
The corrected probe handles all record-separated frames and asserts substitution
before accepting any tool-call evidence. It permits one upstream chat send per
HTTP request and blocks automatic resend attempts.

Evidence: private `m365-deepwork-124dcbda-67e5-46d0-b9b0-b00ad57eb088`.
Reproduce with `M365_LIVE=1 node scripts/live-deepwork-route-probe.mjs`.
This n=1 task establishes feasibility, not a release-quality benchmark. No new
model mapping, reasoning setting or default is shipped.

## Controlled browser context follow-up

Four Auto cells were tested in the order temporary/on, normal/off, temporary/off,
normal/on (temporary chat / Work IQ). Each used a distinct captured conversation
ID, a fresh random label and a 128-bit nonce. Each seed was followed by two exact
recalls: **8/8 passed**. A preliminary normal/on Quick-response control also
passed 2/2. These are repeated turns within one conversation per cell, not
independent replications of model performance.

| Browser condition | Tone | Option entries | gpts / execution controls | Exact recalls |
|---|---|---:|---|---:|
| Temporary, Work IQ on | Magic | 80 | present / present | 2/2 |
| Normal, Work IQ off | Magic | 71 | absent / absent | 2/2 |
| Temporary, Work IQ off | Magic | 71 | absent / absent | 2/2 |
| Normal, Work IQ on | Magic | 80 | present / present | 2/2 |

Four queries for another conversation's label returned UNKNOWN and omitted its
nonce. The first ran in temporary/on Quick-response mode before selecting Auto;
the other three ran under their final Auto conditions. There were nineteen turns
across five captured conversations including the preliminary control and that
extra query. The browser was restored to normal Auto with Work IQ on.

A setup observation matters: selecting Quick response after switching Work IQ
off restored Work IQ on. That query was relabeled from its actual checked state
and wire envelope, not counted as Work IQ-off evidence. Final Auto cells were
verified after setting both toggles. This does not prove every model switch has
the same effect.

No cross-conversation nonce recall was observed here. This does not prove that
Copilot cannot use saved memory, organizational context or inferred context, and
does not retroactively explain Sonnet's earlier comments about other probes.
Fresh nonces reduce the ambiguity of those earlier natural-language probes.
Raw browser traffic stayed private/in memory; this table is the sanitized record.

## Build and regression checks

The full workspace build, including standalone Nitro, completed successfully.
The final unit run passed **625 tests**, with six live tests skipped, using
`pnpm exec vitest run --maxWorkers=2 --testTimeout=15000`. An earlier default
parallel run timed out one history worker test; the bounded run passed. An
attempt to force all unit tests into a different data directory also broke four
path-assumption tests and was discarded. These qualifications are preserved
rather than reported as an unqualified default-command pass.

Native Windows Node/Pi/Git Bash were used because Nix is absent on this machine.
The installed proxy was not replaced. Test servers and fixtures were owned by
the probes; the existing MSAL cache was referenced without copying credentials.

All five bounded investigations in the [research checklist](research-follow-up.md)
now have recorded outcomes. Broader model/account replications, separate reasoning
effort, new API adapters and a released DeepWork model ID remain unimplemented.
An independent read-only review of the scoped source, tests, probes and claims
found no blocking findings; it did not independently rerun the live experiments.
