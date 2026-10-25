import { alertModelId } from "./alert-models.js";
import { z } from "zod/v4";

const clean = (max: number) => z.string().max(max).refine(s => !/[\x00-\x1f\x7f]/.test(s));
const email = clean(254).pipe(z.email());
const apiKey = clean(2048).min(1).refine(s => !/\s/.test(s));
export const notificationRule = z.enum(["failures", "throttling", "authentication", "storage"]);
export const notificationEvent = z.enum(["opened", "resolved"]);
export const notificationConfig = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook"), url: z.url().max(1536), format: z.enum(["generic", "slack", "teams"]),
    bearer: clean(2048).default(""), allowHttp: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("smtp"), host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.:[\]-]+$/),
    port: z.number().int().min(1).max(65535), security: z.enum(["tls", "starttls", "local"]),
    user: clean(254).default(""), password: clean(512).default(""), from: email, to: z.array(email).min(1).max(5) }).strict(),
  z.object({ type: z.literal("ntfy"), url: z.url().max(1536), topic: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    bearer: clean(2048).default(""), allowHttp: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("postal"), url: z.url().max(1536), apiKey,
    allowHttp: z.boolean().default(false), from: email, to: z.array(email).min(1).max(5) }).strict(),
  z.object({ type: z.literal("sendgrid"), region: z.enum(["global", "eu"]).default("global"), apiKey,
    from: email, to: z.array(email).min(1).max(5) }).strict(),
]).superRefine((c, ctx) => {
  if (c.type === "webhook" || c.type === "postal" || c.type === "ntfy") {
    const u = new URL(c.url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.hash || (u.protocol === "http:" && !c.allowHttp)) ctx.addIssue({ code: "custom", message: "Use HTTPS, or explicitly allow HTTP; URL credentials/fragments are not supported" });
    if ((c.type === "postal" || c.type === "ntfy") && (u.pathname !== "/" || u.search)) ctx.addIssue({ code: "custom", message: "Provider URL must be the server origin without a path or query" });
  } else if (c.type === "smtp") {
    if (!!c.user !== !!c.password) ctx.addIssue({ code: "custom", message: "SMTP username and password must both be supplied or both omitted" });
    if (c.security === "local" && (!["127.0.0.1", "::1", "localhost"].includes(c.host) || c.user || c.password)) ctx.addIssue({ code: "custom", message: "Unencrypted SMTP is restricted to a literal loopback relay without credentials" });
  }
});
export const notificationDestination = z.object({ label: clean(100).refine(s => !!s.trim()), config: notificationConfig,
  rules: z.array(notificationRule).min(1).max(4), events: z.array(notificationEvent).min(1).max(2) }).strict();
export type NotificationDestination = z.infer<typeof notificationDestination>;
export type NotificationConfig = z.infer<typeof notificationConfig>;
export interface DeliveryMessage { version: 1; deliveryId: string; incidentId: string | null; rule: string; event: string; occurredAt: string; subject: string; text: string; model?: string }

/** Fixed messages, recognized counts and explicitly configured model IDs only. */
export function deliveryMessage(id: string, incidentId: string | null, rule: string, event: string, at: number, evidence = "", model?: string): DeliveryMessage {
  const parsedModel = alertModelId.safeParse(model);
  const modelName = parsedModel.success ? parsedModel.data : null;
  const test = event === "test", subject = test ? "M365 Proxy notification test" : `M365 Proxy: ${rule} ${event}`;
  const counts = evidence.match(/^(\d+) (errors|throttled requests) \/ (\d+) completed application chats in (\d+) minutes\.$/);
  const detail = test ? "This is an explicitly requested test notification. No model request was sent."
    : event === "resolved" ? "The previously observed condition has recovered."
    : counts ? `${counts[1]} ${counts[2]} / ${counts[3]} completed chats in ${counts[4]} minutes.`
    : rule === "authentication" ? "Sign-in recovery is required on the proxy host."
    : rule === "storage" ? "Activity storage needs attention on the proxy host." : "A sustained condition was observed. Inspect the proxy dashboard.";
  return { version: 1, deliveryId: id, incidentId, rule, event, occurredAt: new Date(at).toISOString(), subject, ...(modelName ? { model: modelName } : {}), text: subject + (modelName ? "\nRequested model: " + modelName : "") + "\n" + detail + "\n" + new Date(at).toISOString() };
}
