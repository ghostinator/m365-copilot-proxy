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
The current source feature set is version 0.18.0. Source availability and portable
builds are separate from npm publication; this fork does not claim a published
0.18.0 npm package. See [the README](../README.md) for current source/setup links.

## 6. Analytics and diagnostic tools — current implementation priority

Requested October 25, 2026. Keys remain optional; model checks are manually
requested, serialized and quota-consuming. No automatic capability sweeps.

- [x] Performance charts (0.8.0): filtered request volume, success/error/cancellation rates,
  response p50/p95, first-byte and queue latency, with honest sample counts.
- [x] Request inspector (0.8.0): durable metadata and observed timeline for queueing,
  upstream attempts, fallback, streaming and final outcome; mark older missing data.
- [x] Model test history (0.8.0): paged reports, per-kind pass/fail/error counts, evidence,
  served routes and comparison with previous samples. No reliability claim from n=1.

## 7. Follow-on operations features — queued after analytics

- [x] Unified live/saved request list, elapsed times and queued-request visibility (0.9.0);
  active requests survive recent-buffer eviction and upstream turns remain serialized.
- [ ] Operator cancellation controls for active/waiting requests.
- [x] Error grouping by observed category/type/code, frequency and affected clients/models (0.10.0), separating
  authentication, throttling, transport and model failures.
- [ ] Dashboard settings editor: source labels, aliases, fallbacks, listener and
  optional keys; validate and preview changes with explicit apply/restart behavior.
- [ ] Service controls and Windows tray: start/stop/restart, health and sign-in recovery
  (continues section 1).
- [ ] Managed updates with release notes, staging, draining, readiness and rollback
  (continues section 4).
- [x] Consistent online SQLite backups, restore verification and CSV/JSON exports (0.11.0).
- [x] Storage growth planning estimates and filesystem capacity; unlimited retention, no automatic deletion (0.14.0).
- [x] Opt-in background in-dashboard alerts for sustained failures, auth, throttling and storage errors (0.13.0).
- [x] Optional Prometheus metrics with fixed bounded labels; detailed client data stays in SQLite (0.14.0).
- [ ] Client profiles: separate default models, usage summaries and fair queue
  priorities for production, development and agent clients.
- [ ] Linux systemd installer parity (continues section 5).

## 8. Named application API keys (0.9.0)

- [x] Create/list/rename/revoke multiple named keys through local CLI commands.
- [x] Optional attribution without forcing keys; explicit required mode; preserve legacy key.
- [x] Only SHA-256 digests on disk; display generated tokens once, never in dashboard/history.
- [x] Apply key changes to subsequent requests without restarting.
- [x] Persist application identity/label in normalized SQLite records; key/model/route usage.
- [x] Filter the unified request list by application key across the entire saved history.
- [x] Keep follow-on work on a separate branch; do not modify the existing draft PR.


## 9. Dashboard operations (0.10.0)

- [x] Host-issued expiring operator unlock, separate from optional application keys.
- [x] Dashboard key create/name/rename/revoke with one-time new-token display.
- [x] Application/system/model/type/category/UUID filters and full-history error groups.
- [x] Redacted JSON export of the current saved request page.
- [x] Windows sign-in task status, enable/disable without stopping active work.
- [x] Drain-before-restart, bounded wait/cancellation and detached same-version handoff.
- [x] Full-history streaming JSON/CSV exports and verified online backup/restore preparation (0.11.0).
- [ ] Retention controls; requests and backups remain unlimited with no automatic deletion.
- [x] Model reliability trends from saved application traffic (0.12.0).
- [x] Optional sustained-failure alert center, saved incidents and acknowledgement (0.13.0).

Tray status, interactive sign-in recovery, Linux systemd setup and versioned updates
with rollback remain separate work. A stopped proxy is started from the host CLI.


## 10. History management (0.11.0)

- [x] Full filtered JSON/CSV downloads with fixed sequence boundary and bounded reads.
- [x] One-use expiring download capabilities; no raw keys in URLs or activity logs.
- [x] CSV formula protection, additional diagnostic redaction and explicit export scope.
- [x] Online SQLite backups with private checksums/manifests and worker integrity checks.
- [x] Paged backup inventory and dashboard verification/restore preparation.
- [x] Explicit stopped-host CLI restore, staged validation, safety backup and startup interlock.
- [ ] Download backup files / encrypted off-host destinations, scheduled backups and automated crash recovery.
- [ ] Configurable retention remains queued.

## 11. Observed model reliability (0.12.0)

- [x] Requested/served route outcomes, sample counts, mean and exact p95 response time.
- [x] Adjacent equal-length rolling-period comparisons; no comparison for All time.
- [x] Up to 48 time intervals, empty samples unknown, separate cancellations and SSE errors.
- [x] Time/model/system/application filters; bounded 100-route table, complete totals.
- [x] Offline evidence only; browsing sends no tests, keys stay optional, schema stays 5.
- [x] Opt-in sustained-failure alerts (0.13.0); no external notifications or automatic probes enabled.

## 12. Opt-in alert center (0.13.0)

- [x] Background 30-second evaluation, independent of dashboard polling/filters.
- [x] Configurable sustained traffic failures, throttling, auth recovery and storage rules.
- [x] Host-authorized settings/acknowledgement, disabled by default, no external destinations.
- [x] Separate private SQLite incident/event store, unlimited retention and paged history.
- [x] Deduplicated incidents, acknowledgement, recovery and recurrence across restarts.
- [x] Optional external notification delivery (0.15.0+).
- [ ] Per-model rules and process-outage monitoring.
- [ ] Combined backup/restore of alert state (history backups cover activity only).

## 13. Storage planning and optional metrics (0.14.0)

- [x] Logical density and observed-rate growth estimates, with minimum sample/coverage rules.
- [x] Shared filesystem availability, separate physical WAL/database usage; no deletion.
- [x] Opt-in Prometheus endpoint, config/environment enablement and existing optional-key policy.
- [x] Fixed counter/gauge/histogram labels; no client/model/key identifiers or request text.
- [x] Scrape exclusion, explicit unavailable history, restart counter semantics and setup guide.
- [ ] Measured historical growth series, backup/alert/log footprint inventory and low-capacity alerts.

## 14. Notification delivery (0.17.0)

See [provider scope and delivery design](notification-delivery.md). Current alerts
support optional configured SMTP/Postal/SendGrid/ntfy/webhook delivery; only local fake receivers and mocked provider responses were used in validation. No production destination has been configured or sent to.

- [x] Multiple named destinations, per-rule routing, preview and explicit send-test.
- [x] SMTP and generic HTTP webhook transports.
- [x] Teams Workflows and Slack webhook payload adapters.
- [x] Postal HTTP API and SendGrid v3 email adapters (0.16.0).
- [x] ntfy push (0.17.0).
- [ ] Evaluate Gotify, Discord, Telegram, Pushover and PagerDuty as needed.
- [x] Durable queue, bounded retry/backoff, deduplication and delivery/error history.
- [x] Private credential configuration with metadata-only views and no read-back.
- [ ] Combined operational-state backups/encryption.
- [ ] Alertmanager setup/examples and external whole-process outage detection.


## 15. Remote administrator sign-in (0.18.0)

- [x] Dashboard administrator password after one-time host-authorized setup.
- [x] Salted scrypt hash, bounded login work and exact-origin checks.
- [x] Separate 12-hour sessions, password rotation, logout and global revocation.
- [x] Portable Windows command launcher using bundled Node, no development shell.
- [ ] Optional trusted-browser persistence and additional administrator identities.
