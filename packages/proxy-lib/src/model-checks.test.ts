import { expect, it, vi } from "vitest";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("./handler.js", () => ({ handleChatCompletion: handle }));
import { runModelCheck, modelCheckState } from "./model-checks.js";
import { HttpActivity } from "./http-activity.js";
import type { SessionPool } from "./handler.js";

it("only sends an explicit selected-model check, records the reported identity and actual route, and enforces cooldown", async () => {
  const activity = new HttpActivity(), pool = { status: { pending: 0 } } as unknown as SessionPool;
  expect(modelCheckState().runningModel).toBeNull();
  expect(handle).not.toHaveBeenCalled();
  expect((await runModelCheck({ model: "unknown-private-string" }, pool, activity)).status).toBe(400);
  pool.status.pending = 1;
  expect((await runModelCheck({ model: "claude-sonnet" }, pool, activity)).status).toBe(409);
  pool.status.pending = 0;
  expect(handle).not.toHaveBeenCalled();
  handle.mockImplementation(async (body, _pool, opts) => {
    expect(body.stream).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain("Do not guess");
    opts.activity.chat(body.model, false); opts.activity.upstream("claude-opus"); opts.activity.result(200);
    return Response.json({ choices: [{ message: { content: "I report Example Model 1.0" } }] });
  });
  const trace = activity.begin("POST", "/v1/proxy/model-check", true, "127.0.0.1")!;
  const response = await runModelCheck({ model: "claude-sonnet" }, pool, activity, trace);
  expect(await response.json()).toMatchObject({ model: "claude-sonnet", servedModel: "claude-opus", status: 200, identity: "I report Example Model 1.0", selfReported: true });
  trace(200);
  expect(activity.sources.snapshot().modelChecks[0]).toMatchObject({ model: "claude-sonnet", servedModel: "claude-opus", identity: "I report Example Model 1.0" });
  expect(activity.snapshot().selfChecks).toBe(1);
  expect((await runModelCheck({ model: "claude-sonnet" }, pool, activity)).status).toBe(429);
  expect(handle).toHaveBeenCalledTimes(1);
  activity.sources.close();
});
