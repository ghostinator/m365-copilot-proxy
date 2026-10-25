import { createServer } from "node:http";
import { createServer as tcpServer, type Socket } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Notifications } from "./notifications.js";
import { NotificationStore, type NotificationEventRow } from "./notification-store.js";
import { notificationDestination, notificationConfig, deliveryMessage } from "./notification-schema.js";
import { sendNotification, DeliveryFailure, webhookPayload } from "./notification-transport.js";
import { OperatorAccess } from "./operator-access.js";
import { ApiKeyStore } from "./api-keys.js";
import { HttpActivity } from "./http-activity.js";
import { operatorAction } from "./operator-actions.js";

const destination = (config: unknown = { type: "webhook", url: "https://example.invalid/secret-hook", format: "generic", bearer: "secret-bearer" }) => notificationDestination.parse({ label: "Operations", config, rules: ["failures", "storage"], events: ["opened", "resolved"] });
const event = (seq: number, kind = "opened", incident = "incident-1"): NotificationEventRow => ({ seq, incident_id: incident, rule: "failures", event: kind, at_ms: 100_000 + seq, evidence: "5 errors / 10 completed application chats in 5 minutes." });
function fixture(dir?: string, existing: NotificationEventRow[] = []) {
  let now = 100_000; const events = existing, sent: { id: string; event: string }[] = [];
  const send = vi.fn(async (_config, message) => { sent.push({ id: message.deliveryId, event: message.event }); });
  const source = (after: number, limit: number) => ({ max: events.at(-1)?.seq ?? 0, events: events.filter(e => e.seq > after).slice(0, limit) });
  const service = new Notifications(dir, source, send, () => now);
  return { service, source, send, sent, events, at: (time: number) => now = time };
}

it("saves disabled, never replays historical events on enable, and sends each future event once", async () => {
  const f = fixture(undefined, [event(1)]), state = f.service.save(destination()), id = String(state.destinations[0].id);
  expect(state.destinations[0].enabled).toBe(false); await f.service.pump(); expect(f.send).not.toHaveBeenCalled();
  f.events.push(event(2)); f.service.enable(id, true); await f.service.pump(); expect(f.send).not.toHaveBeenCalled();
  f.events.push(event(3)); await f.service.pump(); await f.service.pump();
  expect(f.sent).toHaveLength(1); expect(f.service.snapshot().counts.sent).toBe(1); f.service.close();
});

it("retries with stable IDs, bounds attempts and never persists remote error content or credentials", async () => {
  const f = fixture(); const id = String(f.service.save(destination()).destinations[0].id); f.service.enable(id, true);
  f.send.mockImplementation(async () => { throw new DeliveryFailure("webhook_http_503", true); }); f.events.push(event(1));
  await f.service.pump(); expect(f.send).toHaveBeenCalledTimes(1); f.at(129_999); await f.service.pump(); expect(f.send).toHaveBeenCalledTimes(1);
  for (const at of [130_000, 250_000, 850_000]) { f.at(at); await f.service.pump(); }
  const ids = f.send.mock.calls.map(call => call[1].deliveryId); expect(new Set(ids).size).toBe(1);
  expect(f.service.snapshot().counts.failed).toBe(1); expect(f.send).toHaveBeenCalledTimes(4);
  f.at(9_999_999); await f.service.pump(); expect(f.send).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(f.service.snapshot())).not.toMatch(/secret-hook|secret-bearer|example.invalid/); f.service.close();
});

it("recovers a durable retry after restart without re-enqueueing the event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-notify-")), events: NotificationEventRow[] = [];
  const first = fixture(dir, events), id = String(first.service.save(destination()).destinations[0].id); first.service.enable(id, true);
  first.send.mockRejectedValue(new DeliveryFailure("webhook_network_or_timeout", true)); events.push(event(1)); await first.service.pump();
  const deliveryId = String(first.service.snapshot().deliveries[0].id); first.service.close();
  const second = fixture(dir, events); second.at(130_000); await second.service.pump(); await second.service.pump();
  expect(second.sent).toEqual([{ id: deliveryId, event: "opened" }]); expect(second.service.snapshot().total).toBe(1); second.service.close();
});

