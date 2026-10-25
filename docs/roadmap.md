# Feature roadmap

Requested October 24, 2026. This list covers product features beyond the completed
service-readiness fixes. Checked entries indicate implemented and verified scope,
not completion of the entire feature group.

## 1. Local dashboard and tray controls — in progress

- [x] Browser dashboard: readiness, authentication expiry, uptime and admitted requests.
- [x] Display available models and known quota exhaustion without sending chat probes.
- [x] Recent sanitized error summaries, with bounded retention (20, in-memory, fixed categories).
- [x] HTTP and chat lifecycle activity: streaming/errors/cancellations, queue/response timing, body bytes, upstream attempts and request IDs (0.4.0).
- [x] Instance identity, detection of other local listeners, request filters and separate no-chat self-checks (0.4.0).
- [x] Persist request-source IPs, per-system rankings and bounded source history (0.5.0).
- [x] Scrollable recent requests with 20/50/100 page sizes and pagination (0.5.0).
- [x] Unlimited SQLite history, rolling summary windows, storage usage and JSON migration (0.6.0).
- [x] User-defined system labels, local-device identification and model/client breakdowns (0.6.0).
- [x] Explicit selected-model identity checks with persisted reports and sequential cooldown (0.6.0).
- [x] Persistent verbose HTTP/SSE errors, cancellation diagnostics and filtered error paging (0.6.1).
- [x] Six accessible tabs with shared filters and direct links (0.7.0).
- [x] Eight opt-in capability checks, exact grading, safe synthetic tool results and per-model/check evidence (0.7.0).
- [ ] Start/stop/restart and sign-in recovery controls with explicit local authorization.
- [ ] Optional Windows tray icon, including offline/stopped status.

## 2. Guided client setup — in progress

- [x] `client setup pi`: current model registry, proxy key and endpoint configuration.
- [x] Preserve other providers; validate before writing; private backup and dry-run.
- [x] Integrate existing OpenClaw config generator into the standalone CLI.
- [x] Export connection instructions for other OpenAI-compatible clients (`client info`).
- [ ] Optional end-to-end verification, clearly separated from quota-free setup.

## 3. Quota and routing visibility

- [x] Show last observed daily/weekly allowances, with observation timestamps.
- [x] Label unavailable, expired or unobserved allowances as unknown.
- [ ] Add an explicitly labeled estimate of the account turn budget.
- [x] Show known exhaustion/reset times and configured fallback models.
- [x] Explain the observed upstream model route when a fallback was used.
- [x] Persist observations safely across restarts, expiring stale information (account-scoped, six-hour/UTC-date expiry).

## 4. Update manager

- [ ] Discover published versions and show release notes without installing.
- [ ] Download and verify platform archives from an explicitly trusted source.
- [ ] Stage, validate, drain, switch and check readiness.
- [ ] Expose the existing rollback mechanism through the CLI.
- [ ] Preserve account state; recover the previous version after failed updates.
- [ ] Optional notifications; automatic installation remains opt-in.

## 5. Standard Linux service installer

- [ ] Generate/install a systemd user unit for the portable runtime.
- [ ] Start/stop/status/uninstall parity with Windows commands.
- [ ] Document user-session startup versus explicitly enabled lingering.
- [ ] Private environment/configuration and bounded journal/log behavior.
- [ ] Verify restart, auth-required behavior and graceful shutdown on Linux.

## Validation

- [x] WSL Ubuntu build, offline unit tests and installed-package tests (477 passed; 6 live tests skipped).
- [x] WSL Linux portable-release manifest/startup verification (baseline fixes).
- [ ] Actual-account sign-in/reboot and 24–72-hour soak (separate host checks).

Native MCP/Dataverse tool calling remains out of scope per AGENTS.md.

Evidence: [initial Linux validation](linux-validation-2026-10-24.md),
[SQLite analytics](sqlite-analytics-validation-2026-10-25.md),
[error diagnostics](error-history-validation-2026-10-25.md), and
[tabs/capability validation](dashboard-capabilities-validation-2026-10-25.md).
The current source feature set is version 0.7.0. Source availability and portable
builds are separate from npm publication; this fork does not claim a published
0.7.0 npm package. See [the README](../README.md) for current source/setup links.
