# Storage planning and Prometheus metrics (0.14.0)

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
disk-exhaustion forecast. No storage alert, quota or retention limit is enabled.
Capacity can be unknown if the OS cannot report it. Queries read aggregate counts,
indexed time ranges and SQLite page metadata; they do not load raw history records.

The status API adds `sources.storage.growth`. Values use bytes, milliseconds, request
counts and daily rates; missing estimates/capacity are null. Activity/alert schemas
and existing backup formats are unchanged. History backup/restore does not include
the separate alert database or server settings.

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

Placeholder: capture Overview → Storage planning with sample coverage, logical size,
filesystem availability and estimated growth visible. Capture Settings → Prometheus
metrics showing enabled/disabled status. Use synthetic data; never include tokens.
