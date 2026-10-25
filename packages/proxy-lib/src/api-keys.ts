import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { CONFIG_DIR, atomicWritePrivate } from "@m365-copilot/core";

const label = z.string().trim().min(1).max(100).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const record = z.object({ id: z.uuid(), label, hash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable() });
const stateSchema = z.object({ version: z.literal(1), required: z.boolean(), keys: z.array(record).max(1000) });
type State = z.infer<typeof stateSchema>;
export interface ApplicationKey { id: string; label: string }
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Named application credentials are stored only as digests; CLI mutations need local file access. */
export class ApiKeyStore {
  readonly path: string;
  constructor(private directory = CONFIG_DIR) { this.path = join(directory, "proxy-api-keys.json"); }
  private read(): State {
    if (!existsSync(this.path)) return { version: 1, required: false, keys: [] };
    try { return stateSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))); }
    catch { throw new Error("Application key configuration is invalid; repair proxy-api-keys.json before serving requests."); }
  }
  private update(change: (state: State) => void) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = this.path + ".lock";
    let fd: number;
    try { fd = openSync(lock, "wx", 0o600); }
    catch { throw new Error("Another key update is in progress; no keys were changed."); }
    try { const state = this.read(); change(state); atomicWritePrivate(this.path, JSON.stringify(stateSchema.parse(state), null, 2) + "\n"); }
    finally { closeSync(fd); unlinkSync(lock); }
  }
  status() {
    const state = this.read();
    return { required: !!process.env.M365_API_KEY || state.required, legacyConfigured: !!process.env.M365_API_KEY,
      keys: state.keys.map(({ hash: _hash, ...metadata }) => metadata) };
  }
  authorize(headers: Headers): { allowed: boolean; application: ApplicationKey | null } {
    const state = this.read(), token = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const presented = digest(token.length <= 4096 ? token : "");
    let application: ApplicationKey | null = null;
    for (const key of state.keys) if (!key.revokedAt && timingSafeEqual(Buffer.from(key.hash, "hex"), presented)) application = { id: key.id, label: key.label };
    if (process.env.M365_API_KEY && timingSafeEqual(digest(process.env.M365_API_KEY), presented)) application = { id: "legacy", label: "Legacy API key" };
    return { allowed: !!application || (!process.env.M365_API_KEY && !state.required), application };
  }
  create(name: string) {
    const token = "m365_" + randomBytes(32).toString("base64url");
    const key = { id: randomUUID(), label: label.parse(name), hash: digest(token).toString("hex"), createdAt: new Date().toISOString(), revokedAt: null };
    this.update(state => { state.keys.push(key); });
    const { hash: _hash, ...metadata } = key;
    return { ...metadata, token };
  }
  revoke(id: string) {
    this.update(state => {
      const key = state.keys.find(key => key.id === id);
      if (!key) throw new Error("Application key ID not found.");
      key.revokedAt ??= new Date().toISOString();
    });
  }
  rename(id: string, name: string) {
    const value = label.parse(name);
    this.update(state => { const key = state.keys.find(key => key.id === id); if (!key) throw new Error("Application key ID not found."); key.label = value; });
  }
  mode(required: boolean) {
    this.update(state => {
      if (required && !process.env.M365_API_KEY && !state.keys.some(key => !key.revokedAt)) throw new Error("Create an application key before requiring keys.");
      state.required = required;
    });
  }
}
export const proxyApiKeys = new ApiKeyStore();
