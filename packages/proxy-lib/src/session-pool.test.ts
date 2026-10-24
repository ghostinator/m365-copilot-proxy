import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionPool } from "./session-pool.js";
const opener = [{ role: "user" as const, content: "hello" }];
const reply = { role: "assistant" as const, content: "first result" };
afterEach(() => vi.unstubAllEnvs());
describe("conversation isolation", () => {
  it("continues an exact acknowledged history, but isolates changed replies, system messages, images and callers", () => {
    const pool = new SessionPool();
    const first = pool.resolve(opener, undefined, "a");
    pool.acknowledge(first, opener, reply);
    const continuation = [...opener, reply, { role: "user" as const, content: "continue" }];
    expect(pool.resolve(continuation, undefined, "a")).toBe(first);
    expect(pool.resolve(continuation, undefined, "b")).not.toBe(first);
    expect(pool.resolve([...opener, { ...reply, content: "someone else's reply" }, continuation[2]], undefined, "a")).not.toBe(first);
    expect(pool.resolve([{ role: "system", content: "different directory" }, ...continuation], undefined, "a")).not.toBe(first);
    expect(pool.resolve([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }, ...continuation.slice(1)], undefined, "a")).not.toBe(first);
  });
  it("does not merge colliding old hashes or repeated first turns", () => {
    const pool = new SessionPool();
    expect(pool.resolve(opener)).not.toBe(pool.resolve(opener));
    expect(pool.resolve([{ role: "user", content: "Aa" }])).not.toBe(pool.resolve([{ role: "user", content: "BB" }]));
  });
  it("bounds memory and serializes turns while allowing a queued caller to cancel", async () => {
    vi.stubEnv("M365_MAX_SESSIONS", "2");
    const pool = new SessionPool();
    pool.resolve(opener); pool.resolve(opener); pool.resolve(opener);
    expect(pool.size).toBe(2);
    const release = await pool.acquire();
    const controller = new AbortController();
    const cancelled = pool.acquire(controller.signal);
    const rejected = expect(cancelled).rejects.toBeDefined();
    controller.abort();
    await rejected;
    let admitted = false;
    const next = pool.acquire().then(unlock => { admitted = true; return unlock; });
    await Promise.resolve(); expect(admitted).toBe(false);
    release(); (await next)();
    pool.close();
    await expect(pool.acquire()).rejects.toThrow("shutting down");
  });
});
