import nodemailer from "nodemailer";
import type { DeliveryMessage, NotificationConfig } from "./notification-schema.js";

export class DeliveryFailure extends Error {
  constructor(readonly category: string, readonly retryable: boolean) { super(category); }
}
export function webhookPayload(config: Extract<NotificationConfig, { type: "webhook" }>, message: DeliveryMessage) {
  if (config.format === "slack") return { text: message.text };
  if (config.format === "teams") return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null,
    content: { type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text: message.text, wrap: true }] } }] };
  return message;
}
/** No redirects, no remote response bodies in diagnostics, no chat-path dependency. */
export async function sendNotification(config: NotificationConfig, message: DeliveryMessage): Promise<void> {
  if (config.type === "webhook") {
    try {
      const response = await fetch(config.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-M365-Delivery-Id": message.deliveryId, ...(config.bearer ? { Authorization: "Bearer " + config.bearer } : {}) },
        body: JSON.stringify(webhookPayload(config, message)) });
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new DeliveryFailure("webhook_http_" + response.status, [408, 425, 429].includes(response.status) || response.status >= 500);
      return;
    } catch (error) { if (error instanceof DeliveryFailure) throw error; throw new DeliveryFailure("webhook_network_or_timeout", true); }
  }
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.security === "tls",
    requireTLS: config.security === "starttls", ignoreTLS: config.security === "local", tls: { rejectUnauthorized: true },
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000, dnsTimeout: 10_000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([transport.sendMail({ from: config.from, to: config.to, subject: message.subject, text: message.text,
      messageId: `<${message.deliveryId}@m365-proxy.local>` }), new Promise<never>((_, reject) => { timer = setTimeout(() => { transport.close(); reject(new DeliveryFailure("smtp_timeout", true)); }, 15_000); timer.unref(); })]);
    if (info.rejected?.length) throw new DeliveryFailure("smtp_partial_recipient_rejection", false);
  } catch (error) {
    if (error instanceof DeliveryFailure) throw error;
    const code = Number((error as { responseCode?: number })?.responseCode);
    throw new DeliveryFailure(Number.isInteger(code) && code >= 400 && code <= 599 ? "smtp_" + code : "smtp_network_or_tls", !code || code < 500);
  } finally { if (timer) clearTimeout(timer); transport.close(); }
}
