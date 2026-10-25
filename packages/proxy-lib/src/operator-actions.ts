import { z } from "zod/v4";
import { operatorAccess, type OperatorAccess } from "./operator-access.js";
import { proxyApiKeys, type ApiKeyStore } from "./api-keys.js";
import { serviceCommand } from "./service-control.js";
import { boundedBytes, requestSignal } from "@m365-copilot/core";
import type { HttpActivity } from "./http-activity.js";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock") }).strict(),
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
    if (value.action === "unlock") return Response.json({ unlocked: true }, { headers });
    if (value.action === "key-create") return Response.json(keys.create(value.label), { status: 201, headers });
    if (value.action === "key-rename") { keys.rename(value.id, value.label); return Response.json({ updated: true }, { headers }); }
    if (value.action === "key-revoke") { keys.revoke(value.id); return Response.json({ updated: true }, { headers }); }
    return Response.json(await serviceCommand(value.action, activity), { status: value.action === "restart" ? 202 : 200, headers });
  } catch (error) {
    // Never echo validation input, filesystem paths or command output to remote clients.
    return Response.json({ error: { message: error instanceof z.ZodError ? "Invalid key label." : "Operation failed. Check the host configuration and service logs; no credentials are included here." } }, { status: 409, headers });
  }
}
