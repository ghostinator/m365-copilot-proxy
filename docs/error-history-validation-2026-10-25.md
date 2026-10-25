# Persistent error diagnostics validation — 2026-10-25

> Publication note: host names, addresses and local paths are anonymized; validation counts and outcomes are unchanged.
Version 0.6.1 replaces the dashboard error panel's logger-only view with saved HTTP/application failures and cancellations. Existing logger summaries remain separate.

- Windows and Ubuntu/WSL: 470 unit tests passed, 6 live tests skipped. Four new tests cover detailed SSE failures, restart, independent filtered error paging, v1 database migration and redaction.
- Installed Nitro runtime on Windows and Linux: fake-backend success, streamed throttle, reconnect and cancellation scenarios passed. Malformed JSON and oversized requests appear in saved error history with diagnostic reasons. Outbound Microsoft traffic is disabled by the fixture.
- Portable Windows release: 912 hashes verified, isolated CLI/runtime tested outside the repository in a path containing spaces.
- Production database backed up consistently with SQLite backup API before deployment; backup integrity check passed (152 records at backup). The idle proxy stopped gracefully and v0.6.1 started at the same Tailnet address with existing credentials and optional incoming authentication.
- Live dashboard: ready on PID 15816; 156 saved records, 13 existing failures, no storage error. Earlier failed records display with an explicit indication that the detailed reason was not previously recorded. Browser verified corrected labels: build-agent, Production host / example-app (prod), Development laptop / example-app (dev), and This device. No automatic Microsoft model tests were run by the agent.

See `activity-database.md` for schema v2, bounded diagnostics and redaction details.
