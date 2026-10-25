/** Error-only diagnostics: never retain request headers or normal conversation content. */
export function diagnosticText(value: unknown, limit = 12000): string {
  return String(value ?? "").slice(0, limit * 2)
    .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/gi, "[redacted authorization]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, "[redacted token]")
    .replace(/\bm365_(?:operator|admin)_[A-Za-z0-9_-]+/g, "[redacted operator credential]")
    .replace(/\bm365_[A-Za-z0-9_-]{20,}/g, "[redacted application key]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted key]")
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie|authorization)[\s"']*[:=][\s"']*)[^\s,"';}]+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[redacted query]")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, limit);
}
export function errorPayload(text: string): { type: string; message: string; code?: string } | null {
  try {
    const parsed = JSON.parse(text), error = parsed.error ?? parsed;
    if (!error || typeof error !== "object") return null;
    const type = typeof error.type === "string" ? error.type : "http_error";
    // JSON syntax exceptions can echo user input. Validation routes supply safe details separately.
    const message = type === "invalid_request_error" ? "Request validation failed; verify JSON syntax, required messages, model and supported parameter types." : typeof error.message === "string" ? error.message : typeof error.statusMessage === "string" ? error.statusMessage : "Request failed without a structured error message.";
    return { type, message, ...(typeof error.code === "string" ? { code: error.code } : {}) };
  } catch { return null; }
}
