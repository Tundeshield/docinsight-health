// Feature flag and plan limits.
//
// config/flags  { billingEnabled: false, pilotLimits: { questions, ocrPages, documents } }
// orgs/{id}     { plan, billingExempt, billing: { status, ... } }
//
// The paywall is ON by default: a hospital must have an active plan to use DocInsight.
// paymentProvider decides how plans are paid for:
//   "dummy"    a test checkout that activates the plan without taking money (until a provider is chosen)
//   "paystack" real Paystack subscriptions
// Hospitals marked billingExempt (pilot / founding partners) skip the paywall and get pilotLimits.
// Setting billingEnabled to false puts every hospital on the free pilot.
import { HttpsError } from "firebase-functions/v2/https";
import { db, monthKey } from "./admin.js";

export const DEFAULT_FLAGS = {
  billingEnabled: true,
  paymentProvider: "dummy",
  pilotLimits: { questions: 3000, ocrPages: 3000, documents: null }
};

export const DEFAULT_PLANS = {
  clinic: { name: "Clinic", priceLabel: "$149/month", description: "Private clinics and small hospitals", paystackPlan: "", limits: { questions: 750, ocrPages: 300, documents: 50 } },
  hospital: { name: "Hospital", priceLabel: "$499/month", description: "Mid-size private hospitals", paystackPlan: "", limits: { questions: 3000, ocrPages: 2000, documents: null } },
  enterprise: { name: "Enterprise", priceLabel: "From $1,500/month", description: "Teaching hospitals, groups and HMOs", paystackPlan: "", contactOnly: true, limits: { questions: null, ocrPages: null, documents: null } }
};

let flagCache = { at: 0, value: DEFAULT_FLAGS };
export async function getFlags() {
  if (Date.now() - flagCache.at < 60_000) return flagCache.value;
  const snap = await db.doc("config/flags").get();
  const value = { ...DEFAULT_FLAGS, ...(snap.exists ? snap.data() : {}) };
  value.pilotLimits = { ...DEFAULT_FLAGS.pilotLimits, ...(value.pilotLimits || {}) };
  flagCache = { at: Date.now(), value };
  return value;
}

export async function getPlans() {
  const snap = await db.doc("config/plans").get();
  const custom = snap.exists ? snap.data() : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_PLANS)) out[k] = { ...DEFAULT_PLANS[k], ...(custom[k] || {}), limits: { ...DEFAULT_PLANS[k].limits, ...(custom[k]?.limits || {}) } };
  return out;
}

export const billingActive = (org, flags) => !!flags.billingEnabled && !org.billingExempt;

/** Paid up: active status and, when the period end is known, not past it. */
export function hasActivePlan(org) {
  const b = org.billing || {};
  if (!["active", "non-renewing"].includes(b.status)) return false;
  const end = b.currentPeriodEnd?.toMillis ? b.currentPeriodEnd.toMillis() : b.currentPeriodEnd ? new Date(b.currentPeriodEnd).getTime() : null;
  return !end || end > Date.now();
}

/** Throws a clear error when the org can't use more of `kind` (questions, ocrPages, documents). */
export async function checkAllowance(org, kind, amount = 1) {
  const flags = await getFlags();
  let limits;
  if (!billingActive(org, flags)) limits = flags.pilotLimits;
  else {
    if (!hasActivePlan(org)) {
      throw new HttpsError("failed-precondition", "Your hospital needs an active plan to continue. A library manager can choose one on the Billing page.", { reason: "no_plan" });
    }
    const plans = await getPlans();
    limits = (plans[org.plan] || plans.clinic).limits;
  }
  const cap = limits?.[kind];
  if (cap == null) return { ok: true, remaining: null };
  let used;
  if (kind === "documents") used = (await db.collection(`orgs/${org.id}/sources`).count().get()).data().count;
  else { const u = await db.doc(`orgs/${org.id}/usage/${monthKey()}`).get(); used = u.exists ? (u.data()[kind] || 0) : 0; }
  if (used + amount > cap) {
    const what = { questions: "questions this month", ocrPages: "scanned pages this month", documents: "documents" }[kind];
    throw new HttpsError("resource-exhausted", `Your hospital has reached its limit of ${cap} ${what}. ${billingActive(org, flags) ? "A library manager can upgrade on the Billing page." : "Contact Avelon to raise it."}`, { reason: "limit", kind, cap });
  }
  return { ok: true, remaining: cap - used };
}
