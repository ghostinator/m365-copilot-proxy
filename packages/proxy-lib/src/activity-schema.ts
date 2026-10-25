import { isIP } from "node:net";
import { z } from "zod/v4";
import { getAvailableModels } from "@m365-copilot/core";

export function clientSoftware(agent?: string): string {
  if (!agent) return "unknown";
  for (const [pattern, name] of [[/openai.*python/i, "OpenAI Python"], [/openai.*(?:node|js)/i, "OpenAI Node"], [/openclaw/i, "OpenClaw"], [/claude.?code/i, "Claude Code"], [/\bpi(?:\/|\s)/i, "pi"], [/python-httpx/i, "Python HTTPX"], [/python-requests/i, "Python Requests"], [/curl\//i, "curl"], [/axios/i, "Axios"], [/mozilla\//i, "Web browser"], [/powershell/i, "PowerShell"], [/^node$/i, "Node.js"]] as const) if (pattern.test(agent.slice(0, 512))) return name;
  return "unknown";
}
export const modelName = z.string().max(100).refine(value => value === "(custom model)" || getAvailableModels().includes(value));
/** Only transport metadata belongs here: never forwarded/client headers. */
export function sourceAddress(value?: string): string {
  if (!value || value.length > 100) return "unknown";
  const address = value.split("%")[0];
  if (!isIP(address)) return "unknown";
  if (isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
export const count = z.number().int().nonnegative().safe();
const timestamp = z.iso.datetime();
const address = z.string().max(100).refine(value => sourceAddress(value) === value);
const summary = z.object({ address, firstSeen: timestamp, lastSeen: timestamp, total: count, applicationRequests: count, selfChecks: count, chats: count, models: count, health: count, other: count, failed: count, cancelled: count, responseBytes: count });
const diagnostic = z.object({ type: z.string().max(200), message: z.string().max(12000), code: z.string().max(200).optional(), stack: z.string().max(16000).optional(), phase: z.string().max(40) });
export const timelineEvent = z.object({ atMs: count, phase: z.enum(["received", "queued", "preparing", "upstream", "upstream-failed", "streaming", "completed", "failed", "cancelled"]), model: modelName.nullable().optional() });
export const entry = z.object({ apiKeyId: z.union([z.uuid(), z.literal("legacy")]).nullable().default(null), apiKeyLabel: z.string().max(100).nullable().default(null), timeline: z.array(timelineEvent).max(128).default([]), timelineTruncated: z.boolean().default(false), diagnostic: diagnostic.nullable().default(null), firstByteMs: count.nullable().default(null), queueMs: count.nullable().default(null), upstreamAttempts: count.default(0), upstreamFailures: count.default(0), id: z.uuid(), address, receivedAt: timestamp, method: z.enum(["GET", "POST", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE", "OTHER"]), endpoint: z.enum(["/v1/models", "/v1/chat/completions", "/health", "/health/live", "/health/ready", "/v1/proxy/model-check", "/v1/responses", "/v1/messages", "/messages", "(other endpoint)"]), source: z.enum(["application", "self-check"]), status: z.number().int().min(100).max(599), outcome: z.enum(["success", "error", "cancelled"]), responseBytes: count, durationMs: count, model: modelName.nullable().default(null), servedModel: modelName.nullable().default(null), clientSoftware: z.enum(["unknown","OpenAI Python","OpenAI Node","OpenClaw","Claude Code","pi","Python HTTPX","Python Requests","curl","Axios","Web browser","PowerShell","Node.js"]).default("unknown"), streamed: z.boolean().nullable().default(null), applicationStatus: z.number().int().min(100).max(599).nullable().default(null) });
export const legacySchema = z.object({ version: z.literal(1), startedAt: timestamp, systems: z.array(summary).max(512), recent: z.array(entry).max(500) });
export type SavedRequest = z.infer<typeof entry>;
export const activityQuery = z.object({ requestKind: z.enum(["all", "chat", "errors", "checks"]).default("all"), requestKey: z.union([z.uuid(), z.literal("legacy"), z.literal("unattributed")]).optional(), checkOffset: z.coerce.number().int().min(0).max(10000000).default(0), checkLimit: z.coerce.number().int().min(1).max(100).default(20), checkKind: z.enum(["all", "identity", "function-tool", "shell-tool", "tool-roundtrip", "streaming", "json", "instructions", "multi-turn"]).default("all"), errorOffset: z.coerce.number().int().min(0).max(10000000).default(0), errorLimit: z.coerce.number().int().min(1).max(100).default(20), range: z.enum(['24h','7d','30d','90d','365d','all']).default('all'), address: z.string().refine(value => sourceAddress(value) === value).optional(), offset: z.coerce.number().int().min(0).max(10000000).default(0), model: modelName.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
export type ActivityQuery = z.infer<typeof activityQuery>;
export function parseActivityQuery(params: URLSearchParams): ActivityQuery { return activityQuery.parse(Object.fromEntries(params)); }
