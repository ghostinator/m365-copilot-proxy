# Notification delivery (0.16.0)

Requested October 25, 2026. **Implemented: SMTP, Postal and SendGrid email APIs, plus generic/Slack/Teams
webhooks with a durable delivery queue.** No production destination is configured or enabled by
this change. Local fake receivers and mocked provider responses were used for validation.
Twilio messaging remains queued. Existing alerts and metrics
stay opt-in, and application keys stay optional.

## Configure from the dashboard

Unlock operator access in Settings, then open **Notification delivery**. At most
20 named destinations can be configured. Create a webhook, SMTP or email API destination,
choose the alert rules and opening/recovery events, then **Save disabled**. Saving
never sends or verifies a remote endpoint. A replacement requires all configuration
and credentials again, increments its revision, cancels queued work and disables it
for review. Removed destination IDs cannot be reused.

Select the saved destination and preview the fixed test message. Separately choose
**Enable future alerts** to route future selected events. The explicit test button
also requires enablement, previewing that selected destination, and its send-test
acknowledgement. It queues exactly one test request, with a one-minute per-destination
cooldown. It does not call Microsoft or run a model. Enabling alone does not send a
test or replay historical events. Production credentials/recipients must be supplied
by the operator; none is provisioned automatically.

The dashboard reads back names, transport/payload type, revision, enablement, routing
and a credential-present flag. It never reads back webhook URLs, bearer tokens,
Postal URLs, provider API keys, SMTP hosts, usernames, passwords or email addresses. These fields are cleared from
the page when saved/locked. Reload/expiry clears operator access. Locking the page
does not disable already-enabled server destinations. Use Disable to cancel queued
work, or Remove to scrub the active configuration while retaining delivery history.
Removal is not forensic secure erasure of old SQLite pages, WALs or backups.

### Webhooks

Generic JSON carries version, stable delivery ID, incident ID, fixed rule/event,
timestamp, subject and text. Slack uses a text payload; Teams uses an Adaptive Card
message envelope. Configure the appropriate Teams Workflows receiver on your tenant;
flows requiring authentication need a separately supplied usable bearer token.
OAuth token acquisition/refresh is not implemented. Tenant/flow authorization and
payload acceptance still need a controlled live test after setup.

HTTPS is the default. HTTP requires the explicit allow-HTTP checkbox and sends its
URL/body/bearer token without transport encryption. Operator-selected private-network
receivers are supported; this is not a destination-network allowlist. URLs may not
contain userinfo or fragments, and redirects are refused so credentials are not
forwarded. Optional bearer authentication is supported. Requests time out after
10 seconds. Remote response bodies are neither logged nor persisted.

### SMTP

Choose direct TLS (typically port 465) or required STARTTLS (typically 587). Server
certificates are verified; no certificate-bypass setting is exposed. A private CA
can be configured through Node's host environment. Provide both username/password
or neither. OAuth SMTP and provider account provisioning are separate work.
The optional unencrypted local-relay mode is restricted to literal 127.0.0.1, ::1
or localhost and disallows credentials. It is intended for a local relay/test sink.

Use a plain From address and one to five comma-separated To addresses; display-name
syntax and arbitrary headers/attachments are not accepted. Messages are plain text,
with a stable Message-ID across retries. SMTP delivery is capped at 15 seconds;
connection, greeting, socket and DNS operations have their own bounded timeouts.
Partial recipient rejection is a permanent failed result: some recipients may have
accepted the message, so the worker does not automatically retry that whole group.
Separate destinations per recipient make failures easier to isolate.

### Postal email API

Choose Postal, enter the server origin (for example `https://postal.example.com`),
its server API credential, an authorized plain From address and one to five To
addresses. Do not include a path/query in the origin. The adapter posts JSON to
`/api/v1/send/message` using `X-Server-API-Key` and `plain_body`. HTTP requires an
explicit allow-HTTP choice; it exposes the API key and message on the network.
Private server origins are supported and redirects are refused.

