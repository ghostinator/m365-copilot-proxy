import { diagnosticText } from "./error-diagnostics.js";
import { activityQuery } from "./activity-schema.js";
import { alertSettings } from "./alert-store.js";
import { notificationDestination } from "./notification-schema.js";
import { historyDownloads } from "./history-export.js";
import { z } from "zod/v4";
import { operatorAccess, type OperatorAccess } from "./operator-access.js";
import { proxyApiKeys, type ApiKeyStore } from "./api-keys.js";
import { serviceCommand } from "./service-control.js";
import { boundedBytes, requestSignal, createLogger } from "@m365-copilot/core";
import type { HttpActivity } from "./http-activity.js";

const historyLog = createLogger("operator-history");
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock") }).strict(),
  z.object({ action: z.literal("notifications-status"), offset: z.number().int().min(0).max(10000000).default(0) }).strict(),
  z.object({ action: z.literal("notifications-save"), id: z.uuid().optional(), destination: notificationDestination }).strict(),
  z.object({ action: z.literal("notifications-enable"), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("notifications-remove"), id: z.uuid(), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("notifications-preview"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("notifications-test"), id: z.uuid(), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("alerts-configure"), settings: alertSettings }).strict(),
  z.object({ action: z.literal("alerts-acknowledge"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("alerts-history"), offset: z.number().int().min(0).max(10000000).default(0) }).strict(),
  z.object({ action: z.literal("export-create"), format: z.enum(["json", "csv"]), query: activityQuery.partial().strict() }).strict(),
  z.object({ action: z.literal("backup-list"), offset: z.number().int().min(0).max(1000000).default(0) }).strict(),
  z.object({ action: z.literal("backup-create") }).strict(),
  z.object({ action: z.literal("backup-verify"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("key-create"), label: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("key-rename"), id: z.uuid(), label: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("key-revoke"), id: z.uuid() }).strict(),
  z.object({ action: z.enum(["status", "restart", "startup-enable", "startup-disable"]) }).strict(),
]);
export async function operatorAction(req: Request, activity: HttpActivity, access: OperatorAccess = operatorAccess, keys: ApiKeyStore = proxyApiKeys): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (req.method !== "POST") return Response.json({ error: { message: "Use POST." } }, { status: 405, headers });
  if (!access.allows(req)) return Response.json({ error: { message: "Operator access is locked or expired. Run m365-proxy operator authorize on the host." } }, { status: 403, headers });
  if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: { message: "Expected application/json." } }, { status: 415, headers });
  let value: z.infer<typeof command>;
  try {
    const bytes = await boundedBytes(new Response(req.body, { headers: req.headers.has("content-length") ? { "content-length": req.headers.get("content-length")! } : undefined }), 4096, requestSignal(req.signal, 10_000));
    value = command.parse(JSON.parse(bytes.toString("utf8")));
  } catch { return Response.json({ error: { message: "Invalid operator command (maximum 4096 bytes)." } }, { status: 400, headers: { ...headers, Connection: "close" } }); }
  try {
    if (value.action === "export-create") return Response.json(historyDownloads.create(activity.sources.exportCursor(value.query), value.format), { headers });
    if (value.action === "backup-list") return Response.json(activity.sources.backupStore().list(value.offset), { headers });
    if (value.action === "backup-create") return Response.json(await activity.sources.backupStore().create(), { status: 201, headers });
    if (value.action === "backup-verify") return Response.json(await activity.sources.backupStore().restore(value.id), { headers });
    if (value.action === "unlock") return Response.json({ unlocked: true }, { headers });
    if (value.action === "notifications-status") return Response.json(activity.sources.alerts.notifications.snapshot(value.offset), { headers });
    if (value.action === "notifications-save") return Response.json(activity.sources.alerts.notifications.save(value.destination, value.id), { headers });
    if (value.action === "notifications-enable") return Response.json(activity.sources.alerts.notifications.enable(value.id, value.enabled), { headers });
    if (value.action === "notifications-remove") return Response.json(activity.sources.alerts.notifications.remove(value.id), { headers });
    if (value.action === "notifications-preview") return Response.json(activity.sources.alerts.notifications.preview(value.id), { headers });
    if (value.action === "notifications-test") return Response.json(activity.sources.alerts.notifications.test(value.id), { status: 202, headers });
    if (value.action === "alerts-configure") return Response.json(activity.sources.alerts.configure(value.settings), { headers });
    if (value.action === "alerts-acknowledge") return Response.json(activity.sources.alerts.acknowledge(value.id), { headers });
    if (value.action === "alerts-history") return Response.json(activity.sources.alerts.snapshot(value.offset), { headers });
    if (value.action === "key-create") return Response.json(keys.create(value.label), { status: 201, headers });
    if (value.action === "key-rename") { keys.rename(value.id, value.label); return Response.json({ updated: true }, { headers }); }
    if (value.action === "key-revoke") { keys.revoke(value.id); return Response.json({ updated: true }, { headers }); }
    return Response.json(await serviceCommand(value.action, activity), { status: value.action === "restart" ? 202 : 200, headers });
  } catch (error) {
    if (value.action.startsWith("notifications-")) return Response.json({ error: { type: "notification_operation_failed", message: "Notification operation failed. Check the selected destination, complete configuration, enablement, one-minute test cooldown and host storage. Saving or previewing never sends a message." } }, { status: 409, headers });
    if (value.action.startsWith("backup-") || value.action === "export-create") {
      historyLog.error(diagnosticText(error instanceof Error ? error.message : "History operation failed"));
      const message = value.action === "backup-verify" ? "Backup verification failed. It may be missing, incomplete, corrupt or unsupported. Nothing was restored."
        : value.action === "export-create" ? "Export could not start. At most four downloads can be pending/active; check history storage and retry after existing downloads finish."
        : "Backup operation failed. Check free disk space, database access and history-operation locks; refresh the inventory before retrying.";
      return Response.json({ error: { type: "history_operation_failed", message } }, { status: 409, headers });
    }
    // Never echo validation input, filesystem paths or command output to remote clients.
    return Response.json({ error: { message: error instanceof z.ZodError ? "Invalid key label." : "Operation failed. Check the host configuration and service logs; no credentials are included here." } }, { status: 409, headers });
  }
}