it("dead-letters permanent failures without retries and routes only selected rules/events", async () => {
  const f = fixture(), id = String(f.service.save(destination()).destinations[0].id); f.service.enable(id, true);
  f.send.mockRejectedValue(new DeliveryFailure("webhook_http_400", false));
  f.events.push({ ...event(1), rule: "throttling" }); await f.service.pump(); expect(f.send).not.toHaveBeenCalled();
  f.events.push(event(2)); await f.service.pump(); f.at(999_999); await f.service.pump();
  expect(f.send).toHaveBeenCalledOnce(); expect(f.service.snapshot().counts.failed).toBe(1); f.service.close();
});

it("requires operator authorization and explicit test confirmation without enabling application keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-notify-api-")), access = new OperatorAccess(dir), keys = new ApiKeyStore(dir), activity = new HttpActivity(), grant = access.grant();
  const request = (value: unknown, token = grant.token) => new Request("http://localhost/v1/proxy/operator", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-m365-operator": token }, body: JSON.stringify(value) });
  const action = (v: unknown, token?: string) => operatorAction(request(v, token), activity, access, keys);
  expect((await action({ action: "notifications-save", destination: destination() }, "")).status).toBe(403);
  const saved = await (await action({ action: "notifications-save", destination: destination() })).json();
  expect(JSON.stringify(saved)).not.toMatch(/secret-hook|secret-bearer/); const id = saved.destinations[0].id;
  expect(saved.destinations[0].enabled).toBe(false);
  expect((await action({ action: "notifications-test", id, confirm: true })).status).toBe(409);
  await action({ action: "notifications-enable", id, enabled: true });
  expect((await action({ action: "notifications-test", id })).status).toBe(400);
  expect((await action({ action: "notifications-test", id, confirm: true })).status).toBe(202);
  expect(keys.status().required).toBe(false); activity.sources.close();
});

it("cancels queued opening retries after acknowledgement and allows recovery and a new incident", async () => {
  const f = fixture(), id = String(f.service.save(destination()).destinations[0].id); f.service.enable(id, true);
  f.send.mockRejectedValueOnce(new DeliveryFailure("webhook_http_429", true)); f.events.push(event(1)); await f.service.pump();
  f.events.push(event(2, "acknowledged")); f.at(130_000); await f.service.pump(); expect(f.service.snapshot().counts.cancelled).toBe(1);
  f.events.push(event(3, "resolved")); await f.service.pump(); f.events.push(event(4, "opened", "new-incident")); await f.service.pump();
  expect(f.sent.map(r => r.event)).toEqual(["resolved", "opened"]); f.service.close();
});

it("supports explicit tests with cooldown, revision cancellation, removal and metadata-only previews", async () => {
  const f = fixture(), id = String(f.service.save(destination()).destinations[0].id);
  expect(f.service.preview(id).message.event).toBe("test"); expect(() => f.service.test(id)).toThrow(); f.service.enable(id, true);
  f.service.test(id); expect(() => f.service.test(id)).toThrow();
  f.service.save(destination(), id); await f.service.pump(); expect(f.send).not.toHaveBeenCalled();
  expect(f.service.snapshot().counts.cancelled).toBe(1); f.service.enable(id, true); f.at(170_000); f.service.test(id); await f.service.pump();
  expect(f.sent.map(r => r.event)).toEqual(["test"]); f.service.remove(id); expect(f.service.snapshot().destinations).toEqual([]);
  expect(() => f.service.save(destination(), id)).toThrow(); f.service.close();
});

