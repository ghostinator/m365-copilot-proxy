# Activity storage

Version 0.7.0 (schema 3) uses Node 24's built-in SQLite: no native addon or separate server.
`activity.sqlite` lives with existing private account state; credentials are not
copied into it. `request-sources.json` is a preserved migration input.

## Data and queries

- `requests`: append-only, UUID encoded as 16 bytes with a unique index; IPs are
  normalized through `systems`. Methods, endpoints and outcomes use integer codes.
  Only allowlisted metadata is accepted. Requested/served model and normalized
  client-product hints remain visible without storing arbitrary headers.
- `hourly`: aggregate counts/bytes/duration by UTC hour, system, requested/served
  model and client product. Time-window queries sum complete hour buckets and
  scan only the two partial edge hours for exact millisecond cutoffs.
- `system_totals`: transactional all-time aggregates over those dimensions;
  all-time summaries do not scan every request or hour.
- `legacy_totals`: undated remainder of the old JSON counters after subtracting
  imported detailed records. Included only in all-time views, with a UI notice.
- `model_checks`: append-only explicit capability/identity reports. The listing
  selects the newest report per model and check kind; previous reports remain stored.
- `request_errors`: sparse bounded diagnostics for failed/cancelled requests,
  joined by request UUID; older request rows can have no detail.
- `metadata`: schema version, collection start and atomic migration marker.

Indexes cover time, system/time and model/time. Queries use bound parameters and
fixed SQL identifiers. Table results are capped/paged, not database retention.
Storage counters include SQLite data, WAL and shared-memory files. Small datasets
have substantial fixed allocation overhead, so current bytes/row is observational.

## Durability and limits

WAL with FULL synchronization commits each batch atomically, alongside its
aggregates. The default 1,000-page automatic checkpoint reuses WAL space. Disk
retention is unlimited. The 500-ms/100-record pending batch is flushed before
reads and shutdown; abrupt termination can lose an uncommitted pending batch.
Storage failures retain up to 10,000 pending records and surface errors/unsaved or
lost counts. This buffer protects process memory during outages, not retention.

Import and migration marker share one transaction. IDs prevent replay double
counting, the source JSON is not modified, and malformed legacy data is reported
while new collection continues. Schema versions newer than this binary are
refused instead of reset. A corrupt SQLite database is never silently replaced.

Use SQLite's online backup API, or stop the service before copying its database.
Never treat the main file alone as a complete live backup while a WAL exists.
The WAL and checkpoint design follows [SQLite's documentation](https://www.sqlite.org/wal.html).

## Validation

`pnpm test` covers boundaries, retention, migration, filtering and controls.
`node scripts/test-installed-runtime.mjs` exercises built-server storage and model
checks with an offline fake backend. `node scripts/activity-db-bench.mjs` creates
10,000 synthetic requests in temporary storage and reports measured file/query
costs without signing in or contacting Microsoft.

## Error history (0.6.1)

Schema version 2 adds a sparse `request_errors` table keyed by the existing binary request UUID and a partial time index for failed/cancelled requests. Existing request rows and rollups remain unchanged. The migration is additive and idempotent; earlier failures remain queryable with an explicit missing-detail indication.

Each new failure stores a bounded, redacted error type, message (12,000 characters), optional upstream code and stack (16,000 characters), failure phase, queue/first-byte timings, and upstream attempt/failure counts. HTTP and application statuses, requested/served model, client IP/software, bytes and duration join from the request row. SSE application errors are retained even when HTTP status is 200. Client disconnects are included. Normal response bodies are never collected; native HTTP error response capture is capped at 16 KiB. Validation diagnostics include issue paths/codes rather than submitted values. Authorization strings, common secret assignments, JWTs, API keys and URL credentials/queries are redacted on a best-effort basis.

The Recent errors panel reads persisted failures independently of internal logger summaries, with 20/50/100-row paging (`errorOffset`, `errorLimit`) and the selected range, client and model filters. Internal operational summaries remain separately available. Failures occurring entirely inside a client, before reaching this proxy, cannot be observed here. Unknown request paths remain masked; supported protocol routes are retained.

## Capability reports (0.7.0)

Schema version 3 adds `kind`, `verdict`, `evidence` and `turns` to `model_checks`, with an index on `(model,kind,seq DESC)`. The additive transaction preserves old identities as `identity` / `unknown` reports; old HTTP success alone is not retroactively treated as a passed capability test. Latest results are returned independently per model and check; earlier rows remain stored indefinitely. Explicit synthetic test evidence is retained, separately from normal chat content.
