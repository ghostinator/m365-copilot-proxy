import type { Readable } from "node:stream";

/** Detach on cancellation without destroying the socket needed for an HTTP error reply. */
export function incomingRequestBody(request: Readable): ReadableStream<Uint8Array> {
  let detach = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const cleanup = () => {
        request.off("data", data); request.off("end", end);
        request.off("error", fail); request.off("aborted", aborted); request.off("close", aborted);
        request.once("error", () => {});
      };
      const data = (chunk: Buffer | string) => {
        if (closed) return;
        controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        if ((controller.desiredSize ?? 0) <= 0) request.pause();
      };
      const end = () => { if (closed) return; closed = true; cleanup(); controller.close(); };
      const fail = (error: Error) => { if (closed) return; closed = true; cleanup(); controller.error(error); };
      const aborted = () => fail(new Error("Request body aborted"));
      detach = () => {
        if (closed) return;
        closed = true; cleanup(); request.pause();
      };
      request.on("data", data); request.once("end", end);
      request.once("error", fail); request.once("aborted", aborted); request.once("close", aborted);
      if (request.readableEnded) end();
      else if (request.destroyed) aborted();
    },
    pull() { request.resume(); },
    cancel() { detach(); },
  });
}
