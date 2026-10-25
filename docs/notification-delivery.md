# Notification delivery roadmap

Requested October 25, 2026. **Current implementation: local dashboard alerts only.**
No SMTP, Postal, SendGrid, Twilio, Teams, Slack or other outbound destination is
configured or implemented yet. The proxy's existing alert engine persists incidents,
acknowledgement and recovery; the new optional metrics endpoint supports separate
monitoring systems. Monitoring and metrics remain opt-in, with application keys
optional. No real notification or test message has been sent.

## Planned provider order

1. **SMTP + generic HTTP webhooks**, with Teams Workflows and Slack payload adapters.
   SMTP covers existing mail servers; generic webhooks cover automation platforms
   without writing a new transport for each destination. Teams should target the
   currently documented Workflows flow rather than depend on retiring connectors.
2. **Postal HTTP API and SendGrid v3 Mail Send** for direct email delivery. These
   are independent choices alongside SMTP, not additional required services.
3. **Twilio SMS/WhatsApp** for urgent phone delivery, separately opt-in because
   sender provisioning, templates, country restrictions and cost vary by channel.
4. **ntfy** for lightweight self-hosted/hosted push, plus consideration of Gotify,
   Discord, Telegram, Pushover and PagerDuty according to actual demand.
5. **Prometheus Alertmanager integration/examples** for sites already operating a
   monitoring stack. Its receivers cover SMTP, Slack and generic webhooks, and an
   external monitor can detect a stopped proxy that cannot report its own outage.

SMTP plus generic webhooks are the recommended first implementation scope. The
direct provider APIs above remain explicit backlog items, not advertised features.

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
- [SendGrid Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Teams incoming webhooks / Workflows](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
- [Teams connector retirement guidance](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
- [Slack incoming webhooks](https://api.slack.com/messaging/webhooks)
- [ntfy publishing](https://docs.ntfy.sh/publish/)
- [Alertmanager notification integrations](https://prometheus.io/docs/alerting/latest/integrations/)

Provider-specific requests, authentication and limits must be checked against the
current primary docs when implementing each adapter. No delivery adapters are
bundled in version 0.14.0.
