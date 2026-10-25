import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { notificationConfig, notificationDestination, deliveryMessage } from "./notification-schema.js";
import { sendNotification } from "./notification-transport.js";
import { Notifications } from "./notifications.js";
const config = (extra = {}) => notificationConfig.parse({ type: "ntfy", url: "https://push.example.invalid", topic: "secret-topic", bearer: "secret-token", ...extra });
const message = deliveryMessage("stable-id", null, "test", "test", 1000);

it("publishes plain text and title to exactly the chosen topic with optional authentication and no redirects", async () => {
  const requests: { url?: string; headers: any; body: string }[] = [];
  const server = createServer(async (req, res) => { let body = ""; for await (const chunk of req) body += chunk; requests.push({ url: req.url, headers: req.headers, body }); if (req.url === "/redirect") { res.writeHead(307, { location: "/must-not-follow" }); } res.end(JSON.stringify({ id: "fake-id", event: "message", topic: req.url?.slice(1) })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await sendNotification(config({ url, allowHttp: true }), message);
    expect(requests[0]).toMatchObject({ url: "/secret-topic", body: message.text, headers: { authorization: "Bearer secret-token", title: message.subject, "x-m365-delivery-id": "stable-id", "content-type": "text/plain; charset=utf-8" } });
    await sendNotification(config({ url, allowHttp: true, bearer: "" }), message); expect(requests[1].headers.authorization).toBeUndefined();
    await expect(sendNotification(config({ url, allowHttp: true, topic: "redirect" }), message)).rejects.toMatchObject({ category: "ntfy_network_or_timeout", retryable: true });
    expect(requests).toHaveLength(3);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it("classifies transient/permanent ntfy failures without exposing remote content", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    for (const status of [400, 401, 403, 408, 425, 429, 503]) {
      fetcher.mockResolvedValueOnce(new Response("secret-topic secret-token private server details", { status }));
      await expect(sendNotification(config(), message)).rejects.toMatchObject({ category: "ntfy_http_" + status, retryable: [408, 425, 429, 503].includes(status) });
      expect(fetcher.mock.calls.at(-1)![1]!.signal).toBeInstanceOf(AbortSignal);
    }
    fetcher.mockRejectedValueOnce(new Error("secret server URL"));
    await expect(sendNotification(config(), message)).rejects.toMatchObject({ message: "ntfy_network_or_timeout", retryable: true });
  } finally { fetcher.mockRestore(); }
});

it("validates topic/origin/header boundaries while leaving application keys optional", () => {
  for (const topic of ["", "bad/topic", "?key=value", "bad\nheader", "with space", "x".repeat(65)]) expect(() => config({ topic })).toThrow();
  for (const url of ["http://push.example.invalid", "https://user:pass@push.example.invalid", "https://push.example.invalid/path", "https://push.example.invalid?x=1", "https://push.example.invalid/#x"]) expect(() => config({ url })).toThrow();
  expect(() => config({ bearer: "token\r\nheader" })).toThrow(); expect(config({ topic: "Letters_012-abc" }).type).toBe("ntfy");
});

it("retains ntfy retries and IDs across restart without exposing topic, server or token in metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m365-ntfy-")), source = () => ({ max: 0, events: [] }); let now = 100_000;
  const fetcher = vi.spyOn(globalThis, "fetch"); const first = new Notifications(dir, source, sendNotification, () => now);
  try {
    const id = String(first.save(notificationDestination.parse({ label: "Push", config: config(), rules: ["storage"], events: ["opened"] })).destinations[0].id);
    await first.pump(); expect(fetcher).not.toHaveBeenCalled(); first.preview(id); expect(fetcher).not.toHaveBeenCalled();
    first.enable(id, true); first.test(id); fetcher.mockResolvedValueOnce(new Response(null, { status: 503 })); await first.pump();
    const before = first.snapshot(), stableId = before.deliveries[0].id; expect(before.counts.queued).toBe(1); first.close();
    const second = new Notifications(dir, source, sendNotification, () => now);
    try {
      now += 30_000; fetcher.mockResolvedValueOnce(Response.json({ id: "fake-id", event: "message", topic: "secret-topic" })); await second.pump(); await second.pump();
      const after = second.snapshot(); expect(after.counts.sent).toBe(1); expect(after.deliveries[0].id).toBe(stableId); expect(fetcher).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(after)).not.toMatch(/secret-topic|secret-token|push.example.invalid/);
    } finally { second.close(); }
  } finally { first.close(); fetcher.mockRestore(); }
});

it("rejects wrong-topic, non-message and malformed/oversized ntfy acknowledgements", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    for (const payload of [{ id: "ok", event: "message", topic: "wrong" }, { id: "ok", event: "keepalive", topic: "secret-topic" }, { id: "", event: "message", topic: "secret-topic" }, null]) {
      fetcher.mockResolvedValueOnce(Response.json(payload));
      await expect(sendNotification(config(), message)).rejects.toMatchObject({ category: "ntfy_invalid_response", retryable: true });
    }
    for (const body of ["<html>wrong origin</html>", " ".repeat(16_385)]) {
      fetcher.mockResolvedValueOnce(new Response(body));
      await expect(sendNotification(config(), message)).rejects.toMatchObject({ category: "ntfy_invalid_response", retryable: true });
    }
  } finally { fetcher.mockRestore(); }
});
