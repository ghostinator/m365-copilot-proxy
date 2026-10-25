import { randomBytes, scrypt, createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { atomicWritePrivate } from "@m365-copilot/core";

const stateSchema = z.object({ version: z.literal(1), salt: z.string().regex(/^[a-f0-9]{64}$/), hash: z.string().regex(/^[a-f0-9]{128}$/),
  sessions: z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int() })).max(20) });
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
export const administratorPassword = z.string().min(12).max(256);
export class OperatorPassword {
  private attempts = 0; private window = 0; private busy = false;
  private readonly path: string;
  constructor(directory: string, private now = () => Date.now()) { this.path = join(directory, "operator-password.json"); }
  private read() { return existsSync(this.path) ? stateSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))) : null; }
  configured() { return !!this.read(); }
  async set(password: string) {
    password = administratorPassword.parse(password);
    const salt = randomBytes(32).toString("hex"), hash = (await derive(password, salt)).toString("hex");
    atomicWritePrivate(this.path, JSON.stringify({ version: 1, salt, hash, sessions: [] }));
  }
  async login(password: string) {
    if (this.now() - this.window >= 60_000) { this.window = this.now(); this.attempts = 0; }
    if (this.busy || this.attempts >= 5) return { limited: true as const };
    this.attempts++; this.busy = true;
    try {
      const state = this.read();
      // Do equivalent hashing work even when no password has been configured.
      const actual = await derive(password, state?.salt ?? "0".repeat(64));
      if (!state || !timingSafeEqual(actual, Buffer.from(state.hash, "hex"))) return null;
      const current = this.read(); if (!current || current.hash !== state.hash) return null;
      const token = "m365_admin_" + randomBytes(32).toString("base64url"), expiresAt = this.now() + 12 * 60 * 60_000;
      const sessions = current.sessions.filter(s => s.expiresAt > this.now()).slice(-19);
      atomicWritePrivate(this.path, JSON.stringify({ ...current, sessions: [...sessions, { hash: digest(token), expiresAt }] }));
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    } finally { this.busy = false; }
  }
  allows(token: string) {
    if (!/^m365_admin_[A-Za-z0-9_-]{43}$/.test(token)) return false;
    try { return !!this.read()?.sessions.some(s => s.expiresAt > this.now() && s.expiresAt <= this.now() + 12 * 60 * 60_000 && timingSafeEqual(Buffer.from(s.hash, "hex"), Buffer.from(digest(token), "hex"))); }
    catch { return false; }
  }
  logout(token: string) {
    const state = this.read(); if (state) atomicWritePrivate(this.path, JSON.stringify({ ...state, sessions: state.sessions.filter(s => s.hash !== digest(token)) }));
  }
  revokeAll() { const state = this.read(); if (state) atomicWritePrivate(this.path, JSON.stringify({ ...state, sessions: [] })); }
}
