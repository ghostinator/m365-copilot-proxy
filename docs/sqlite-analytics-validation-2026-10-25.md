# SQLite analytics, client labels and model tests — October 25, 2026

Version 0.6.0. Source feature commit 5a858b6; UI clarification bec018a.

- Windows and WSL Ubuntu each passed 466 unit tests; six live tests skipped.
- Built-server fixtures passed success/streaming, throttling, reconnect,
  cancellation, socket attribution, SQLite persistence/integrity, range queries,
  pagination validation and explicit model checking/cooldown. Fixture outbound
  HTTP is disabled; no model identity conclusion comes from these tests.
- Browser exercise against an isolated fake backend: select one model, click
  Test selected models, see HTTP 200, served route and fixed fixture identity.
  Time/model filters produced the expected summary and client breakdown.
- A dry migration of the actual legacy history copied into temporary storage
  preserved all 116 request totals and 116 timestamped records; undated remainder
  zero. The source JSON remained byte-for-byte unchanged. Configured labels and
  local-device identification were correct.
- Synthetic Windows 10,000-row sample: 3,379,200 committed bytes including indexes
  and hourly aggregates, 1,252 ms ingestion; 24-hour query 6.35 ms, all-time 2.06 ms.
  Ubuntu: same file size, 935 ms ingestion, 7.53 ms/1.61 ms respectively. These are
  individual samples, not guarantees. Run scripts/activity-db-bench.mjs.

Retention is unlimited. Individual requests and model-test reports are not pruned.
Raw chat prompts, normal replies, tool arguments and headers are excluded. Only
explicit fixed-prompt identity tests retain a bounded self-reported response.
Live tests run only when selected from the dashboard; no deployment model sweep
is authorized or automatically triggered. Incoming API keys remain optional and
none is configured on the existing Tailscale endpoint.