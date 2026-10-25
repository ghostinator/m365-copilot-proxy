# Dashboard management and troubleshooting (0.10.0)

## Unlock management

On the proxy host, run `m365-proxy operator authorize`. Paste the generated token
in **Settings → Operator access**. The grant expires 15 minutes after generation;
issuing a new one invalidates the previous grant. Only a SHA-256 digest and expiry
are stored in private `operator-access.json`. Treat the grant as a management
credential: it permits application-key and service changes.

Application keys never authorize management. Operator commands require an exact
same-origin POST with the separate `X-M365-Operator` header, even with keyless
application access. Application CORS allowlists do not widen this origin policy.
The browser holds the grant only in memory. Reload, Lock management or Forget key
clears it, along with any newly displayed application token. Expired grants are
rejected on every command, not merely hidden by a browser timer.

## Application keys

After unlocking, create a key with an application label, copy its token to the
client and dismiss it. A new token appears once; existing tokens and stored hashes
cannot be retrieved. Select an active key to rename it or acknowledge and revoke
it. Changes affect new requests. Historical labels remain unchanged.

Creating keys preserves the access mode. Keys remain optional by default.
Revocation in optional mode removes attribution but does not prevent keyless
access. Required/optional mode changes remain explicit local CLI commands; the
dashboard does not turn on required mode. See [application keys](api-keys.md).

## Troubleshooting and exports

Combine Requests' application key, error category and exact request UUID with the
global time/model/system filters. Error category and UUID apply to saved requests;
pending requests have no final error category. Clear the filters to restore the
full view. The Requests controls also filter Errors' list and groups. Global charts
and client totals continue to use only time/model/system filters.

Errors groups the top 50 recorded type/code combinations across all matching
history, showing frequency, distinct systems/models and last occurrence. Categories
are inferred from observed error types/statuses, not confirmed root causes. HTTP-200
SSE errors use their recorded application status. Unknown failures remain unknown.

**Export saved page · JSON** downloads the displayed saved page, up to 100 rows.
It excludes live rows, normal prompts/replies, headers, credentials and arbitrary
fields. Metadata and error diagnostics pass through an additional redaction step.
IP addresses, labels and recorded failure text are included: review before sharing.
This is a scoped page export, not a full-history export or database backup.

## Service controls

Settings inspects the current user's Windows sign-in task. Enable start at my
sign-in installs/updates that task to the current launcher; Disable sign-in startup
preserves the running process. This uses the existing Windows login and M365 state,
not a pre-login system service. Changes are explicit operator actions.

Restart pauses admission of new chats/model tests with retryable 503 responses,
then waits for admitted chats/tests. If work remains after two minutes, restart
cancels and admission resumes. Otherwise a detached helper waits for the old PID
and nonce record to disappear before starting the same launcher/data directory
under the watchdog. History flushes during normal shutdown. The dashboard reconnects.
If replacement startup fails, inspect `service-logs` and `restart-error.log` locally.

Linux supports restart through the standalone launcher; Windows sign-in task
configuration is platform-specific. Embedders have no service adapter by default.
A stopped server cannot serve its dashboard: use `m365-proxy service start` or
`m365-proxy serve` on the host. Authentication recovery still uses local
`m365-proxy login`. No action runs model tests or interactive login automatically.

## Validation

`node scripts/test-operator-runtime.mjs` tests grants, key mutations and a real
detached restart using isolated offline MSAL/WebSocket fixtures. Outbound HTTP is
disabled in the proxy and its replacement. `scripts/test-windows-service.ps1`
exercises a uniquely named temporary task and fake HTTP server. Unit tests cover
expiry, origin enforcement, drain timeout, late-response token clearing, filtered
full-history grouping and export allowlisting/redaction. No live Microsoft quota
is used. Actual sign-out/reboot and long-running soak checks remain host validation.


## Observed model reliability (0.12.0)

Models now opens with saved chat outcomes grouped by requested/served route: sample
counts, success/error/cancellation rates, mean and p95 latency, previous equal-length
period comparisons and up to 48 chart intervals. Time/model/system/application
filters apply; error-only and request UUID controls do not bias the rates. No probes
or notifications run automatically. Keys stay optional and retention unlimited.
Empty periods stay unknown, and small sample labels do not claim significance.

## Opt-in background alerts (0.13.0)

Unlock management, review Settings → Opt-in alerts and explicitly enable monitoring.
Defaults: five-minute window, ten completed chats, five errors, 50% error rate,
60-second sustain. Throttling uses the minimum volume/count without the percentage
threshold; auth-required/storage failures use the same sustain timer. Check Errors
→ Alert center for current incidents and paged events. Acknowledgement marks an
incident as seen without suppressing a later recurrence. Settings changes close
existing incidents and restart pending timers. All application keys remain optional.

Evaluation runs locally every 30 seconds while the proxy runs, independently of
browser polling and filters. No automatic model probes, auth refresh, remediation
or external notifications. A stopped/crashed proxy cannot report its own outage.
Settings/incidents/events use private alerts.sqlite with unlimited retention;
activity history backups do not include this separate state. Pending sustain timers
restart after process restart. Unknown observations do not imply recovery. If the
alert store fails, status explicitly reports monitor-unavailable.

## Notification delivery (0.17.0)

Operator access now manages named SMTP, Postal, SendGrid, ntfy and generic/Slack/Teams webhook destinations.
Saving/replacing always disables the destination and sends nothing. Preview before
explicit enablement or confirmed test. Credentials and endpoint/recipient settings
are private, stored without at-rest encryption, and never read back by the dashboard.
A separate notifications.sqlite retains the durable queue and delivery history;
activity backups do not include it. See [notification-delivery.md](notification-delivery.md) for complete setup,
lease/retry behavior, acknowledged-incident cancellation and remote acceptance limits.
No production destination or model probe is configured automatically.

## Screenshots

Synthetic data, isolated preview; no production credentials or model claims.

![Request filters and page export](images/dashboard-troubleshooting.jpg)

![Grouped errors](images/dashboard-error-groups.jpg)
