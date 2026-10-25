import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Notifications } from "./notifications.js";
import { expect, it, vi } from "vitest";
import { notificationConfig, deliveryMessage } from "./notification-schema.js";
import { sendNotification, DeliveryFailure } from "./notification-transport.js";
import { NotificationStore } from "./notification-store.js";

const message = deliveryMessage("stable-id", null, "test", "test", 1000);
const config = (type: "postal" | "sendgrid", extra = {}) => notificationConfig.parse({ type, apiKey: "private-key", from: "alerts@example.com", to: ["ops@example.com"], ...(type === "postal" ? { url: "https://postal.example.com" } : {}), ...extra });

it("sends provider-specific authenticated plain-text requests with stable IDs and regional endpoints", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    for (const type of ["postal", "sendgrid"] as const) {
      fetcher.mockResolvedValueOnce(type === "postal" ? Response.json({ status: "success", data: { message_id: "accepted" } }) : new Response(null, { status: 202 }));
      await sendNotification(config(type), message);
      const [url, init] = fetcher.mock.calls.at(-1)!; const body = JSON.parse(String(init!.body));
      expect(url).toBe(type === "postal" ? "https://postal.example.com/api/v1/send/message" : "https://api.sendgrid.com/v3/mail/send");
      expect(init!.redirect).toBe("error"); expect(init!.signal).toBeInstanceOf(AbortSignal);
      expect(init!.headers).toMatchObject(type === "postal" ? { "X-Server-API-Key": "private-key" } : { Authorization: "Bearer private-key" });
      expect(body.headers).toEqual({ "X-M365-Delivery-Id": "stable-id", "Message-ID": "<stable-id@m365-proxy.local>" });
      expect(type === "postal" ? body.plain_body : body.content[0].value).toBe(message.text);
      expect(type === "postal" ? body.to : body.personalizations[0].to).toEqual(type === "postal" ? ["ops@example.com"] : [{ email: "ops@example.com" }]);
      expect(body).not.toHaveProperty("html_body"); expect(body).not.toHaveProperty("attachments");
    }
    fetcher.mockResolvedValueOnce(new Response(null, { status: 202 })); await sendNotification(config("sendgrid", { region: "eu" }), message);
    expect(fetcher.mock.calls.at(-1)![0]).toBe("https://api.eu.sendgrid.com/v3/mail/send");
  } finally { fetcher.mockRestore(); }
});

it("classifies HTTP rejection, throttling and network failures without exposing provider diagnostics", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    for (const type of ["postal", "sendgrid"] as const) {
      for (const status of [301, 400, 401, 403, 408, 425, 429, 500, 503]) {
        fetcher.mockResolvedValueOnce(new Response("private-key recipient@example.com private-provider-detail", { status }));
        await expect(sendNotification(config(type), message)).rejects.toMatchObject({ category: type + "_http_" + status, retryable: [408, 425, 429, 500, 503].includes(status) });
      }
      fetcher.mockRejectedValueOnce(new Error("private transport error"));
      await expect(sendNotification(config(type), message)).rejects.toMatchObject({ message: type + "_network_or_timeout", retryable: true });
    }
    fetcher.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(sendNotification(config("sendgrid"), message)).rejects.toMatchObject({ category: "sendgrid_unexpected_response", retryable: false });
  } finally { fetcher.mockRestore(); }
});

it("requires Postal application success and bounds untrusted response parsing", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    fetcher.mockResolvedValueOnce(Response.json({ status: "error", data: { message: "private diagnostic" } }));
    await expect(sendNotification(config("postal"), message)).rejects.toMatchObject({ category: "postal_api_rejected", retryable: false });
    for (const body of ["invalid", "null", "{}", '{"status":"unknown"}', " ".repeat(16385)]) {
      fetcher.mockResolvedValueOnce(new Response(body));
      await expect(sendNotification(config("postal"), message)).rejects.toMatchObject({ category: "postal_invalid_response", retryable: true });
    }
    let cancelled = false;
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(16385)); }, cancel() { cancelled = true; } })));
    await expect(sendNotification(config("postal"), message)).rejects.toBeInstanceOf(DeliveryFailure); expect(cancelled).toBe(true);
  } finally { fetcher.mockRestore(); }
});

it("validates provider configuration and keeps provider secrets and recipients out of metadata", () => {
  for (const extra of [{ url: "http://postal.example.com" }, { url: "https://user:pass@postal.example.com" }, { url: "https://postal.example.com/path" }, { url: "https://postal.example.com?key=value" }, { url: "https://postal.example.com/#fragment" }, { apiKey: "bad\r\nheader" }, { apiKey: "" }, { to: [] }]) expect(() => config("postal", extra)).toThrow();
  expect(config("postal", { url: "http://127.0.0.1:9000", allowHttp: true }).type).toBe("postal");
  expect(() => config("sendgrid", { region: "custom" })).toThrow(); expect(() => config("sendgrid", { url: "http://attacker.invalid" })).toThrow();
  const store = new NotificationStore();
  try {
    for (const type of ["postal", "sendgrid"] as const) {
      store.save({ label: type, config: config(type), rules: ["failures"], events: ["opened"] }, 0, 1000);
    }
    const snapshot = store.snapshot(); expect(snapshot.destinations).toHaveLength(2);
    expect(snapshot.destinations.every(d => d.credentialConfigured && !d.enabled)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/private-key|example.com|apiKey/);
  } finally { store.close(); }
});

it("restores provider destinations and queued tests across restart through the real worker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "m365-api-mail-")); const source = () => ({ max: 0, events: [] });
  const first = new Notifications(directory, source);
  for (const type of ["postal", "sendgrid"] as const) {
    const state = first.save({ label: type, config: config(type), rules: ["failures"], events: ["opened"] });
    const id = String(state.destinations.find(d => d.type === type)!.id); first.enable(id, true); first.test(id);
  }
  first.close();
  const second = new Notifications(directory, source); const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    fetcher.mockImplementation(async url => String(url).includes("postal") ? Response.json({ status: "success" }) : new Response(null, { status: 202 }));
    await second.pump(); await second.pump(); await second.pump();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(second.snapshot().counts.sent).toBe(2);
    expect(JSON.stringify(second.snapshot())).not.toMatch(/private-key|example.com|apiKey/);
  } finally { second.close(); fetcher.mockRestore(); }
});
