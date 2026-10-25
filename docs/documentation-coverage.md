# Documentation coverage — 0.7.0

Reviewed against the implementation and the recorded validation on October 25, 2026.

| Feature | User documentation | Implementation / evidence |
| --- | --- | --- |
| Six tabs, shared filters, keyboard/deep-link navigation | README, dashboard.md | dashboard-ui.ts; dashboard tests |
| Recent/saved request pagination and lifecycle metrics | dashboard.md, operations.md | http-activity.ts; request-sources tests |
| Client IPs, labels, local-device detection and software/model breakdown | dashboard.md, operations.md | activity-schema.ts; activity-database.ts |
| Rolling windows, unlimited retention, compact SQLite and backup/migration | activity-database.md, operations.md | SQLite tests; sqlite-analytics validation |
| HTTP/SSE/cancelled failures, verbose diagnostics and internal summaries | logging.md, dashboard.md | error-diagnostics tests; error-history validation |
| Eight opt-in checks, exact grading and independent result columns | dashboard.md, operations.md | model-probes tests; dashboard-capabilities validation |
| Requested/served/self-reported model distinctions, aliases/hints and observed budgets | README, dashboard.md, operations.md | registry, model checks and usage-observations |
| Debug/trace/frame settings, rotation and privacy limits | logging.md, README | core/log.ts; operator-errors tests |
| CLI setup/login/doctor/diagnostics and client config generation | operations.md, README | CLI; installed-runtime and client tests |
| Portable archives, manifests and Windows sign-in startup/update/rollback | operations.md, README | release verification; Windows validation scripts |
| Screenshots and repeatable offline capture | README gallery, screenshots.md | docs-screenshots-server.mjs; six captured PNGs |
| Remaining tray/Linux installer/update-manager scope | roadmap.md | Explicitly unchecked rather than advertised as implemented |

The source feature version is 0.7.0. Documentation/screenshots do not imply an npm
publication, a new upstream release, or measured live capability for every model.
Screenshots use isolated synthetic data. Host-specific details in local validation
reports were anonymized for publication; measurement counts/outcomes remain intact.

Verification: 477 unit tests passed, 6 live tests skipped after documentation/test
example updates; local Markdown targets and all six gallery files were checked.
The existing Windows/Linux and installed-package validation records remain linked
from the roadmap. Production configuration, credentials and runtime were not
changed for documentation capture.

## Analytics additions (0.8.0)

- Performance charts, exact percentiles and sample semantics: dashboard.md and activity-database.md;
  implementation activity-insights.ts, tests activity-insights.test.ts.
- Persistent request timing/timelines, legacy missing data and inspector controls:
  dashboard.md and activity-database.md; http-activity.ts / activity-database.ts / dashboard-insights.ts.
- Paged model-check history, previous samples/routes and graded denominators:
  dashboard.md; activity-insights.ts / dashboard-insights.ts; offline database and UI tests.
- Follow-on feature list and implementation priorities: roadmap.md sections 6–7.

## Unified requests and application keys (0.9.0)

- Full-history type/key paging and pinned live rows: dashboard.md / dashboard-requests.ts.
- Named key creation, modes, hot reload, revocation, labels and one-time tokens:
  api-keys.md / api-keys.ts / cli.mjs; api-keys.test.ts and installed-runtime fixtures.
- Application/model/route usage and normalized schema-5 migration: api-keys.md /
  activity-database.md; migration/restart/filter tests in api-keys.test.ts.
- Live rows surviving recent-buffer eviction: http-activity.test.ts; queue display
  and merged-list paging: dashboard.test.ts. Cancellation controls remain queued.


## Dashboard operations (0.10.0)

[Dashboard management](dashboard-operations.md) covers operator grants, one-time key creation, grouped errors, combined filters, scoped exports, sign-in startup and restart/recovery limits.


## History management (0.11.0)

[History management](history-management.md) covers full-history JSON/CSV exports, private online backups, integrity/checksum verification, explicit stopped-host restore, safety backups and maintenance recovery. Retention remains unlimited.
