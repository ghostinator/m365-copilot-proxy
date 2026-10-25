# Storage planning and Prometheus metrics (updated 0.21.0)

## Storage planning

Overview → **Storage planning** shows available/shared filesystem capacity, logical
activity size, sample coverage and estimated daily/30-day/yearly activity growth.
It is independent of dashboard filters and never changes retention or deletes data.

The density is `(page_count - freelist_count) × page_size / saved requests`.
SQLite's logical page count includes committed WAL pages, without counting repeated
WAL writes as permanent growth. Reusable free pages are excluded. Existing physical
database/WAL/shared-memory totals remain separate. Density includes indexes, rollups,
model reports and schema overhead, so this is **not measured marginal bytes/request**.

The rate uses timestamped arrivals in `(now - 7 days, now]` divided by the smaller
of seven days and the age of the earliest stored non-future request. It counts all
saved request kinds, including polls and explicit checks. Aggregate-only legacy
totals do not establish dated coverage. At least 20 recent requests, 20 stored
requests and one hour of observed history are required. Otherwise estimates are
unknown. In-memory instances do not project disk growth. Empty samples are not zero
growth forecasts. Future-dated requests do not inflate the rate or coverage.

Daily growth multiplies that rate by current logical density; 30 days and 365 days
are fixed planning periods. Backups, alert history, logs, changing error detail,
model reports, page reuse, schema changes and other programs can change actual usage.
The filesystem is shared. The API's activity-only capacity-days estimate is not a
disk-exhaustion forecast. No low-capacity threshold, quota or retention limit is enabled by default.
Capacity can be unknown if the OS cannot report it. Queries read aggregate counts,
indexed time ranges and SQLite page metadata; they do not load raw history records.

The status API adds `sources.storage.growth`. Values use bytes, milliseconds, request
counts and daily rates; missing estimates/capacity are null. The storage-planning feature does not change activity schemas or backup formats.
Model alerts in 0.22.0 separately upgrade the alert store to schema 2. History backup/restore does not include
the separate alert database or server settings.

## File footprint and low-capacity alerts (0.21.0)

Overview → **Storage planning** now shows physical file lengths by category:

- **Activity:** activity.sqlite and its WAL/shared-memory/journal files.
- **Operations:** other root SQLite files, including alerts, notifications and backup scheduling, plus SQLite sidecars.
- **Backups:** regular files immediately inside history-backups, including manifests and partial copies.
- **Logs:** root files ending in .log or .log.N, including debug and redirected service logs.

This is a metadata-only inventory: no file contents, paths, names or credentials are
returned. It excludes links/junctions, other subdirectories (including frame dumps),
configuration/credential files, external log paths and unrelated files. It counts
file lengths rather than allocated blocks; compression, sparse files and hard links
can make this differ from physical disk consumption. Sizes can change during a scan.
Scans refresh at most every 30 seconds and stop after 2,000 directory entries or a
25 ms budget checked between filesystem operations. A slow OS operation can take
longer. Capped or inaccessible scans explicitly report a **partial lower bound**;
this total is not the size of the entire data directory or filesystem. Missing backup
directories count as empty. These measurements do not change retention or delete files.
The status API exposes this under `sources.storage.footprint`.

In Settings → **Opt-in alerts**, unlock administrator access, enable monitoring and
**Activity storage or low free space**, then set **Low free-space threshold (MiB)**.
For example, 2048 means alert when available space is below 2 GiB. **0 disables the
capacity check**, including when older saved settings omit the new field. The limit
is 1,048,576 MiB. Existing alerts are not enabled or reconfigured during upgrades.

Available space is measured for the proxy account on the shared data volume, including
consumption by other programs. Checks use the normal 30-second monitor and configured
sustain period. Low space and activity-save failures share the existing **storage**
incident and destination routing; evidence identifies the current reason. A capacity
reading at or above the threshold resolves a capacity incident only when activity
storage is healthy too. Missing/invalid capacity is unknown, never zero and never
an invented recovery. Capacity checking makes no M365 calls. Monitoring still depends
on the proxy and alert database being available: it cannot guarantee delivery after
the disk is already full. Keep the threshold above zero with enough headroom if used.

## Measured storage history (0.23.0)

Overview → **Measured storage history** adds a category chart and a table of the
latest 24 chart measurements. Choose 24 hours, 7/30/90/365 days or all time; this
range is independent of model/client/request filters. The page refreshes history
at most once a minute, with explicit Refresh available. API:
`GET /v1/proxy/storage-history?range=7d`, under the existing optional application-key
and origin policy. History reads do not count as application traffic or trigger scans.
Invalid or duplicate query parameters return 400; unavailable history returns 503
with a fixed diagnostic. The status API includes a compact `storageHistory` summary.

The standalone proxy automatically collects one numeric-only snapshot per **UTC
hour** after successful startup authentication, including an initial reading. It
continues with the dashboard closed and checks for a new hour once a minute. The
private **storage-history.sqlite** (schema 1) stores timestamp/hour, activity,
operations, backup and log file lengths, available/capacity bytes (nullable), and a
complete/partial flag. No filenames, paths, credentials, request/client/model IDs or
conversation content are stored. Retention is unlimited; there is no automatic deletion.
The collector does not query M365, attempt sign-in, create backups or change alerts.
In-memory embedded apps do not collect persistent history.

