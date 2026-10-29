// Billing. The paywall is controlled by config/flags (see plans.js).
// paymentProvider "dummy": a test checkout that activates plans without charging anyone.
// paymentProvider "paystack": real subscriptions; put Paystack plan codes in config/plans.
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import crypto from "node:crypto";
import { db, FieldValue, monthKey } from "./admin.js";
import { PAYSTACK_SECRET_KEY, APP_URL } from "./config.js";
import { requireAuth, requireMember, MANAGER_ROLES } from "./access.js";
import { getFlags, getPlans, billingActive, hasActivePlan } from "./plans.js";

async function paystack(pathname, { method = "GET", body } = {}) {
  const r = await fetch(`https://api.paystack.co${pathname}`, { method, headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.status === false) throw new HttpsError("unavailable", json.message || "Paystack couldn't process this right now. Try again shortly.");
  return json.data;
}

/** What the Billing page shows: whether billing applies, plans, current plan and this month's usage. */
export const getBillingOverview = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId } = request.data || {};
  const { org } = await requireMember(uid, orgId, MANAGER_ROLES);
  const [flags, plans, usage] = await Promise.all([getFlags(), getPlans(), db.doc(`orgs/${orgId}/usage/${monthKey()}`).get()]);
  const active = billingActive(org, flags);
  const visiblePlans = Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, { name: p.name, priceLabel: p.priceLabel, description: p.description, limits: p.limits, contactOnly: !!p.contactOnly, available: flags.paymentProvider === "paystack" ? !!p.paystackPlan : true }]));
  const b = org.billing || { status: "none" };
  return {
    billingActive: active, provider: flags.paymentProvider || "dummy", exempt: !!org.billingExempt, plan: org.plan, paid: hasActivePlan(org),
    billing: { status: b.status || "none", currentPeriodEnd: b.currentPeriodEnd?.toMillis?.() || null, subscriptionCode: b.subscriptionCode || null },
    limits: active ? (plans[org.plan]?.limits || null) : flags.pilotLimits,
    usage: usage.exists ? { questions: usage.data().questions || 0, ocrPages: usage.data().ocrPages || 0 } : { questions: 0, ocrPages: 0 },
    plans: active ? visiblePlans : null
  };
});

export const startCheckout = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const { orgId, plan } = request.data || {};
  const { org } = await requireMember(uid, orgId, MANAGER_ROLES);
  if (!billingActive(org, await getFlags())) throw new HttpsError("failed-precondition", "Your hospital is on the free pilot, so there's nothing to pay.");
  const flags = await getFlags();
  const p = (await getPlans())[plan];
  if (!p || p.contactOnly) throw new HttpsError("invalid-argument", "That plan isn't available to buy online. Contact Avelon.");
  if ((flags.paymentProvider || "dummy") === "dummy") {
    const ref = db.collection("checkouts").doc();
    await ref.set({ orgId, plan, uid, status: "open", provider: "dummy", priceLabel: p.priceLabel, planName: p.name, orgName: org.name, createdAt: FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + 30 * 60000) });
    return { url: `/app/checkout/${ref.id}` };
  }
  if (!p.paystackPlan) throw new HttpsError("invalid-argument", "That plan isn't available to buy online yet. Contact Avelon.");
  const email = request.auth.token.email;
  if (!email) throw new HttpsError("failed-precondition", "Your account needs an email address to pay.");
  const data = await paystack("/transaction/initialize", { method: "POST", body: {
    email, amount: 100, plan: p.paystackPlan, callback_url: `${APP_URL.value()}/app/billing?paid=1`,
    metadata: { orgId, plan, uid, cancel_action: `${APP_URL.value()}/app/billing` }
  } });
  return { url: data.authorization_url };
});

export const manageSubscription = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const { orgId } = request.data || {};
  const { org } = await requireMember(uid, orgId, MANAGER_ROLES);
  const code = org.billing?.subscriptionCode;
  if (!code) throw new HttpsError("failed-precondition", "There's no subscription to manage yet.");
  const data = await paystack(`/subscription/${code}/manage/link`);
  return { url: data.link };
});

