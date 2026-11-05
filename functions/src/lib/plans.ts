// Plans, billing configuration and usage counters. Limits come from Firestore (plans/*,
// config/billing) so they change without code changes; shared/src/config.ts holds the seeds.
import type { BillingConfig, Institution, Plan, PlanId, PlatformConfig, UsageMonth } from "../../../shared/src/types";
import { DEFAULT_BILLING_CONFIG, DEFAULT_PLANS, DEFAULT_PLATFORM_CONFIG } from "../../../shared/src/config";
import { limitState, seatLimit } from "../../../shared/src/billing";
import { db, FieldValue, monthKey } from "./admin";
import { fail } from "./errors";

let cache: { at: number; plans: Plan[]; billing: BillingConfig; platform: PlatformConfig } | null = null;

export async function loadConfig() {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const [plansSnap, billingSnap, platformSnap] = await Promise.all([db.collection("plans").get(), db.doc("config/billing").get(), db.doc("config/platform").get()]);
  const plans = DEFAULT_PLANS.map((p) => ({ ...p, ...(plansSnap.docs.find((d) => d.id === p.id)?.data() ?? {}) }) as Plan);
  const billing = { ...DEFAULT_BILLING_CONFIG, ...(billingSnap.data() ?? {}) } as BillingConfig;
  const platform = { ...DEFAULT_PLATFORM_CONFIG, ...(platformSnap.data() ?? {}) } as PlatformConfig;
  cache = { at: Date.now(), plans, billing, platform };
  return cache;
}

export async function getPlan(id: PlanId): Promise<Plan> {
  const { plans } = await loadConfig();
  const p = plans.find((x) => x.id === id);
  if (!p) throw fail.invalid("Unknown plan.");
  return p;
}

export async function usage(instId: string, month = monthKey()): Promise<UsageMonth> {
  const s = await db.doc(`institutions/${instId}/usage/${month}`).get();
  return { questions: 0, notFound: 0, searches: 0, ocrPages: 0, embeddedChunks: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, ...(s.data() ?? {}) } as UsageMonth;
}

export async function addUsage(instId: string, inc: Partial<Record<keyof UsageMonth, number>>): Promise<void> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inc)) if (v) data[k] = FieldValue.increment(v);
  if (Object.keys(data).length) await db.doc(`institutions/${instId}/usage/${monthKey()}`).set(data, { merge: true });
}

export async function seatState(institution: Institution) {
  const plan = await getPlan(institution.planId);
  const limit = seatLimit(plan, institution.extraSeats ?? 0);
  const used = (await db.collection(`institutions/${institution.id}/members`).where("status", "==", "active").count().get()).data().count;
  return { used, limit, state: limitState(used, limit, 100) };
}

/** Blocks new invites when the plan's seats are full. */
export async function requireSeats(institution: Institution, adding = 1): Promise<void> {
  const { used, limit } = await seatState(institution);
  if (limit != null && used + adding > limit) {
    throw fail.limit(`Your ${institution.planId} plan includes ${limit} staff seats and ${used} are in use. The owner can add seats or upgrade on the Billing page.`, { reason: "seats", used, limit });
  }
}

export async function docState(institution: Institution) {
  const plan = await getPlan(institution.planId);
  const { billing } = await loadConfig();
  const used = (await db.collection(`institutions/${institution.id}/content`).where("status", "!=", "archived").count().get()).data().count;
  return { used, limit: plan.docLimit, state: limitState(used, plan.docLimit, billing.warnAtPct) };
}

export async function requireDocRoom(institution: Institution): Promise<void> {
  const s = await docState(institution);
  if (s.state === "blocked") throw fail.limit(`Your plan includes ${s.limit} documents and the library is full. Archive old documents or upgrade on the Billing page.`, { reason: "documents", ...s });
}

export async function questionState(institution: Institution) {
  const plan = await getPlan(institution.planId);
  const { billing } = await loadConfig();
  const u = await usage(institution.id);
  return { used: u.questions, limit: plan.aiQuestionLimit, state: limitState(u.questions, plan.aiQuestionLimit, billing.warnAtPct) };
}

export function costMicros(prices: BillingConfig["modelPrices"], model: string, input: number, output: number): number {
  const p = prices[model];
  if (!p) return 0;
  return Math.round((input * p.input + output * p.output) / 1_000_000);
}