Postal returns application-level success/error inside its JSON response, including
HTTP 200. Only `status: "success"` counts as accepted. `status: "error"` fails
permanently as `postal_api_rejected`; inspect Postal's private server logs for the
actual reason. Response parsing is capped at 16 KiB and the overall request at ten
seconds. Missing, malformed, oversized or unknown-status responses get a bounded
retry as `postal_invalid_response`; remote acceptance may be ambiguous.

### SendGrid email API

Choose SendGrid, select Global or EU (requires an appropriate EU regional subuser),
provide a Mail Send API key, a verified plain From address and one to five To
addresses. The adapter uses the fixed HTTPS `api.sendgrid.com` or
`api.eu.sendgrid.com` endpoint `/v3/mail/send`, bearer authentication,
`personalizations` and a `text/plain` content body. Only HTTP 202 counts as accepted;
other successful HTTP statuses fail as `sendgrid_unexpected_response`. No custom
endpoint, templates, attachments, account provisioning or sender verification is
performed. The request times out after ten seconds.

Both adapters share the existing disabled-save/preview/enable/test workflow,
durable queue, bounded retries and metadata-only views. They send a stable
`X-M365-Delivery-Id` and Message-ID, but provider deduplication is not guaranteed.
Provider response bodies are never logged or stored; Postal's bounded status check
is used only in memory. No email credentials or recipients are provisioned by the
proxy. Application API keys remain optional and separate from provider credentials.

## Queue and incident behavior

The worker processes one send at a time, on a five-second schedule, independently
of chat requests and dashboard polling. It reads at most 50 new alert events per
cycle and commits queue entries without remote I/O inside database transactions.
Only recognized fixed rule messages and numeric evidence counts are forwarded;
client IPs, names, model responses, normal conversation text, arbitrary diagnostics
and credentials are not copied into notifications.

Each incident event/destination revision is queued once. Destination activation
captures the current alert-event sequence: older events are skipped for that
destination. Existing unchanged destinations retain queued work across restart.
Acknowledgement, recovery and settings reset/disable events cancel queued opening
deliveries/retries. A configured recovery notification can still be sent even if
the opening delivery was cancelled before acceptance. There are no reminder sends.
An in-flight send may finish after acknowledgement, disable, replacement or removal.

Attempts are capped at four, with delays of 30/120/600 seconds after retryable
failures, plus worker scheduling. HTTP 408/425/429/5xx and network/timeout failures
retry; other non-2xx responses fail permanently. SMTP 4xx/network failures retry;
5xx and partial recipient rejection fail permanently. Final failed deliveries are
visible in history; automatic unbounded replay/manual replay is not implemented.

A 60-second claim lease prevents ordinary concurrent workers from sending the same
job. An interrupted lease is recovered after expiry, preserving its delivery ID and
attempt count. A timeout/crash after remote acceptance can cause a duplicate on
retry; exactly-once delivery is not promised. Generic receivers can deduplicate on
the X-M365-Delivery-Id header/body field; SMTP uses the stable Message-ID. Slack and
Teams do not gain a deduplication guarantee from these IDs.

**Sent means webhook 2xx, SMTP acceptance, Postal application success or SendGrid 202**, not confirmed
inbox arrival, reading, or successful downstream Teams workflow execution. Delivery
history shows state, attempts, next retry and fixed redacted error categories. It
is paged 20 at a time; newly arriving jobs can shift offset pages. Retention is
unlimited and no automatic deletion occurs.

## Storage, access and limitations

Private **notifications.sqlite** stores destinations, credentials, cursor, queue
and delivery history. Files inherit the private user data directory on Windows;
Unix permissions are 0600/0700. Credentials are protected by file access, **not
encrypted at rest**. No SMTP/webhook/provider secret is returned in public status or operator
metadata. Public status exposes only aggregate counts and worker availability.
History backups/restores cover activity.sqlite, not this database or alerts.sqlite.
Combined operational backup/encryption remains planned. Do not replace alert event
history independently of its delivery cursor; a regressed event sequence is refused.

