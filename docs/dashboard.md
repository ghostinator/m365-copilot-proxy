# Dashboard guide

Open `http://127.0.0.1:4141/dashboard` after starting the proxy, or use the host and
port you configured. The dashboard is served by the proxy itself. It requires no
separate web server or database installation.

If you configured a proxy API key, enter it under **Settings → Connection**. The
key stays in page memory; reloading clears it. Keyless operation is supported on
every bind address. See [configuration and access](operations.md#configuration-and-security).

## Tabs and filters

| Tab | Contents |
| --- | --- |
| Overview | Listener/version/PID/instance identity, readiness, token expiry, uptime, current-process HTTP/chat counters, saved summaries, performance charts, database size, observed budgets and fallback route. |
| Requests | One scrollable live/saved request list with 20/50/100-row saved pages, pinned live/queued requests, application-key and request-type filters, and expandable inspectors. |
| Clients | Most active connection IPs, configured labels, this-device identification and requested/served-model usage by client software and named application keys. |
| Models | Registered identifiers, selected-model capability tests, latest evidence, paged history and per-check sample summaries. |
| Errors | Persistent failed/cancelled requests with expandable diagnostics, plus separate internal operational summaries. |
| Settings | Optional API-key connection form, named-key inventory/management instructions and CLI recovery/startup instructions. |

**Time range**, **Model** and **System** apply to saved summaries, client/model
tables, saved requests and errors. Ranges are rolling 24 hours, 7/30/90/365 days or
all time. Current-process counters remain instance-wide and reset at restart; saved data persists. Model test selections
are independent of these filters. Tabs preserve filter selections, support
arrow/Home/End navigation and can be linked directly, for example
`/dashboard#models` and `/dashboard#errors`.

The page refreshes every five seconds while visible. Polling the dashboard does
not create activity records or start Microsoft chats. **Run local checks** sends
only sequential health/model-list GETs, labeled self-checks; listener inspection
and readiness do not prove that any upstream model will answer.

## Clients and history

Sources come from the connection socket; forwarded-IP headers are ignored. A
shared reverse proxy or gateway appears as one system. Software is inferred from
recognized User-Agent products, not treated as an authenticated identity. Local
interface addresses are labeled **This device**. Add friendly `sourceLabels` in
`server.json` and restart; see [source configuration](operations.md#local-dashboard-and-client-setup).

Client and model/client rankings show the top 50 combinations for the filters.
That display limit does not limit storage. SQLite retains request and error
records indefinitely. The database-size display includes WAL/shared-memory files;
bytes per row include allocation/index overhead and are not a growth forecast.
See [storage, migration and backups](activity-database.md).

## Run a selected capability check

1. Open **Models** and select one or more model rows.
2. Select the checks to run. Only **Model identity** is checked initially.
3. Click **Test selected models**. A selection alone never starts a request.
4. Read each model's **Latest checks / served route** and **Evidence / identity**
   columns. Scroll inside the table for more models.

| Check / API `kind` | Turns | Pass criterion |
| --- | --- | --- |
| Model identity / `identity` | 1 | A nonempty identity reply is **reported**, not verified. The model is asked not to guess. |
| Function tool call / `function-tool` | 1 | Exactly one `proxy_probe` call with valid ID/name and the exact synthetic argument. Prose alone fails. |
| Shell tool call / `shell-tool` | 1 | Exactly one `bash` call with the specified fixed command as its argument. The command is inspected, never executed. |
| Tool result round trip / `tool-roundtrip` | 2 | A valid shell call, then an exact fresh receipt read from a synthetic tool result, without another call. |
| Streaming / `streaming` | 1 | Valid nonempty OpenAI-style SSE content and a `[DONE]` marker, without an application error. Extra wording is not a streaming failure. |
| JSON output / `json` | 1 | A strict JSON object with exactly the requested fields and values; Markdown fences fail. This tests prompted output, not native schema enforcement. |
| System instruction following / `instructions` | 1 | The exact system-specified token despite a conflicting user instruction. |
| Multi-turn recall / `multi-turn` | 2 | Exact recall of a synthetic token from the prior turn in the same conversation. |

Tests run sequentially, with a 30-second cooldown between checks and a four-minute
deadline per check. Two-turn checks reuse one conversation. Existing upstream
retries/fallbacks can add attempts and quota use. The server rejects checks while
another request/check is active. Throttling, busy/authentication and unavailable
responses stop the browser batch. **Stop after current test** prevents the next
check; it allows the active check to finish.

The dashboard never executes model-generated commands, writes model-generated
files or connects a returned tool call to a real shell. These are synthetic
compatibility checks, not a pi/OpenClaw coding benchmark.

## Where results are stored and shown

Each model row shows its latest result **for each check type**, independently:
verdict, HTTP status, actual served route, timestamp, duration and turn count.
The evidence column explains the result or contains the unverified identity.
The latest-per-model table is followed by **Model test history**, with 20/50/100-report pages, check-type selection, and summary pass/fail/error counts. Expand a report for evidence, served route, duration, turns and the previous stored verdict/route (which may precede the selected window). Identity/unknown reports are counted separately from graded samples. The pass-rate denominator includes passed, failed and error samples; reported/unknown samples are excluded. History follows time/model filters, but not System: reports are not attributed to clients. Browsing history never sends a test.

Verdicts are **passed**, **failed**, **error** or **reported**. A request can return
HTTP 200 while a capability check is **failed**: the request completed but its
reply did not meet the check. HTTP/application failures also appear under
**Errors**. Old identity reports without a capability verdict are **unknown**.

Requested model ID, served/fallback model ID and a model's self-description are
different observations. Registered aliases and context/output hints do not prove
availability, entitlement, actual model version or measured context limits.
One passing sample does not establish reliability. Use the
[model routing reference](../README.md#available-models),
[prompting findings](prompt-engineering.md) and real harness validation before
changing model/framing defaults.

The explicit endpoint is `POST /v1/proxy/model-check` with
`{"model":"claude-sonnet","kind":"function-tool"}`. Omitting `kind` requests
identity for compatibility. It shares the normal optional-key/origin policy;
status polling never invokes it.

## Errors and troubleshooting

Expand a row in **Errors** for request ID, source/software, method/endpoint,
requested/served model, HTTP and application statuses, outcome, stream mode,
duration, queue/first-byte timings, body bytes, upstream attempts/failures,
failure phase/type/code/reason and a stack when available. It includes errors
inside HTTP-200 SSE streams and client disconnects (499).

Earlier stored failures remain visible but may lack detailed reasons. Unknown
paths/models are masked. A client-side failure before reaching this proxy cannot
be recorded here. Compare `X-M365-Proxy-Instance`, `X-M365-Proxy-Version` and
`X-M365-Request-Id` with Overview when traffic appears missing. Check filters and
the exact client base URL; two listeners on different addresses can be separate
processes. See [logging](logging.md) for local files and diagnostic limits.

## Screenshots

The [README gallery](../README.md#dashboard-screenshots) uses synthetic data, not
live account/client telemetry. To refresh it, follow [the capture guide](screenshots.md).

## Performance charts and request inspection (0.8.0)

**Overview → Chat performance** charts request volume, success percentage, mean
response duration, mean first HTTP body byte, or mean queue time. The global
range/model/system filters apply. Up to 48 intervals include empty gaps; expand
**Chart data and time buckets** for exact numbers and bucket start times. Hover a
bar for its value. Headline response p50/p95 use exact nearest-rank samples;
first-byte/queue means show their own sample counts. Empty samples stay unknown,
including timing data that older versions did not save. First HTTP body byte is
not necessarily the first model token. Completed application chat requests include
errors and cancellations; health/model-list polls and manual model tests are excluded.
Success describes transport/application completion, not answer correctness.

**Requests → expand a row** in the unified request list,
shows request ID, client/software, statuses, requested/served models, stream mode,
bytes, duration, queue/first-byte times, attempts/failures and an observed timeline.
New requests retain phase offsets and per-attempt served routes across restart.
A fallback or retry is visible through upstream attempts rather than inferred from
unobserved protocol events. Timelines are capped at 128 points per request and
explicitly flag truncation while retaining the final point. Older requests show
missing timelines/timings rather than invented zero values. Saved failure reasons
and stacks appear where recorded. Prompts, normal replies and tool arguments are
not added to request storage. Expanded inspectors remain open across polling.

The status API adds `sources.performance` and `sources.checkHistory`.
`checkKind`, `checkOffset`, `checkLimit` select check history independently of
request/error page controls. Limits are 1–100; invalid selectors return HTTP 400.

## Unified requests and application identity (0.9.0)

The former Recent requests and Saved request history panels are merged. Completed
requests appear once in the saved page; active requests are pinned above it until
completion, with phase, elapsed time and queue counts. One scrollable box contains
both. Paging (20/50/100) applies to saved rows so active traffic cannot skip saved
rows between pages. Expand an entry for its timing/timeline inspector. Existing
expanded rows remain open across polling. Live requests remain tracked even after
more than 100 other requests have passed through the recent buffer. Operator
cancellation controls remain planned; no cancel button is shown yet.

**Show** filters the entire stored history by chat, error/cancellation or explicit
self-check, rather than filtering just a recent buffer or one page. **Application
key** filters the same list by named key or keyless/unattributed traffic. These two
filters apply to request and error lists/groups, while global time/model/system filters also
apply to summary charts, error history and client tables. Keyless and old records
cannot be reliably assigned to an application retroactively.

**Clients → Applications by API key** lists completed requests by key label,
requested/served model and connected-system counts under the global filters.
**Settings → Application API keys** lists labels, IDs and active/revoked status;
stored digests and existing tokens are omitted. Authorized creation displays its new token once. See [application keys](api-keys.md).


## Management and troubleshooting (0.10.0)

See [dashboard management](dashboard-operations.md) for operator grants, key actions, error groups, category/UUID filters, page exports and service controls.


## History management (0.11.0)

[History management](history-management.md) covers full-history JSON/CSV exports, private online backups, integrity/checksum verification, explicit stopped-host restore, safety backups and maintenance recovery. Retention remains unlimited.

## Observed model reliability (0.12.0)

Open **Models → Observed model reliability**. Saved completed application chats
are grouped by requested model and final proxy-observed served route. Unknown routes
stay unknown; a fallback has its own row. This identifier does not verify the
upstream model version. Manual model-test reports remain in Model test history.

The time, model, system and Requests-tab application selectors apply. Request type,
error category, request UUID and check type do not apply: error-only filters would
bias success rates. No chat, login, quota probe or notification is triggered.

Each route shows total, success, error and cancellation counts, observed success
rate, mean response duration and exact nearest-rank p95 (including failures and
cancellations). HTTP-200 streamed application errors count as errors. Success means
no recorded proxy/application error, not answer quality or correct tool use.
Cancellations count in the rate denominator and are also shown separately.
Rates under 20 samples are marked limited; this is a visibility label, not a
statistical significance test. Workloads, accounts and routes can change between
periods. No improvement/regression verdict is inferred from percentage changes.

Rolling ranges compare `(now - window, now]` with the immediately preceding equal
window. Delta is percentage points, unknown if either period has zero samples.
Previous-only routes show zero current samples. All time includes timestamped
history through now and has no previous comparison; aggregate-only legacy imports
are excluded. Future-dated requests are excluded. Ranges use request arrival time.

The scrollable table shows the first 100 route pairs by current volume, then combined
volume and identifiers; coverage is shown explicitly. Headline totals and the
0–100% chart include **all** matching routes. Expand interval data for exact counts;
there are at most 48 intervals, with empty gaps represented as no sample rather
than zero-percent success. SQL aggregates the records without loading raw requests
into a JavaScript array. All-time analysis still requires database scans/sorts;
large-history performance needs separate profiling. Data retention stays unlimited.

The status API adds `sources.reliability`: `current`, `previous`, `from`, `to`,
`previousFrom`, `routes`, `routeCount`, `routeLimit`, `bucketMs` and `buckets`.
Dates are epoch milliseconds, rates fractions, changes percentage points. All
rates and missing timings are null when unobserved. Saved storage and schema are
unchanged; the view is recomputed from requests, not persisted duplicate aggregates.

## Opt-in alert center (0.13.0)

Monitoring starts **disabled**. Unlock operator access in Settings, review
**Opt-in alerts**, enable monitoring and apply settings. Overview shows a banner;
**Errors → Alert center** lists active incidents and saved lifecycle events. Unlock
management to acknowledge an incident or page through older events (20 per page).
Acknowledgement marks that exact incident as seen; it neither resolves the cause
nor silences a future recurrence. Regular status access can read the latest 20
events. Application API keys remain optional and do not grant management rights.

The standalone server evaluates every 30 seconds even with the dashboard closed.
Embedders created with createApp do the same; closing the app stops the monitor.
Default createApp instances use in-memory alert state; the standalone server persists it.
This reads local observations only: no model tests, auth refresh, chat, email,
webhook or OS/browser notification. All rules are proxy-wide and deliberately
ignore dashboard filters. Monitoring cannot report its own stopped/crashed process
or a fatal startup authentication failure; external monitoring is separate work.

Defaults are a rolling five-minute arrival-time window, at least ten completed
application chats, five errors and 50% errors, continuously observed for 60 seconds.
Throttling requires the same minimum volume and throttled-request count, without
the percentage threshold. Cancellations count toward sample volume but not errors.
HTTP-200 SSE failures count as errors; model-list polls, manual capability tests,
future timestamps and aggregate-only legacy records are excluded. The common
sustain time also applies to authentication-required and activity-storage failures.
The latter includes unsaved/lost activity. A pending timer resets if a condition
clears or observations become unknown; unknown does not resolve an active incident.
Auth starting is unknown, not auth failure or recovery. Evaluation timing means
opening can be up to one 30-second interval after the configured sustain time.

Thresholds: window 1–60 minutes; samples/errors 1–10,000 (errors must not exceed
minimum samples); error percentage 1–100; sustain 30–3,600 seconds. Applying settings
closes existing incidents as reset/disabled and starts fresh pending timers.
Conditions that persist can open again after the new sustain interval. No automatic
retry, key-mode change, login, model test, cancellation or other remediation occurs.

Alert settings, active incidents, acknowledgement and lifecycle events persist in
private **alerts.sqlite**, separate from activity.sqlite. Pending sustain timers
restart after process restart. One active incident per rule is updated in place;
only opening, acknowledgement, recovery and configuration closure append events.
Event retention is unlimited; lists are paged. Events contain fixed rule messages
and numeric counts, not prompts, responses, client IPs or credentials. The view
uses bounded reads; traffic scans are bounded to the selected rolling window.
A failure of the alert store itself is reported as monitor-unavailable in status
and the dashboard, not silently treated as healthy.

**History backups/restores do not include or roll back alerts.sqlite.** Combined
operational backup and off-host notifications remain queued. Acknowledged incidents
are re-evaluated after restart and remain active until observed recovery or settings
change. No repeated event is appended merely because a condition persists.

The status API adds `alerts` (settings, active, latest events, total/offset/limit,
checkedAt, error, running, intervalSeconds and retention). Operator actions
`alerts-configure`, `alerts-acknowledge` and `alerts-history` use the existing host
issued, origin-bound grant. Invalid settings/unknown fields fail validation before
mutation. Event paging uses offsets, newest insertion first; new events may shift
pages. IDs protect acknowledgements against stale controls targeting a recurrence.

## Storage planning and metrics (0.14.0)

Overview → Storage planning shows logical activity size, sample coverage, shared
filesystem capacity and estimated daily/30-day/yearly growth. Settings → Prometheus
metrics reports opt-in endpoint state and host setup. Neither panel probes models
or changes retention. See [observability](observability.md) for exact formulas,
minimum samples, metric semantics and scraping configuration.

The dashboard now uses up to 1720 CSS pixels on wide displays. Reliability column
headings and longer route/rate cells wrap; narrow displays retain horizontal table
scrolling. External notification provider choices are tracked in
[notification delivery](notification-delivery.md), separately from local alerts.
