# First-party browser settings probes — October 26, 2026

Later same-day implementation/live checks are in [research verification](research-verification-2026-10-26.md).
This report preserves the initial browser-only phase and its original limitations.

**Read with the later [model/tool comparison](browser-model-tools-2026-10-26.md).**
This report covers the initial 11-turn phase; the later report covers a separate
20-turn phase and the external-tool probe correction. Formatting/remote execution
successes here do not establish local-client CRUD or proxy support for DeepWork.
The canonical [protocol notes](m365-copilot-api.md),
[tool-call grading rules](tool-calling.md#grading-a-tool-call-october-26-2026), and
[next checks](research-follow-up.md) incorporate both reports with those limits.
An additional [offline parser investigation](parser-boundaries-2026-10-26.md)
documents typed-argument concerns; it adds no live turns or local-client validation.

## Scope and evidence

Agent-driven tests in the user's signed-in Chrome for Testing browser, using the
official Playwright MCP 0.0.83 and Chrome DevTools MCP 1.12.0 servers. A passive
Playwright CDP session recorded WebSocket frames and relevant HTTP metadata.
Tests started at 2026-10-26T11:28:59Z (05:28:59 America/Denver).

Eleven turns across ten conversations ran sequentially. Fresh test conversations
were spaced at least about one minute apart. No explicit throttle, OutOfCredits,
or recorder drops were observed. Browser settings were restored to Auto, Work IQ
on, harmful content protection on, in an empty new chat. The passive recorder was
detached after verification; the browser remains open.

This report preserves selected sanitized evidence. Raw session captures remain
in the live analysis runtime and are not archived in the repository. Account,
tenant, conversation, connector and invocation identifiers are omitted here.

The compared outbound messages were first-party StreamHub `chat_request` items
containing `chatStreamRequest`. They are evidence of that observed transport, not
proof that every downstream request or conversation-creation setting was captured.

## Reproducible formatting prompt

```text
This is a standalone protocol test. Do not search, use Work IQ, or access files. Return only one fenced bash block containing a portable shell command that prints the integer result of 17 * 19. Do not execute the command.
```

| Case | First request, UTC | UI settings | Captured tone | Result |
| --- | --- | --- | --- | --- |
| A1 | 11:29:25 | Auto, protection on, Work IQ on | Magic | bash fence |
| B1 | 11:30:34 | Auto, protection off, Work IQ on | Magic | same bash fence |
| C1 | 11:31:47 | Quick response, protection on, Work IQ on | Chat | same bash fence |
| D1 | 11:32:51 | Think deeper, protection on, Work IQ on | Reasoning | same bash fence |
| E1 | 11:34:06 | Advanced reasoning (Experimental), protection on, Work IQ on | DeepWork | same bash fence |
| B2 | 11:35:31 | Auto, protection off, Work IQ on | Magic | same bash fence |
| A2 | 11:38:42 | Auto, protection on, Work IQ on | Magic | same bash fence |
| F1 | 11:40:03 | Auto, protection on, Work IQ off | Magic | bash fence, literal 323 |

A1 through A2 all returned:

````text
```bash
printf '%d\n' $((17 * 19))
```
````

F1 returned `printf '%d\n' 323` in a bash fence. These are formatting successes,
not local tool calls, file CRUD tests, or real pi/OpenClaw coding-loop results.

## H-BROWSER-PROTECTION: the switch changes the observed turn payload

**Prediction/falsification:** identical fresh-chat prompts with the switch on/off
should differ in a non-identity request field if this payload carries the setting.
Repeat in reverse order to reduce order effects.

**Result:** not observed in two controlled pairs (A1/B1, then B2/A2). UI switch and
off-banner states were checked directly. Recursive comparison found no changed
non-identity fields. All four requests had the same 80 optionsSets entries,
including `rai_harmful_content_protection`, and all four answers were identical.
The switch itself produced no observed network request in the inspected interval.
This does not establish that the setting is ineffective or locate its downstream
representation. The prompt was benign and did not test the filter's boundary.

Microsoft documents that this policy applies to text filtering, not images or
agents; prompt-injection defense and other core protections remain enforced:
https://learn.microsoft.com/en-us/microsoft-365/copilot/harmful-content-protection-copilot-chat

Earlier user-driven refusal comparisons had conversation-history and setting-label
confounds. They are not counted as controlled on/off evidence here.

## H-BROWSER-MODES: response modes expose a separate reasoning-effort control

**Prediction/falsification:** compare the identical formatting prompt across the
four UI modes; look for a field in addition to `tone`.

**Result:** one controlled turn per non-Auto mode. Observed values were `Magic`,
`Chat`, `Reasoning`, and `DeepWork`. For these tests, non-identity turn-payload
differences between modes were limited to `tone`; no separate reasoning-effort
parameter was observed. All used 80 optionsSets entries and returned the requested
fence. `DeepWork` was also observed in the earlier user-driven capture.

This identifies a UI routing value, not the underlying model, supported proxy
tone schema, entitlement, metering, latency/quality benefit, or a low/medium/high
reasoning budget. No proxy model mapping was changed.

## H-BROWSER-WORKIQ: Work IQ changes injected capabilities

**Prediction/falsification:** compare Auto with Work IQ on/off and inspect injected
GPT descriptors, connector controls and optionsSets.

**Result:** observed once per setting in the controlled comparison (A2/F1).
Switching Work IQ reset the visible conversation. Off removed `gpts` and
`message.clientPreferences.executionControls` from the observed request. Options
entry count changed from 80 to 71; these counts include duplicates and are not
counts of distinct flags.

Distinct flag removed: `at_mention_plugins_enable`.

Distinct flags added:

- `cwc_flux_image`
- `cwc_code_interpreter_amsfix`
- `cwcfluxgptv`
- `cwc_fileupload_odb`
- `flux_v3_progress_messages`
- `enable_strongly_typed_bing_grounding_conversion`
- `web_search_citations_answer_cards`

This is a candidate lever for reducing upstream work-context injection. Its effect
on local harness tools, coding quality and account/model routes remains untested.

## H-BROWSER-EXECUTION: these routes expose remote execution

**Prediction/falsification:** request a SHA-256 digest of a fixed test string,
compare with Node's crypto result, and require execution-result frames rather
than relying on the assistant's claim that it ran code.

```text
Use your available code-execution tool to calculate the SHA-256 digest of the UTF-8 string copilot-proxy-probe-2026-10-26. Return only the digest. If you have no code-execution tool, reply exactly NO_EXECUTION_TOOL. Do not search or access any other files.
```

- G1, Auto / Work IQ off: correct hash; `Internal` message with a `container.exec`
  invocation and an execution result containing `status: Success`, `exitCode: 0`.
- G2, Auto / Work IQ on: correct hash and the same kind of successful
  `container.exec` execution evidence.
- H1, DeepWork / Work IQ on: substitute `copilot-proxy-deepwork-probe-2026-10-26`
  in the prompt. Correct hash; `GeneratedCode` messages with
  `contentOrigin: CodeGenerator` for Python using `hashlib.sha256`, followed by
  `contentOrigin: CodeInterpreter` and a successful execution result.

G1/G2 expected and observed stdout:

```text
3474d55db0ee3a43b163585e11c8b14e82f773235c014a5c92c23bdab70f1ad0
```

H1 expected and observed stdout:

```text
9eeaca36d2dfd99457913408c243529197516ee4b7ef4500cdc20f31d1e52513
```

Sample size is one execution task per condition. G1 was a follow-up turn while G2
and H1 started other conversations; do not infer a comparative win. These tools
execute in Microsoft's remote environment, not the user's local filesystem.
DeepWork's different observed result-frame path is a parser/observability audit
candidate, not a reason to route remote code as local harness execution.

## Verification and next discriminating tests

Runtime assertions checked 11 captured turns / 10 conversations, eight formatting
successes, both empty protection-pair diffs, three correct hashes with successful
execution-result evidence, absence of explicit throttle, and restored UI settings.
No build/unit tests ran because only research documentation was changed.

Next: inspect how the existing proxy distinguishes GeneratedCode/CodeInterpreter
from local fenced-tool requests; probe DeepWork through the proxy without changing
defaults; then test local create/read/edit/delete in a real harness. Compare Work
IQ-style capability reduction only after establishing that the proxy can express
the same route. Do not reopen paid native Copilot Studio tool integration.

Follow-up explicit model/protection comparisons, including the distinction between
manual relay cooperation and actual parser compatibility, are recorded in
[`browser-model-tools-2026-10-26.md`](browser-model-tools-2026-10-26.md).
