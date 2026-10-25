# Dashboard analytics validation — October 25, 2026

Source version 0.8.0 implements roadmap section 6: performance charts, request
inspectors and model-check history. Remaining requested features are queued in
section 7. Incoming proxy API keys remain optional, and model checks remain
explicitly requested and sequential.

## Evidence

- Windows: 484 unit tests passed, six live tests skipped. Final chart-scale/UI
  follow-up: 13 targeted tests passed.
- Ubuntu/WSL: 484 passed, six skipped, using two workers. Dependencies installed
  with the frozen lockfile; build and installed-runtime fixtures passed.
- Built Windows runtime and final portable runtime: offline startup, optional-key/
  origin policy, success, streamed throttle, reconnect, cancellation, persistent
  storage and isolated client configuration fixtures passed.
- Portable runtime: all 912 manifest file hashes verified; no account state bundled.
- Six new database tests cover exact percentiles/buckets/filters, schema-3 migration,
  restart, retry/fallback/stream timings, bounded timelines and history comparisons.
- Browser preview: metric changes, visible scale/date range, request expansion,
  phase timestamps, check-kind history filters and expanded synthetic evidence
  verified. No browser console errors observed. Screenshots in images/ use only
  synthetic fixture data; no real capability score is claimed.
- One 10,000-row synthetic benchmark: 2,313 ms ingest, 3,813,376 committed bytes,
  381.34 bytes/record including indexes/rollups. Filtered full status queries took
  4.75–66.14 ms; all-time was 31.91 ms. Exact quantiles scan/sort selected samples,
  so these timings do not establish million-row performance.

## Deployment boundary

A consistent SQLite backup of the existing instance passed integrity_check before
activation was attempted. Automatic approval review blocked the live restart
command; the existing 0.7.0 process was not changed. The tested 0.8.0 portable build
is ready, but live activation and schema-4 production migration remain pending.
No Microsoft chat or capability sweep was sent by the agent for this work.

Schema 4 is additive and retains previous rows and reports. Older binaries reject
newer schema versions; returning to 0.7 requires a compatible pre-upgrade database
backup, not merely replacing executable files. New request metadata has no prompts,
normal replies or tool arguments. Old missing timing/timeline samples remain unknown.
