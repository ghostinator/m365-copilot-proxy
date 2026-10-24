export function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** Cancels this caller's wait without cancelling a login shared with another caller. */
export function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

export function requestSignal(signal?: AbortSignal, ms = 60_000): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

export async function boundedBytes(response: Response, limit: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Response exceeds the configured size limit"); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  const aborted = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", aborted, { once: true });
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Response exceeds the configured size limit");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal?.removeEventListener("abort", aborted); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