Monitoring and notification delivery require a running proxy. A stopped/crashed
proxy cannot notify about its own outage. A forced stop may interrupt a send;
durable leases recover on restart. Default createApp instances use in-memory state;
the standalone server persists it. Existing sign-in, listener, application-key mode,
retention and model-probe behavior are unchanged.

Operator actions are notifications-status/save/enable/remove/preview/test. Mutations
require the existing expiring host-issued, exact-origin grant. Test and removal
require explicit confirm:true; invalid/unknown fields fail boundary validation.
Operator commands remain capped at 4096 bytes, including credentials. File/URL
attachments are disabled in the SMTP library. Provider I/O is outside the chat path.

## Provider follow-ons

1. **Implemented: SMTP + generic HTTP webhooks**, with Teams Workflows and Slack payload adapters.
   SMTP covers existing mail servers; generic webhooks cover automation platforms
   without writing a new transport for each destination. Teams should target the
   currently documented Workflows flow rather than depend on retiring connectors.
2. **Implemented: Postal HTTP API and SendGrid v3 Mail Send** for direct email delivery. These
   are independent choices alongside SMTP, not additional required services.
3. **Twilio SMS/WhatsApp** for urgent phone delivery, separately opt-in because
   sender provisioning, templates, country restrictions and cost vary by channel.
4. **ntfy** for lightweight self-hosted/hosted push, plus consideration of Gotify,
   Discord, Telegram, Pushover and PagerDuty according to actual demand.
5. **Prometheus Alertmanager integration/examples** for sites already operating a
   monitoring stack. Its receivers cover SMTP, Slack and generic webhooks, and an
   external monitor can detect a stopped proxy that cannot report its own outage.

Twilio and the push adapters above remain backlog items. Postal and SendGrid can
also be configured through SMTP using operator-supplied settings.

## Shared delivery requirements

- Multiple named destinations; explicit per-rule/event routing and separate enablement.
- Provider credentials stored privately; metadata-only dashboard views, no read-back
  of tokens, SMTP passwords or webhook secrets. Preserve optional application keys.
- Preview rendered messages before applying; an explicit send-test action identifies
  the destination and content. Do not send anything merely by saving configuration.
- Deliver opening/recovery events once per incident/destination where possible;
  acknowledgement suppresses repeats according to an explicit documented policy.
- Durable delivery queue, bounded retries/backoff, rate limits, timeout handling,
  deduplication and visible failures/dead letters. Ambiguous network timeouts mean
  exactly-once delivery cannot be promised for every provider.
- Versioned destination configuration; do not replay old events to a newly enabled
  destination unless explicitly requested. Never run external I/O inside alert-store
  database transactions or block proxy chat traffic on notification delivery.
- Redacted payloads with fixed incident details/counts and links; no conversation
  text, client identities or arbitrary diagnostics by default.
- Validate destination URLs/SMTP configuration, use appropriate TLS verification,
  define redirect/private-network rules explicitly, and avoid logging credentials.
- Unlimited existing history retention remains unchanged. Combined backup of alert
  configuration/queue/credentials needs an explicit scoped design.
- Unit tests and local fake SMTP/HTTP servers first. Live provider tests require
  configured destinations and authorization for the actual messages/recipients.

## Primary references checked

- [Postal API](https://docs.postalserver.io/developer/api/)
- [Postal send-message request](https://apiv1.postalserver.io/controllers/send/message.html)
- [SendGrid Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Teams incoming webhooks / Workflows](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
- [Teams connector retirement guidance](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
- [Slack incoming webhooks](https://api.slack.com/messaging/webhooks)
- [ntfy publishing](https://docs.ntfy.sh/publish/)
- [Alertmanager notification integrations](https://prometheus.io/docs/alerting/latest/integrations/)

Provider-specific requests, authentication and limits must be checked against the
current primary docs when implementing each adapter. Version 0.16.0 adds Postal and SendGrid APIs
to the existing SMTP and generic/Slack/Teams transports.

## Screenshots

Capture Settings → Notification delivery with a synthetic disabled destination,
preview text and delivery history. Hide/clear URL, bearer, SMTP and email fields;
never publish real credentials or recipients. No live provider screenshot is claimed.
