# History management validation — 2026-10-25

Version 0.11.0 leaves database schema 5 and unlimited retention intact.

- Full Windows and WSL Ubuntu suites: 507 passed, six live tests skipped each.
- Offline installed-runtime tests passed on Windows and Linux: full JSON/CSV
  downloads ignore page limits, one-use links reject replay, online backup verifies,
  active restore refuses, and a real detached restart preserves state. After stopping,
  explicit CLI restore preserves config/keys and creates a verified safety backup.
  The CLI startup maintenance interlock also refuses to start with a restore lock.
- Unit export probe: 126 matching records over several 50-row batches, with 20
  requests added after snapshot creation; exactly the original matching rows were
  exported once. Fixed range time and insertion-sequence ceiling exclude new arrivals.
- Concurrent-write backup probe checks that copied request, timing and rollup counts
  agree. Deliberately corrupted backup files fail checksum verification.
- Restore tests retain newer history in a safety backup, preserve configuration and
  refuse a recorded live instance. No production restore was performed.
- Browser preview created/verified a snapshot of 424 synthetic requests and nine
  reports, displayed explicit stopped-host restore instructions, then downloaded
  all 424 unique requests while the saved page showed only 20. No console errors.
- Exports use allowlisted metadata, diagnostic redaction, spreadsheet-formula
  protection, bounded reads, backpressure, expiry, cancellation and a ten-minute
  deadline. One-use URLs are excluded from recorded request activity. Application
  keys remain optional; expensive exports/backups require the separate operator grant.

All chat traffic in these probes used temporary offline MSAL/WebSocket fixtures
with outbound HTTP disabled. Actual Microsoft quota, production history restore,
reboot/soak, multi-gigabyte databases and automated crash recovery were not tested.
Integrity checks have a 30-second worker deadline; large data needs separate testing.

Source remains on feat/unified-activity-operations; the draft PR branch is unchanged.
