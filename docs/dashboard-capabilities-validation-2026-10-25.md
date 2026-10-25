# Dashboard tabs and capability checks — 2026-10-25

Version 0.7.0 is deployed on the existing Tailnet listener. Source commits: b1e5ec5 (tabs/probes), 559c9f8 (streaming grading).

## Validation

- Windows: 477 unit tests passed, 6 live tests skipped. Ubuntu/WSL: 477 passed, 6 skipped with two workers. An earlier fully parallel Linux run hit the existing agent-preservation test's 5-second module-loading timeout under build load; the bounded-worker rerun passed without changing that test or its timeout.
- Final streaming grading and tab-fragment regression: 11 targeted tests passed on both Windows and Linux. Streaming requires valid nonempty SSE content and DONE with no application error; exact wording is measured separately by the instruction check.
- Installed Nitro runtime passed offline success, streamed throttling, reconnect and cancellation checks on both platforms. A function-tool check against the plain-prose fixture correctly returns HTTP 200 / verdict failed. Local status polling starts no model checks.
- Final portable release verified 912 file hashes and passed isolated CLI/runtime checks outside the repository in a path containing spaces. Runtime: `release/m365-proxy-0.7.0-win32-x64-1792935873756`.
- Browser preview verified tabs, shared client filtering, saved errors and an explicitly selected function-tool check against the offline backend. That check failed correctly because the fixture emitted prose rather than a tool call. Tool commands were never executed.
- Fixed fragment collisions that caused Models to jump to the registered-ID list; tab selection now stays at the page top. Tabs support keyboard navigation and preserve shared filters.

## Live deployment

The previous proxy was idle and stopped gracefully. SQLite was backed up using its backup API before the additive v3 migration. The live v0.7.0 process is PID 16752 at `100.102.206.65:4141`; readiness is ready and incoming API-key authentication remains optional.

All 190 pre-upgrade request IDs and all 12 prior model reports were preserved. The live database passed integrity_check at schema version 3; it had 191 requests at verification, no storage error, and 17 saved failures (four with new detailed diagnostics; earlier records explicitly lack details). The new process had zero chat checks at verification: the agent sent no Microsoft capability test or model sweep. The live UI exposes eight checks and defaults to identity only, with no model selected and the run button disabled.

Client labels verified: pueblo-agent (`100.67.127.67`), debiandev / ai-hedge-fund-crypto (prod) (`100.119.206.22`), MacBook Pro / ai-hedge-fund-crypto (dev) (`100.96.238.91`). This device remains identified from its local interfaces.

Screenshots are in the ignored release directory: `dashboard-tabs-0.7.0-live.png` and `dashboard-model-tests-0.7.0-live.png`. The temporary offline preview was closed after validation. No claim about any real model's capability is inferred from these synthetic tests; users can run selected checks explicitly from Models.
