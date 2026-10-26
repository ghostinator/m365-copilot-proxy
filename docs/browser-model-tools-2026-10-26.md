# Browser model/tool comparison — October 26, 2026

Later [proxy/harness and fresh-nonce checks](research-verification-2026-10-26.md)
are separate evidence. They do not repair the custom browser probe or establish a model ranking.

This follows the separate 11-turn [browser settings study](browser-settings-2026-10-26.md).
The counts below belong to this second phase, not a cumulative success total.
See the updated [protocol reference](m365-copilot-api.md),
[prompting reference](prompt-engineering.md#october-26-2026--browser-evidence-and-validation-boundaries),
[tool-call grading rules](tool-calling.md#grading-a-tool-call-october-26-2026), and
[prioritized next checks](research-follow-up.md) for the current interpretation.
No result here establishes local-client CRUD.
The subsequent [offline boundary report](parser-boundaries-2026-10-26.md) identifies
typed-body/object-header concerns separately from this report's custom-header
probe mistake. Those findings do not turn the four manual relay reads into valid
proxy calls, and have not yet been fixed or tested through a real client.

## Outcome and limits

Twenty sequential browser turns across ten conversations: 19 completed, one
cancelled after approximately 90 seconds without response/progress frames.
No explicit throttle/credits-exhaustion result or recorder drops were observed.
Opus and Sonnet 5.5 were not tested. Browser settings were restored to Auto,
Work IQ on, protection on, normal chat; recording was detached. The disposable
local fixture was removed after verification.

The first six conditions tested three explicit UI models with protection on/off.
All six performed create/read/update/delete in Microsoft's remote sandbox with a
correct SHA-256 result and successful execution-result frames. Disabling protection
did not improve external-relay cooperation in this small sample.

**Important correction:** the initial external-tool prompt specified a custom
`path:` header. A manual relay accepted those responses, but the actual proxy's
single-argument read_file template expects the path as the whole fence body.
All four cooperative GPT responses therefore had the wrong path when passed to
the real parser. These are manual-relay cooperation results, not successful
end-to-end proxy/client tests. No parser/product regression is established: the
probe instructed the models to emit the incompatible form.

## Six-condition matrix

Work IQ stayed on. Each condition used a distinct conversation. Order was
GPT-5.6 on/off, GPT-6.1 off/on, Sonnet on/off. Fresh tests were spaced by at least
about a minute; requests were never concurrent. Sample size is one per cell.

| UI model | Captured tone | Protection | Remote CRUD | Custom read request / real fixture result |
| --- | --- | --- | --- | --- |
| GPT-5.6 Sol Quick response | Gpt_5_6_Chat | on | pass | requested; correct nonce |
| GPT-5.6 Sol Quick response | Gpt_5_6_Chat | off | pass | requested; correct nonce |
| GPT-6.1 Sol | Gpt_61_Sol_Reasoning | off | pass | requested; correct nonce |
| GPT-6.1 Sol | Gpt_61_Sol_Reasoning | on | pass | requested; correct nonce |
| Sonnet 5 | Claude_Sonnet_5 | on | pass | refused external protocol |
| Sonnet 5 | Claude_Sonnet_5 | off | pass | refused external protocol |

The GPT conditions took three turns each: remote CRUD, request a read, return the
real fixture contents. Sonnet conditions took two: remote CRUD, refused read.
Total for this matrix: 16 turns / six conversations. The same fixture nonce was
reused here, so this is not a fresh cryptographic challenge per cell. The fixture
was actually read locally before sending its contents; no arbitrary model command
was executed on the user's machine.

Recursive comparison of paired remote-CRUD requests found no non-identity field
differences for any of the three protection on/off pairs in the observed
StreamHub chatStreamRequest. This does not identify the toggle's downstream
representation or establish that it has no effect on actual content filtering.

## Exact remote CRUD prompt

```text
Use your available code-execution tool for a disposable-file test. Do not search or access existing user files. In Python, use tempfile.TemporaryDirectory(), create probe.txt containing alpha, read it and verify alpha, replace its contents with beta, read it and verify beta, delete probe.txt, and verify it no longer exists. Print exactly one JSON object with boolean keys created, read_ok, updated, deleted, and key sha256 containing the SHA-256 of the UTF-8 string copilot-crud-probe-2026-10-26. Include directory cleanup in a finally block or with-statement. Return the JSON result only. If no execution tool is available, reply exactly NO_EXECUTION_TOOL. Do not invent execution results.
```

All six successful tool outputs contained four true booleans and this independently
computed digest:

```text
41e72b9d911c404e7c9fb8c8457bf34812afdf2631954336ca8f03bdd6bc608f
```

Observed execution paths:

- GPT-5.6: `container.exec` invocation, `contentOrigin: CodeInterpreter`,
  execution-result object with executedCode/stdout/exitCode/status.
- GPT-6.1: successful CodeInterpreter execution-result messages; no named native
  invocation was extracted for these samples.
- Sonnet 5: `bash_tool` invocation, `contentOrigin: BashExecutor`, result containing
  stdout/stderr/exitCode/status without executedCode. Its nested JSON stdout had
  additional escaping in the observed text representation. The analysis decoder
  initially missed this shape; inspecting the raw result corrected the score.

These are remote filesystem operations. They do not grant access to local files.
Future monitoring/decoding must account for these different result shapes rather
than requiring executedCode on every tool result.

## External-relay probe and parser correction

The custom prompt explained that a separate relay would run read_file, asked the
model to wait for its result, and specified this header-style response:

````text
```read_file
path: C:/Users/BrandonCook/Desktop/M365 Copilot Proxy/.copilot-browser-probe/fixture.txt
```
````

Both GPT models emitted that block under both protection settings. The manual
relay extracted the intended filename, read the real fixture, and returned its
contents in a tool_response block. All four then returned its nonce correctly.
Sonnet refused the protocol and described its tools as remote sandbox tools.

The existing core dist export `parseToolCalls(text, tools)` was subsequently run
offline against all four GPT responses, with the same read_file schema. It found
a call but produced this argument, including the incorrect literal prefix:

```json
{"path":"path: C:/Users/BrandonCook/Desktop/M365 Copilot Proxy/.copilot-browser-probe/fixture.txt"}
```

The existing `formatToolDefinitions([readTool], 'relay')` renders a single path
parameter as the body, without a path header. The corrective lesson is to generate
probe prompts with the shipped formatter and validate calls with the shipped
parser before counting a client-tool success. The initial matrix cannot measure
full proxy compatibility.

## Follow-ups using the shipped formatter

Prompts were obtained from the existing core dist `formatToolDefinitions` export,
not rewritten approximations. The task asked for the same local fixture's nonce
after the user/relay returned the actual file or command output.

| Condition | Protection | Result |
| --- | --- | --- |
| Sonnet 5, normal chat, shipped relay + read_file | off | refused custom tool protocol |
| Sonnet 5, UI-verified temporary chat, shipped relay + read_file | off | refused custom tool protocol |
| Sonnet 5, UI-verified temporary chat, shipped relay + bash | off | refused terminal relay workflow |
| GPT-5.6, normal chat, shipped relay + read_file, fresh nonce | on | no response/progress within ~90 s; cancelled, inconclusive |

These add four turns / four conversations. Sonnet refusals were ordinary response
text, not explicit Disengaged/throttle frames in the inspected messages. They do
not overturn the repo's historical real-pi results: first-party browser context,
account personalization, framing placement and server route differ from the proxy.
No live proxy/harness comparison was run, and no proxy default was changed.

The normal-chat Sonnet follow-up accurately referenced earlier probe categories
despite a distinct conversation ID. This is a cross-chat-context confound worth
controlling, not proof of a particular memory mechanism. It may involve injected
context/personalization or inference. Temporary chats still refused, so this
observation does not fully explain the refusal. A future isolation experiment
should use independent per-cell random nonces and verify what context is carried.

## Cancellation observation

Stopping the stalled probe emitted a StreamHub frame with this sanitized shape:

```json
{"type":2,"item":{"type":"stop","topicId":"[omitted]","turnId":"[omitted]","reason":"ClientRequested"}}
```

This is one observed first-party StreamHub stop, not a verified replacement for
the existing proxy's Chathub cancellation protocol.

## Verification and highest-value next tests

Runtime assertions verified six remote-CRUD successes, four manual fixture-result
round trips, the four parser argument mismatches, three completed Sonnet framing
refusals, 20 captured outbound chat turns, and zero recorder drops. Results were
reconstructed using captured tone, conversation ID and time boundaries after an
early analysis-helper bookkeeping issue; labels were not trusted on their own.
The cancelled corrected-format turn is excluded from success/failure counts.

1. Run the exact shipped formatter/parser through the real local client/proxy in
   a disposable directory: create, read, edit, delete, and independently verify
   filesystem contents. Use fresh nonces and the client's actual tool schemas.
2. Separate browser-route/account context from model capability: compare a small
   Sonnet task through the proxy and first-party browser, controlling tools,
   framing and history. Repeat and rotate order before changing defaults.
3. Test array/object arguments, Unicode/spaced paths, multi-line edits and large
   tool outputs against the parser offline before spending live turns.
4. Audit native execution telemetry for CodeInterpreter/GeneratedCode/BashExecutor
   shapes and check cancellation cleanup; don't present remote execution as local.
5. Investigate DeepWork route/entitlement through a minimal proxy probe before
   exposing it as a supported model. The browser tone alone identifies no model
   version or independent reasoning-effort budget.

Raw captures remain in the live analysis runtime, not committed artifacts. Only
selected sanitized evidence is preserved here. No code changes, model entitlement
changes, global account-policy edits, or native Copilot Studio tools were added.