/** Paystack calls this. Set the URL in Paystack → Settings → API Keys & Webhooks. */
export const paystackWebhook = onRequest({ secrets: [PAYSTACK_SECRET_KEY] }, async (req, res) => {
  const sig = req.headers["x-paystack-signature"];
  const expected = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY.value()).update(req.rawBody).digest("hex");
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) { res.status(401).send("bad signature"); return; }
  const { event, data } = req.body || {};
  try {
    const customerCode = data?.customer?.customer_code;
    let orgRef = null;
    const orgId = data?.metadata?.orgId;
    if (orgId) orgRef = db.doc(`orgs/${orgId}`);
    else if (customerCode) { const q = await db.collection("orgs").where("billing.customerCode", "==", customerCode).limit(1).get(); if (!q.empty) orgRef = q.docs[0].ref; }
    if (!orgRef) { logger.warn("paystack event without org", { event }); res.status(200).send("ok"); return; }

    const upd = { "billing.lastEvent": event, "billing.updatedAt": FieldValue.serverTimestamp() };
    if (customerCode) upd["billing.customerCode"] = customerCode;
    switch (event) {
      case "charge.success":
        if (data?.metadata?.plan) upd.plan = data.metadata.plan;
        upd["billing.status"] = "active"; upd["billing.lastPaymentAt"] = FieldValue.serverTimestamp(); break;
      case "subscription.create":
        upd["billing.status"] = "active"; upd["billing.subscriptionCode"] = data.subscription_code;
        upd["billing.nextPaymentDate"] = data.next_payment_date || null; break;
      case "subscription.not_renew": upd["billing.status"] = "non-renewing"; break;
      case "subscription.disable": upd["billing.status"] = "cancelled"; break;
      case "invoice.payment_failed": upd["billing.status"] = "past_due"; break;
      case "invoice.update": if (data?.paid) upd["billing.status"] = "active"; break;
      default: break;
    }
    await orgRef.update(upd);
    res.status(200).send("ok");
  } catch (e) { logger.error("webhook", e.message); res.status(500).send("error"); }
});

/** Test checkout (paymentProvider "dummy"): details for the checkout page. */
export const getDummyCheckout = onCall(async (request) => {
  const uid = requireAuth(request);
  const snap = await db.doc(`checkouts/${String(request.data?.checkoutId || "x")}`).get();
  if (!snap.exists || snap.data().uid !== uid) throw new HttpsError("not-found", "This checkout link isn't valid. Start again from the Billing page.");
  const c = snap.data();
  return { planName: c.planName, priceLabel: c.priceLabel, orgName: c.orgName, status: c.status, expired: c.expiresAt.toDate() < new Date() };
});

/** Test checkout: completes the "payment". outcome "success" activates the plan for 30 days; "fail" marks it failed. */
export const completeDummyCheckout = onCall(async (request) => {
  const uid = requireAuth(request);
  const flags = await getFlags();
  if ((flags.paymentProvider || "dummy") !== "dummy") throw new HttpsError("failed-precondition", "Test checkout is switched off. Choose a plan again from the Billing page.");
  const ref = db.doc(`checkouts/${String(request.data?.checkoutId || "x")}`);
  const outcome = request.data?.outcome === "fail" ? "fail" : "success";
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().uid !== uid) throw new HttpsError("not-found", "This checkout link isn't valid. Start again from the Billing page.");
    const c = snap.data();
    if (c.status !== "open") throw new HttpsError("failed-precondition", "This checkout has already been used. Start again from the Billing page.");
    if (c.expiresAt.toDate() < new Date()) throw new HttpsError("failed-precondition", "This checkout expired. Start again from the Billing page.");
    const mem = await tx.get(db.doc(`orgs/${c.orgId}/members/${uid}`));
    if (!mem.exists || !MANAGER_ROLES.includes(mem.data().role)) throw new HttpsError("permission-denied", "Only library managers can pay for a plan.");
    tx.update(ref, { status: outcome === "success" ? "paid" : "failed", completedAt: FieldValue.serverTimestamp() });
    if (outcome === "success") {
      tx.update(db.doc(`orgs/${c.orgId}`), { plan: c.plan, "billing.status": "active", "billing.provider": "dummy", "billing.currentPeriodEnd": new Date(Date.now() + 30 * 864e5), "billing.lastPaymentAt": FieldValue.serverTimestamp(), "billing.updatedAt": FieldValue.serverTimestamp() });
    }
    return { outcome, orgId: c.orgId };
  });
});

/** Test checkout: cancel at the end of the current period. */
export const cancelDummySubscription = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId } = request.data || {};
  const { org } = await requireMember(uid, orgId, MANAGER_ROLES);
  if (org.billing?.provider !== "dummy") throw new HttpsError("failed-precondition", "Use Manage payment to change this subscription.");
  await db.doc(`orgs/${orgId}`).update({ "billing.status": "non-renewing", "billing.updatedAt": FieldValue.serverTimestamp() });
  return { ok: true };
});