All hourly rows remain saved. For larger ranges, the read-only chart query returns
at most **240 points**, taking the last recorded reading in each fixed hour bucket;
this is not an average, maximum or deletion of earlier readings. The response reports
bucket width, total hourly readings and complete readings in the selected range.
The details table shows the latest 24 of those chart points, including partial rows.
The chart plots category/total lengths, not free space (shown in the table/current
capacity display). Single readings appear as dots. Lines break on partial readings
and gaps longer than one chart bucket. Long-range bucketing cannot show every gap
inside a bucket. The API retains each returned point's actual timestamp and quality.

Measured change compares the **first and last complete hourly readings** in the
range before chart downsampling. It can be negative: WAL checkpoints, external log
rotation/deletion and backup changes alter physical file lengths. It is neither the
logical-density forecast nor a filesystem exhaustion prediction. Scope and partial
scan limits match the footprint inventory above; a partial value is a lower bound
and never used as a complete trend measurement. Available/capacity bytes remain
unknown when the OS cannot report them. This store itself counts toward operations
storage; writes can influence the next sample.

Old measurements cannot be reconstructed: collection starts with 0.23.0, shutdown
periods stay missing and restart does not backfill them or duplicate the same hour.
Clock rollback does not write older slots and future-dated points are excluded from
range results. Unsupported/corrupt stores are preserved and reported unavailable,
never silently replaced. Collection errors are isolated from serving chats. Samples
are recorded only while running; this is not process-outage monitoring. Activity
backups exclude this database, as they exclude other operational stores.

## Enable optional metrics

Disabled by default. Add a Boolean property to the existing `server.json`, preserving
its other settings, then stop/start the proxy from the host:

```json
{ "metricsEnabled": true }
```

This is a property example, **not a replacement configuration file**. Alternatively
set `M365_METRICS=1` in the launch environment. Other values disable metrics. An
explicit environment value takes precedence over the file. Detached/dashboard
restarts inherit the existing process environment; use a fresh host stop/start
when changing file-based enablement. To disable, set the file property false and
remove/disable any environment override before a fresh start. Settings → Prometheus
metrics reports whether this process has the endpoint enabled. No browser scrape
or automatic enablement occurs.

Scrape **GET /v1/proxy/metrics**, Prometheus text format 0.0.4. Disabled returns 404
after the normal access gate. The existing origin and application-key policy applies;
keys stay optional. If you require application keys, configure a valid named bearer
key in the scraper. Metrics do not use the short-lived operator grant. Scrapes,
including rejected scrapes, do not increase activity/history or latency samples.
No Microsoft traffic, login, quota probe or model availability test is sent.

```yaml
scrape_configs:
  - job_name: m365_proxy
    metrics_path: /v1/proxy/metrics
    static_configs:
      - targets: ['proxy-host:4141']
    # Only if your proxy requires an application key:
    # authorization:
    #   type: Bearer
    #   credentials_file: /private/path/proxy-token
```

The exporter includes process HTTP/category/source counters, validated chat outcomes,
upstream attempts/retries/failures, in-flight requests, uptime and authentication
readiness. End-to-end HTTP duration is a cumulative histogram with fixed boundaries
0.1/0.5/1/5/15/30/60/120/300/+Inf seconds, plus sum/count. Duration and HTTP counters
include explicit checks; chat outcomes include manually requested model checks.
Application errors inside HTTP-200 streams count as unsuccessful outcomes, as do
cancellations. These metrics do not grade answer/tool correctness. Process counters
and histogram samples reset on restart. Use rates/increases, not differences that
assume counters survive process replacement.

```promql
histogram_quantile(0.95,
  sum by (le) (rate(m365_proxy_http_duration_seconds_bucket[5m])))
```

Stored request totals, physical activity-file components, logical size, filesystem
availability and estimated daily growth are gauges. Unknown growth/capacity/storage
values are omitted, not emitted as fictional zeroes. `history_available` explicitly
reports save/read/loss errors; unsaved/lost record gauges remain visible. Fixed-rule
alert gauges report enabled state, monitor availability and active incidents.
Acknowledgement does not resolve an incident.

Names begin `m365_proxy_`. Label names are bounded to `kind`, `source`, `outcome`,
`le`, `component` and `rule`, each with a fixed set of constant values. No model IDs,
client addresses, application labels, key IDs/tokens, request IDs, error messages,
prompts, answers, process paths or account details are serialized. Detailed client
and model breakdowns remain in SQLite/dashboard history. Token usage/cost metrics
remain unknown and are not invented. Storage collection avoids the full dashboard's
history/percentile/report queries. Backups/alerts/log size is not part of the
activity-file size metric; filesystem free space includes all users of the volume.

## Screenshots

Placeholder: capture Overview → Storage planning with the file-category breakdown, sample coverage, logical size,
filesystem availability and estimated growth visible. Add a capture of Measured storage history after at least two complete readings, with the selected time range and details table visible. Capture Settings → Prometheus
metrics showing enabled/disabled status. Use synthetic data; never include tokens.