it("claims work exclusively, recovers expired leases and rejects stale completion owners", () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-notify-lease-")), a = new NotificationStore(dir), b = new NotificationStore(dir);
  const id = a.save(destination(), 0, 100_000); a.enable(id, true, 0, 100_000); a.ingest({ max: 1, events: [event(1)] }, 100_000);
  const first = a.claim(100_000)!; expect(b.claim(100_001)).toBeNull(); const recovered = b.claim(160_000)!;
  expect(recovered.id).toBe(first.id); expect(recovered.attempts).toBe(2);
  a.complete(first.id, first.lease, 1, 160_001); expect(a.snapshot().counts.sending).toBe(1);
  b.complete(recovered.id, recovered.lease, 2, 160_002); expect(a.snapshot().counts.sent).toBe(1); a.close(); b.close();
});

it("rejects unsafe schemes/headers and does not forward arbitrary stored evidence", () => {
  for (const url of ["file:///private", "https://user:pass@example.invalid/", "http://example.invalid", "https://example.invalid/#secret"]) expect(() => destination({ type: "webhook", url, format: "generic" })).toThrow();
  expect(() => destination({ type: "smtp", host: "remote.invalid", port: 25, security: "local", from: "a@example.invalid", to: ["b@example.invalid"] })).toThrow();
  expect(() => destination({ type: "webhook", url: "https://example.invalid", format: "generic", bearer: "a\r\nInjected:yes" })).toThrow();
  const message = deliveryMessage("id", "incident", "failures", "opened", 100_000, "Bearer private-token IP 192.0.2.1 normal-prompt");
  expect(JSON.stringify(message)).not.toMatch(/private-token|192\.0\.2|normal-prompt/);
});

it("sends generic, Slack and Teams payloads to a local fake receiver and refuses redirects", async () => {
  const received: { url: string; data: string; auth?: string }[] = [];
  const server = createServer(async (req, res) => { let data = ""; for await (const chunk of req) data += chunk; received.push({ url: req.url!, data, auth: req.headers.authorization });
    if (req.url === "/redirect") { res.writeHead(302, { location: "/must-not-follow" }); res.end(); } else { res.writeHead(200); res.end("provider-private-error-body"); } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const port = (server.address() as { port: number }).port;
  try {
    const message = deliveryMessage("test-id", null, "test", "test", 100_000);
    for (const format of ["generic", "slack", "teams"] as const) {
      const config = notificationConfig.parse({ type: "webhook", url: `http://127.0.0.1:${port}/receive`, allowHttp: true, format, bearer: "dummy-token" });
      await sendNotification(config, message); expect(JSON.parse(received.at(-1)!.data)).toEqual(webhookPayload(config as any, message));
    }
    await expect(sendNotification(notificationConfig.parse({ type: "webhook", url: `http://127.0.0.1:${port}/redirect`, allowHttp: true, format: "generic" }), message)).rejects.toMatchObject({ category: "webhook_network_or_timeout" });
    expect(received.some(r => r.url === "/must-not-follow")).toBe(false); expect(received[0].auth).toBe("Bearer dummy-token");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it("delivers through Nodemailer to a local fake SMTP relay without contacting a mail provider", async () => {
  let data = ""; const sockets = new Set<Socket>();
  const server = tcpServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.write("220 fake.local ESMTP\r\n"); let buffer = "", inData = false;
    socket.on("data", bytes => { buffer += bytes; let end: number; while ((end = buffer.indexOf("\r\n")) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (inData) { if (line === ".") { inData = false; socket.write("250 queued locally\r\n"); } else data += line + "\n"; }
      else if (/^EHLO/.test(line)) socket.write("250-fake.local\r\n250 PIPELINING\r\n");
      else if (/^DATA/.test(line)) { inData = true; socket.write("354 send data\r\n"); }
      else if (/^QUIT/.test(line)) socket.end("221 bye\r\n"); else socket.write("250 ok\r\n");
    } }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const port = (server.address() as { port: number }).port;
  try {
    await sendNotification(notificationConfig.parse({ type: "smtp", host: "127.0.0.1", port, security: "local", from: "sender@example.invalid", to: ["receiver@example.invalid"] }), deliveryMessage("stable-id", null, "test", "test", 100_000));
    expect(data).toContain("Subject: M365 Proxy notification test"); expect(data).toContain("Message-ID: <stable-id@m365-proxy.local>"); expect(data).toContain("explicitly requested test");
  } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
