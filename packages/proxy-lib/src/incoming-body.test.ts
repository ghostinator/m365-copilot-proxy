import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { incomingRequestBody } from "./incoming-body.js";
import { readJsonBody } from "./http-policy.js";

it("detaches body listeners on a length rejection and ignores late chunks without closing the reply socket", async () => {
  const input = new PassThrough(), stream = incomingRequestBody(input);
  await expect(readJsonBody(stream, String(64 * 1024 * 1024))).rejects.toThrow(/size limit/);
  expect(input.listenerCount("data")).toBe(0);
  expect(input.isPaused()).toBe(true);
  expect(input.destroyed).toBe(false);
  expect(() => input.emit("data", Buffer.from("late chunk"))).not.toThrow();
  input.destroy();
});

it("reads a normal JSON body and reports a premature disconnect", async () => {
  const input = new PassThrough(), result = readJsonBody(incomingRequestBody(input));
  input.end('{"model":"claude-sonnet"}');
  await expect(result).resolves.toEqual({ model: "claude-sonnet" });
  const disconnected = new PassThrough(), failed = readJsonBody(incomingRequestBody(disconnected));
  disconnected.emit("aborted");
  await expect(failed).rejects.toThrow("aborted");
  disconnected.destroy();
});
