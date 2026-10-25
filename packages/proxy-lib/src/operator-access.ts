import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR, atomicWritePrivate } from "@m365-copilot/core";

/** Separate, deliberately short-lived host authorization. Application keys never grant management. */
export class OperatorAccess {
  constructor(private directory = CONFIG_DIR, private now = () => Date.now()) {}
  grant() {
    const token = "m365_operator_" + randomBytes(32).toString("base64url");
    const expiresAt = this.now() + 15 * 60_000;
    atomicWritePrivate(join(this.directory, "operator-access.json"), JSON.stringify({ hash: this.hash(token).toString("hex"), expiresAt }));
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }
  private hash(value: string) { return createHash("sha256").update(value).digest(); }
  allows(req: Request) {
    // Require exact origin, independent of configured application CORS origins.
    if (req.headers.get("origin") !== new URL(req.url).origin) return false;
    const token = req.headers.get("x-m365-operator") ?? "";
    if (!/^m365_operator_[A-Za-z0-9_-]{43}$/.test(token)) return false;
    try {
      const state = JSON.parse(readFileSync(join(this.directory, "operator-access.json"), "utf8"));
      return Number.isSafeInteger(state.expiresAt) && state.expiresAt > this.now() && state.expiresAt <= this.now() + 15 * 60_000
        && /^[a-f0-9]{64}$/.test(state.hash) && timingSafeEqual(Buffer.from(state.hash, "hex"), this.hash(token));
    } catch { return false; }
  }
}
export const operatorAccess = new OperatorAccess();
