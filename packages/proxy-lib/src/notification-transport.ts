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
  if (config.type === "webhook" || config.type === "ntfy") {
    const ntfy = config.type === "ntfy", category = config.type;
    const url = ntfy ? new URL("/" + config.topic, config.url).href : config.url;
    try {
      const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": ntfy ? "text/plain; charset=utf-8" : "application/json", "X-M365-Delivery-Id": message.deliveryId, ...(ntfy ? { Title: message.subject } : {}), ...(config.bearer ? { Authorization: "Bearer " + config.bearer } : {}) },
        body: ntfy ? message.text : JSON.stringify(webhookPayload(config, message)) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new DeliveryFailure(category + "_http_" + response.status, [408, 425, 429].includes(response.status) || response.status >= 500);
      }
      if (ntfy) {
        const payload = await readProviderJson(response, "ntfy");
        if (!payload || typeof payload !== "object" || !("event" in payload) || payload.event !== "message"
          || !("topic" in payload) || payload.topic !== config.topic || !("id" in payload)
          || typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.id)) throw new DeliveryFailure("ntfy_invalid_response", true);
      } else await response.body?.cancel().catch(() => {});
      return;
    } catch (error) { if (error instanceof DeliveryFailure) throw error; throw new DeliveryFailure(category + "_network_or_timeout", true); }
  }
  if (config.type === "postal" || config.type === "sendgrid") return sendEmailApi(config, message);
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

/** Bound response parsing without retaining remote diagnostic content. */
async function readProviderJson(response: Response, category: string): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new DeliveryFailure(category + "_invalid_response", true);
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_384) throw new DeliveryFailure(category + "_invalid_response", true);
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new DeliveryFailure(category + "_invalid_response", true); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Postal reports application errors inside HTTP 200. */
async function postalAccepted(response: Response): Promise<void> {
  const payload = await readProviderJson(response, "postal");
  const status = payload && typeof payload === "object" && "status" in payload ? payload.status : null;
  if (status === "error") throw new DeliveryFailure("postal_api_rejected", false);
  if (status !== "success") throw new DeliveryFailure("postal_invalid_response", true);
}

async function sendEmailApi(config: Extract<NotificationConfig, { type: "postal" | "sendgrid" }>, message: DeliveryMessage): Promise<void> {
  const postal = config.type === "postal";
  const url = postal ? new URL("/api/v1/send/message", config.url).href
    : "https://" + (config.region === "eu" ? "api.eu.sendgrid.com" : "api.sendgrid.com") + "/v3/mail/send";
  const headers = { "Content-Type": "application/json", "X-M365-Delivery-Id": message.deliveryId,
    ...(postal ? { "X-Server-API-Key": config.apiKey } : { Authorization: "Bearer " + config.apiKey }) };
  const mailHeaders = { "X-M365-Delivery-Id": message.deliveryId, "Message-ID": `<${message.deliveryId}@m365-proxy.local>` };
  const body = postal ? { from: config.from, to: config.to, subject: message.subject, plain_body: message.text, headers: mailHeaders }
    : { from: { email: config.from }, personalizations: [{ to: config.to.map(email => ({ email })) }],
      subject: message.subject, content: [{ type: "text/plain", value: message.text }], headers: mailHeaders };
  try {
    const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers, body: JSON.stringify(body) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new DeliveryFailure(config.type + "_http_" + response.status, [408, 425, 429].includes(response.status) || response.status >= 500);
    }
    if (postal) await postalAccepted(response);
    else {
      await response.body?.cancel().catch(() => {});
      if (response.status !== 202) throw new DeliveryFailure("sendgrid_unexpected_response", false);
    }
  } catch (error) {
    if (error instanceof DeliveryFailure) throw error;
    throw new DeliveryFailure(config.type + "_network_or_timeout", true);
  }
}
