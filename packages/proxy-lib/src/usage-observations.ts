import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { CONFIG_DIR, atomicWritePrivate, authenticationAccountKey, getAvailableModels, METERED_BUDGETS, createLogger, type MeteredBudget } from "@m365-copilot/core";

const observation = z.object({ at: z.number().finite(), daily: z.number().finite().nonnegative().optional(), weekly: z.number().finite().nonnegative().optional() });
const route = z.object({ at: z.number().finite(), requested: z.string().max(100), served: z.string().max(100) });
const schema = z.object({ version: z.literal(1), budgets: z.object({ opus: observation.optional(), "sonnet-5.5": observation.optional() }), route: route.optional() });
type State = z.infer<typeof schema>;
// A count stays true until its budget resets: the daily one at UTC midnight, the weekly one on Monday 00:00 UTC.
// The route is only a "last seen" record, so it ages out after a week.
const notFuture = (at: number, now: number) => at <= now + 30_000;
const sameDay = (at: number, now: number) => new Date(at).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
const weekStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7); };
const sameWeek = (at: number, now: number) => weekStart(at) === weekStart(now);
const freshRoute = (at: number, now: number) => notFuture(at, now) && at > now - 7 * 24 * 60 * 60_000;
const log = createLogger("observations");

/** No tokens, prompts, tool data or raw upstream messages are accepted here. */
export class UsageObservations {
  private account: string | null = null;
  private state: State = { version: 1, budgets: {} };
  constructor(private directory = CONFIG_DIR) {}
  private select(account: string | null) {
    if (account !== null && !/^[a-f0-9]{64}$/.test(account)) throw new Error("Invalid observation account key");
    if (this.account === account) return;
    this.account = account;
    this.state = { version: 1, budgets: {} };
    if (!account) return;
    const path = join(this.directory, `quota-observations-${account}.json`);
    try {
      if (statSync(path).size > 16_384) return;
      this.state = schema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch { /* Absent/corrupt observations are unknown, never an auth/chat failure. */ }
  }
  snapshot(account: string | null, now = Date.now()) {
    this.select(account);
    const budgets: Partial<Record<MeteredBudget, z.infer<typeof observation>>> = {};
    for (const key of Object.keys(METERED_BUDGETS) as MeteredBudget[]) {
      const value = this.state.budgets[key];
      if (!value || !notFuture(value.at, now)) continue;
      const daily = sameDay(value.at, now) ? value.daily : undefined;
      const weekly = sameWeek(value.at, now) ? value.weekly : undefined;
      if (daily !== undefined || weekly !== undefined) budgets[key] = { at: value.at, ...(daily !== undefined ? { daily } : {}), ...(weekly !== undefined ? { weekly } : {}) };
    }
    const known = getAvailableModels();
    const route = this.state.route;
    return { budgets, route: route && freshRoute(route.at, now) && known.includes(route.requested) && known.includes(route.served) ? { ...route, fallbackUsed: route.requested !== route.served } : null };
  }
  record(account: string | null, requested: string, served: string, metering?: Record<string, number> | null, now = Date.now()) {
    this.select(account);
    if (!account) return;
    const current = this.snapshot(account, now);
    this.state = { version: 1, budgets: current.budgets };
    const known = getAvailableModels();
    if (known.includes(requested) && known.includes(served)) this.state.route = { at: now, requested, served };
    for (const [key, definition] of Object.entries(METERED_BUDGETS)) {
      const daily = metering?.[definition.daily];
      const weekly = metering?.[definition.weekly];
      const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
      if (valid(daily) || valid(weekly)) this.state.budgets[key as MeteredBudget] = { at: now, ...(valid(daily) ? { daily } : {}), ...(valid(weekly) ? { weekly } : {}) };
    }
    try { atomicWritePrivate(join(this.directory, `quota-observations-${account}.json`), JSON.stringify(this.state) + "\n"); }
    catch { log.error("Could not save quota observations; chat delivery is unaffected. Check data-directory permissions and disk space."); }
  }
}

export const usageObservations = new UsageObservations();
export function recordUsageObservation(requested: string, served: string, metering?: Record<string, number> | null) {
  usageObservations.record(authenticationAccountKey(), requested, served, metering);
}
