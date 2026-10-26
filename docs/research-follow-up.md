# Model and tool research follow-up — October 26, 2026

Evidence: [initial browser settings study](browser-settings-2026-10-26.md) and
[model/tool comparison with parser correction](browser-model-tools-2026-10-26.md).
The later [offline parser boundary probe](parser-boundaries-2026-10-26.md) adds
18 synthetic cases and source-confirmed type-conversion concerns without live quota.
Implementation and live results: [research verification](research-verification-2026-10-26.md).
Checked items below mean the bounded investigation was run and its outcome recorded,
not that every model/account/client combination is certified. Protection off
did not improve measured cooperation; remote CRUD did not establish local access.
Historical real-pi results remain scoped to their original routes and conditions.
Run live checks sequentially with cooldowns and stop on quota/transport trouble.

Subsequent client integration: [API adapters and strict tool contracts](client-api-adapters.md)
and the [offline native Pi pack](client-test-pack.md). The earlier 404 observation
below describes the def9700 baseline; the new implementation adds those routes
explicitly. Scripted conformance evidence does not replace the live checks here.

## Priorities and pass criteria

1. [x] **Real local-client CRUD with the shipped contract.** Generate instructions
   from the actual tool schemas and validate replies with the actual parser. Use a
   disposable local directory and fresh nonce; independently verify create/read/
   edit/delete and cleanup through pi/OpenClaw. Pass requires correct parsed
   arguments and real filesystem changes, not a fence or manually repaired path.
   First verify the client's wire protocol: the [bare fetch-app check](handler-contract-2026-10-26.md)
   returned 404 for Responses/Messages endpoints. A compatible client mode or
   adapter is a separate prerequisite, not a model setting.
   **Verified:** one real Pi → rebuilt Nitro → included Sonnet session used actual
   read/write/edit/bash tools; independent nonce/file/deletion checks and cleanup passed.
2. [x] **Offline parser boundary checks.** Exercise body versus header parameters,
   arrays/objects, multi-line edits, Unicode/spaced Windows paths, and truncated or
   large outputs. Pass requires exact argument preservation and no unintended calls.
   The custom `path:` probe was a design mismatch, not an established product bug.
   Initial 18-case investigation is complete: typed bodies and inline object headers
   remained strings, and truncated JSON could become an array of strings. Assess
   those separate compatibility concerns with regression coverage and a client
   validation check. Preserve the intentionally rejected unclosed-fence case.
   The original handler probe exposed six incompatible JSON/SSE responses. A local
   shared-parser fix and eleven regressions now pass; the rebuilt probe reports
   zero incompatible responses out of twelve. Full unit run: 625 passed, six skipped,
   with bounded worker count/timeouts. Details and qualifications are in the verification report.
3. [x] **Remote-execution telemetry and cancellation.** Audit CodeInterpreter,
   GeneratedCode and BashExecutor result shapes using sanitized fixtures. Confirm
   remote results stay distinct from local tool success. Test a client abort and
   reconnect for cleanup and conversation continuity; do not substitute StreamHub
   Stop frames for Chathub without a route-specific probe.
   The initial 192 selected offline parser/transport/streaming tests alone did not
   complete native-result fixture coverage or real-account cancellation/reconnect.
   **Follow-up:** four sanitized native-result fixtures pass. Nine live core turns
   confirmed Stop and same-conversation recovery in normal/temporary sessions. A
   discovered duplicated-preview bug now has a failing-before/passing-after transport
   regression and a successful live repeat. A rebuilt Nitro HTTP stream was then
   disconnected after its first content character: Stop/acknowledgement and
   subsequent exact recovery with full client history passed. The tracing header
   alone does not resume a conversation; the report records the corrected test.
4. [x] **Context isolation and repeated comparisons.** Use fresh nonces per cell,
   verify conversation IDs, and compare normal/temporary chats with Work IQ as a
   separate condition. Pass requires controlled measurements, not an assistant's
   claim about memory. Repeat/rotate promising arms before inferring a model win.
   **Verified within sample:** four Auto browser cells crossed normal/temporary
   with Work IQ on/off, all distinct conversation IDs, 8/8 exact repeated recalls.
   Four cross-conversation queries returned UNKNOWN (one preliminary Chat query).
   The proxy separately passed four exact reconnect recalls and two cross-chat
   negative controls. No model winner or universal privacy guarantee is inferred.
5. [x] **DeepWork through the actual proxy route.** Confirm accepted tone, account
   entitlement, metering and tool loop before exposing a model ID or changing a
   default. A browser label and remote interpreter are not sufficient. A separate
   reasoning-effort control remains unobserved, not implemented or ruled out.
   **Bounded feasibility verified:** invented tone rejected; literal DeepWork
   accepted through the rebuilt handler/session/Chathub using a test-only wire
   substitution, included scenario, no agent. A real local read/result loop passed
   in two successful turns; metering was absent in both final items. This establishes
   this account's observed route, not universal entitlement, a pricing promise or a
   model identity. No public ID/default is added from one task.

The corrected-format GPT browser probe stalled and was cancelled; it remains
inconclusive; later proxy checks are separate evidence, not a repaired browser result.
These probes are manual investigations, not an enabled monitor or permission to run
concurrent/budget-consuming sweeps automatically. Runnable
probe guidance lives in [experiments.md](experiments.md); product feature work
remains in the existing [roadmap](roadmap.md).
