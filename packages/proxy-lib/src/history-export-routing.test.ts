import { expect, it, vi } from "vitest";
vi.mock("node:crypto", async importOriginal => ({ ...await importOriginal<typeof import("node:crypto")>(), randomBytes: () => Buffer.from("b_"+"A".repeat(41), "base64url") }));
import { HistoryDownloads } from "./history-export.js";
import { RequestSources } from "./request-sources.js";
import { HttpActivity } from "./http-activity.js";
it("keeps normal 43-character export tokens beginning b_ on the history route", async () => {
  const sources = new RequestSources(), activity = new HttpActivity(sources);
  activity.begin("GET", "/v1/models", false, "192.0.2.1")!(200); sources.flush();
  try {
    const downloads = new HistoryDownloads(), ticket = downloads.create(sources.exportCursor(), "json");
    expect(ticket.url.split("/").at(-1)).toHaveLength(43); expect(ticket.url).toContain("/b_");
    const response = downloads.consume(new Request("http://localhost"+ticket.url));
    expect(response.status).toBe(200); expect((await response.json()).records).toHaveLength(1);
  } finally { sources.close(); }
});
