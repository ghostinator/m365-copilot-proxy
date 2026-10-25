# README screenshot capture guide

The checked-in screenshots use the real dashboard UI with **synthetic data and
an offline backend**. They demonstrate layout and grading, not measured Microsoft
model availability or performance. No live model sweep is needed to refresh them.

After `pnpm install` and `pnpm build`, run:

```sh
node scripts/docs-screenshots-server.mjs
```

Open `http://127.0.0.1:44141/dashboard`. The helper creates temporary state and
loads explicit fake MSAL/WebSocket fixtures; outbound HTTP in the child proxy is
disabled. It never reads your production account directory. The helper stops
after ten minutes or when interrupted. Choose another port with `DOCS_PORT` if
needed. Keep the browser viewport consistent (roughly 1280 pixels wide).

Capture the following PNGs in `docs/images/`, replacing the existing files:

| File | What should be visible |
| --- | --- |
| `dashboard-overview.png` | Selected Overview tab, shared filters, monitored instance, readiness/counters, saved summaries, database size and observed sample budget/fallback information. |
| `dashboard-requests.png` | Selected Requests tab, scrollable recent and saved requests, row details, 20-row defaults and paging controls. |
| `dashboard-clients.png` | Selected Clients tab, generic build/production/development labels, connection IPs and model/client breakdown table. |
| `dashboard-models.png` | Selected Models tab, all eight check selectors, model checkboxes, latest per-check verdicts and synthetic evidence. Do not imply the sample verdicts are real model measurements. |
| `dashboard-errors.png` | Selected Errors tab, saved failures and one expanded synthetic diagnostic showing request ID, client/model/status/timing/reason. |
| `dashboard-settings.png` | Selected Settings tab, empty optional-key field and CLI recovery instructions. Never capture an entered key. |

Use full-page captures when needed to include the controls. Keep request lists
inside their scroll boxes; there is no need to expand the entire registered-model
identifier list. Check every image for real addresses, host/client names, account
identifiers, credentials, browser chrome and unrelated applications before
committing it. Production screenshots are unnecessary for this gallery.

## Analytics views (0.8.0)

- `images/dashboard-performance.jpg`: Overview with Chat performance, latency
  samples and a selected chart. Include the range, metric and scale labels.
- `images/dashboard-request-inspector.jpg`: Requests with one streamed offline
  fixture expanded, showing actual phase offsets and timing metadata.
- `images/dashboard-check-history.jpg`: Models with Model test history, check-kind
  filter and one expanded synthetic evidence report. Keep the demo evidence visible.

These JPEG captures supplement the original six-tab PNG gallery. Use the isolated
synthetic server above; do not capture production source IPs or error content.

## Unified requests and named keys (0.9.0)

- `images/dashboard-requests.jpg`: one merged list, application/type filters and
  expanded synthetic diagnostics; replaces the older two-list Requests PNG.
- `images/dashboard-clients.jpg`: global filters and named key/model/route usage
  across multiple synthetic applications.
- `images/dashboard-application-keys.jpg`: Settings inventory and optional-mode
  explanation, with no tokens or digests visible.

The preview fixture creates keys only in its isolated temporary directory and
seeds public example addresses/labels. Production keys are never created or captured.


Version 0.10.0 adds `dashboard-troubleshooting.jpg` and `dashboard-error-groups.jpg`: synthetic Requests filters/export and error groups. Tokens were dismissed and operator access locked before capture.

Version 0.11.0 adds `dashboard-history-backups.jpg` and `dashboard-history-export.jpg`: synthetic verified backup/recovery preview and an all-time download of 424 requests while the page displays only 20. No restore was applied from the browser.
