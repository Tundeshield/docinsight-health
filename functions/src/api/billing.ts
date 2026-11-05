// F12 billing and subscription: invoices, Paystack, bank transfer with admin confirmation,
// paid pilot, extra seats, cancellation. Prices and limits come from Firestore configuration.
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import crypto from "node:crypto";
import type { BillingCycle, Institution, Invoice, InvoiceLine, PlanId } from "../../../shared/src/types";
import { addPeriod, formatMoney, periodPrice, STATUS_LABEL } from "../../../shared/src/billing";
import { bucket, db, FieldValue, inst, Timestamp, toDate } from "../lib/admin";
import { requireMember, requirePlatformAdmin } from "../lib/access";
import { audit } from "../lib/audit";
import { fail, id, oneOf, reqStr, str } from "../lib/errors";
import { callable } from "../lib/fn";
import { sendEmail } from "../lib/email";
import { managers, notify } from "../lib/notify";
import { APP_URL, PAYSTACK_SECRET_KEY, RESEND_API_KEY, secretValue } from "../lib/params";
import { docState, getPlan, loadConfig, questionState, seatState } from "../lib/plans";
import { invoicePdf } from "../lib/pdf";
import { recomputeMembers } from "../lib/visibility";

const DAY = 86_400_000;
const invoices = (instId: string) => db.collection(`institutions/${instId}/invoices`);

async function nextInvoiceNumber(): Promise<string> {
  const { billing } = await loadConfig();
  const ref = db.doc("config/counters");
  const n = await db.runTransaction(async (tx) => {
    const cur = Number((await tx.get(ref)).data()?.invoiceSeq ?? 0) + 1;
    tx.set(ref, { invoiceSeq: cur }, { merge: true });
    return cur;
  });
  return `${billing.invoicePrefix}-${new Date().getUTCFullYear()}-${String(n).padStart(5, "0")}`;
}

async function writePdf(instId: string, invoice: Invoice, institution: Institution, kind: "invoice" | "receipt"): Promise<string> {
  const { billing } = await loadConfig();
  const buf = await invoicePdf(invoice, institution, billing, kind);
  const path = `inst/${instId}/invoices/${invoice.number}${kind === "receipt" ? "-receipt" : ""}.pdf`;
  await bucket().file(path).save(buf, { contentType: "application/pdf", resumable: false });
  return path;
}

export async function createInvoice(instId: string, data: { kind: Invoice["kind"]; lines: InvoiceLine[]; period?: { start: Date; end: Date } | null; planId?: PlanId | null; cycle?: BillingCycle | null; extendsTo?: Date | null; dueInDays?: number; meta?: Record<string, unknown> }, email = true): Promise<Invoice> {
  const institution = { id: instId, ...(await inst(instId).get()).data() } as Institution;
  const ref = invoices(instId).doc();
  const amount = data.lines.reduce((a, l) => a + l.amount, 0);
  const invoice: Invoice & { meta?: Record<string, unknown> } = {
    id: ref.id, number: await nextInvoiceNumber(), kind: data.kind, amount, currency: "NGN", lines: data.lines,
    period: data.period ? { start: Timestamp.fromDate(data.period.start), end: Timestamp.fromDate(data.period.end) } : null,
    planId: data.planId ?? null, cycle: data.cycle ?? null, extendsTo: data.extendsTo ? Timestamp.fromDate(data.extendsTo) : null,
    method: null, status: "open", paystackRef: null, issuedAt: Timestamp.now(), dueAt: Timestamp.fromMillis(Date.now() + (data.dueInDays ?? 7) * DAY),
    paidAt: null, confirmedBy: null, pdfRef: null, receiptRef: null, ...(data.meta && { meta: data.meta }),
  };
  invoice.pdfRef = await writePdf(instId, invoice, institution, "invoice");
  await ref.set(invoice);
  await audit({ instId, actorId: "system", actorName: "DocInsight billing", action: "billing.invoice", target: { type: "invoice", id: ref.id, title: invoice.number }, after: { amount: formatMoney(amount, "NGN"), kind: data.kind } });
  if (email && institution.billingContact?.email) {
    const [pdf] = await bucket().file(invoice.pdfRef).download();
    await sendEmail({
      to: institution.billingContact.email, subject: `DocInsight Health invoice ${invoice.number}: ${formatMoney(amount, "NGN")}`,
      lines: [`Invoice ${invoice.number} for ${institution.name} is attached: ${formatMoney(amount, "NGN")}, due ${invoice.dueAt.toDate().toDateString()}.`, "Pay by bank transfer using the invoice number as the reference, or by card, transfer or USSD from the Billing page."],
      button: { label: "Open billing", url: `${APP_URL.value()}/app/admin/billing` }, attachments: [{ filename: `${invoice.number}.pdf`, content: pdf.toString("base64") }],
    });
  }
  return invoice;
}

function subscriptionLines(planName: string, cycle: BillingCycle, amount: number, pilot: boolean, days?: number): InvoiceLine {
  const what = pilot ? `${planName} plan: ${days}-day paid pilot (50% of plan price)` : `${planName} plan: ${cycle === "annual" ? "12 months (pay 10, get 12)" : "1 month"}`;
  return { description: what, quantity: 1, unitAmount: amount, amount };
}

/** The first invoice for a new institution: setup fee plus the first period (or the paid pilot). */
export async function ensureOpeningInvoice(instId: string): Promise<void> {
  const snap = await inst(instId).get();
  const institution = { id: instId, ...snap.data() } as Institution;
  if (institution.status !== "pending_payment") return;
  const open = await invoices(instId).where("status", "==", "open").get();
  for (const d of open.docs) await d.ref.update({ status: "void" });
  const { billing } = await loadConfig();
  const plan = await getPlan(institution.planId);
  const lines: InvoiceLine[] = [];
  const pkg = billing.setupPackages.find((p) => p.id === institution.setupPackageId);
  if (pkg) lines.push({ description: `${pkg.name}: ${pkg.includes}`, quantity: 1, unitAmount: pkg.price, amount: pkg.price });
  const start = new Date();
  let end: Date;
  if (institution.pilot) {
    end = new Date(start.getTime() + billing.pilotDays * DAY);
    const amount = Math.round(plan.priceMonthly * (billing.pilotDays / 30) * (1 - institution.pilot.discountPct / 100) * (1 - (institution.discountPct ?? 0) / 100));
    lines.push(subscriptionLines(plan.name, "monthly", amount, true, billing.pilotDays));
  } else {
    end = addPeriod(start, institution.billingCycle);
    const amount = periodPrice(plan, institution.billingCycle, { discountPct: institution.discountPct });
    lines.push(subscriptionLines(plan.name, institution.billingCycle, amount, false));
  }
  await createInvoice(instId, { kind: lines.length > 1 ? "mixed" : institution.pilot ? "pilot" : "subscription", lines, period: { start, end }, planId: plan.id, cycle: institution.pilot ? "monthly" : institution.billingCycle, extendsTo: end, meta: { opening: true, periodDays: Math.round((end.getTime() - start.getTime()) / DAY) } });
}

/** Records a payment and moves the subscription forward. */
export async function applyPayment(instId: string, invoiceId: string, method: "paystack" | "bank_transfer", ref: string | null, confirmedBy: string): Promise<void> {
  const iref = invoices(instId).doc(invoiceId);
  const result = await db.runTransaction(async (tx) => {
    const [is, iv] = await Promise.all([tx.get(inst(instId)), tx.get(iref)]);
    const institution = { id: instId, ...is.data() } as Institution;
    const invoice = iv.data() as Invoice & { meta?: Record<string, unknown> };
    if (!invoice || invoice.status === "paid") return null;
    const update: Record<string, unknown> = {};
    if (invoice.extendsTo || invoice.period) {
      // A renewal extends from the later of now and the current period end
      const curEnd = toDate(institution.currentPeriodEnd);
      const from = curEnd && curEnd.getTime() > Date.now() && !invoice.meta?.opening ? curEnd : new Date();
      const days = Number(invoice.meta?.periodDays ?? 0);
      const newEnd = days ? new Date(from.getTime() + days * DAY) : addPeriod(from, invoice.cycle ?? institution.billingCycle);
      update.currentPeriodEnd = Timestamp.fromDate(newEnd);
      update.status = institution.status === "cancelled" ? "cancelled" : "active";
      update.pastDueSince = null;
      update.remindersSent = [];
      if (invoice.planId) update.planId = invoice.planId;
      if (invoice.cycle && !institution.pilot) update.billingCycle = invoice.cycle;
    }
    if (invoice.meta?.extraSeatBlocks) update.extraSeats = FieldValue.increment(Number(invoice.meta.extraSeatBlocks) * 10);
    if (invoice.meta?.pilotToAnnual) { update.pilot = null; update.billingCycle = "annual"; }
    update.statusChangedAt = FieldValue.serverTimestamp();
    tx.update(inst(instId), update);
    tx.update(iref, { status: "paid", method, paystackRef: ref, paidAt: Timestamp.now(), confirmedBy });
    return { institution, invoice, prevStatus: institution.status, newStatus: (update.status as string) ?? institution.status };
  });
  if (!result) return;
  const fresh = { id: instId, ...(await inst(instId).get()).data() } as Institution;
  const paid = { ...result.invoice, status: "paid" as const, method, paystackRef: ref, paidAt: Timestamp.now() };
  const receiptRef = await writePdf(instId, paid, fresh, "receipt");
  await iref.update({ receiptRef });
  await recomputeMembers(instId);
  await audit({ instId, actorId: confirmedBy, actorName: confirmedBy === "paystack" ? "Paystack" : "DocInsight billing", action: "billing.payment", target: { type: "invoice", id: invoiceId, title: result.invoice.number }, before: { status: result.prevStatus }, after: { status: result.newStatus, amount: formatMoney(result.invoice.amount, "NGN"), method, reference: ref } });
  if (fresh.billingContact?.email) {
    const [pdf] = await bucket().file(receiptRef).download();
    await sendEmail({ to: fresh.billingContact.email, subject: `Payment received: ${result.invoice.number}`, lines: [`We've received ${formatMoney(result.invoice.amount, "NGN")} for ${fresh.name}. Thank you.`, result.prevStatus === "pending_payment" ? "Your DocInsight subscription is now active: you can invite staff." : `Your subscription is active until ${toDate(fresh.currentPeriodEnd)?.toDateString() ?? ""}.`], attachments: [{ filename: `${result.invoice.number}-receipt.pdf`, content: pdf.toString("base64") }] });
  }
}

async function requireBillingOwner(req: Parameters<typeof requireMember>[0], instId: unknown) {
  const ctx = await requireMember(req, instId, { allowPlatform: true });
  if (!ctx.isOwner && !ctx.platformAdmin) throw fail.denied("Only the institution owner manages billing.");
  return ctx;
}

export const getBillingSummary = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { allowPlatform: true });
  if (!ctx.isManager) throw fail.denied();
  const { plans, billing } = await loadConfig();
  const [seats, docs, questions] = await Promise.all([seatState(ctx.inst), docState(ctx.inst), questionState(ctx.inst)]);
  const open = ctx.isOwner || ctx.platformAdmin ? (await invoices(ctx.instId).where("status", "==", "open").get()).docs.map((d) => d.data() as Invoice) : [];
  return {
    status: ctx.inst.status, statusLabel: STATUS_LABEL[ctx.inst.status], planId: ctx.inst.planId, billingCycle: ctx.inst.billingCycle,
    currentPeriodEnd: toDate(ctx.inst.currentPeriodEnd)?.toISOString() ?? null, pastDueSince: toDate(ctx.inst.pastDueSince)?.toISOString() ?? null,
    pilot: ctx.inst.pilot ? { endsAt: toDate(ctx.inst.pilot.endsAt)?.toISOString(), discountPct: ctx.inst.pilot.discountPct } : null,
    discountPct: ctx.inst.discountPct ?? 0, cancelAtPeriodEnd: !!(ctx.inst as Institution & { cancelAtPeriodEnd?: boolean }).cancelAtPeriodEnd,
    seats, docs, questions, plans: plans.filter((p) => p.active), setupPackages: billing.setupPackages,
    paystackEnabled: billing.paystackEnabled && !!secretValue(PAYSTACK_SECRET_KEY), bankTransfer: billing.bankTransfer,
    openInvoices: open.map((i) => ({ id: i.id, number: i.number, amount: i.amount, currency: i.currency, dueAt: i.dueAt.toDate().toISOString(), method: i.method, kind: i.kind })),
    isOwner: ctx.isOwner || ctx.platformAdmin,
  };
}, { secrets: [PAYSTACK_SECRET_KEY] });

/** Card, bank transfer or USSD through Paystack checkout. */
export const startPaystackPayment = callable(async (req) => {
  const ctx = await requireBillingOwner(req, req.data.instId);
  const key = secretValue(PAYSTACK_SECRET_KEY);
  const { billing } = await loadConfig();
  if (!key || !billing.paystackEnabled) throw fail.precondition("Online payment isn't switched on yet. Pay by bank transfer using the details on the invoice.");
  const invoice = (await invoices(ctx.instId).doc(id(req.data.invoiceId, "invoice")).get()).data() as Invoice | undefined;
  if (!invoice || invoice.status !== "open") throw fail.notFound("This invoice is already paid or was replaced.");
  const plan = invoice.planId ? await getPlan(invoice.planId) : null;
  const recurring = req.data.recurring === true && plan && invoice.kind === "subscription";
  const planCode = recurring ? (invoice.cycle === "annual" ? plan!.paystackPlanCodeAnnual : plan!.paystackPlanCodeMonthly) : undefined;
  const r = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ctx.inst.billingContact?.email || ctx.c.email, amount: invoice.amount, currency: invoice.currency, reference: `${invoice.number}-${Date.now()}`,
      callback_url: `${APP_URL.value()}/app/admin/billing?paid=${invoice.id}`, channels: ["card", "bank", "ussd", "bank_transfer"],
      ...(planCode && { plan: planCode }), metadata: { instId: ctx.instId, invoiceId: invoice.id, number: invoice.number },
    }),
  });
  const json = (await r.json()) as { status: boolean; message: string; data?: { authorization_url: string } };
  if (!json.status || !json.data) throw fail.unavailable(json.message || "Paystack couldn't start the payment. Try again or pay by bank transfer.");
  return { url: json.data.authorization_url };
}, { secrets: [PAYSTACK_SECRET_KEY] });

export const chooseBankTransfer = callable(async (req) => {
  const ctx = await requireBillingOwner(req, req.data.instId);
  const iref = invoices(ctx.instId).doc(id(req.data.invoiceId, "invoice"));
  const invoice = (await iref.get()).data() as Invoice | undefined;
  if (!invoice || invoice.status !== "open") throw fail.notFound();
  await iref.update({ method: "bank_transfer" });
  const { platform, billing } = await loadConfig();
  await sendEmail({ to: platform.alertEmails, subject: `[DocInsight] Bank transfer expected: ${ctx.inst.name} ${invoice.number}`, lines: [`${ctx.inst.name} will pay ${formatMoney(invoice.amount, "NGN")} by bank transfer with reference ${invoice.number}.`, "Confirm it in the platform console when it arrives."] });
  return { bankTransfer: billing.bankTransfer, number: invoice.number, amount: invoice.amount };
});

export const changePlan = callable(async (req) => {
  const ctx = await requireBillingOwner(req, req.data.instId);
  const planId = oneOf(req.data.planId, ["clinic", "hospital", "group"] as const, ctx.inst.planId);
  const cycle = oneOf(req.data.billingCycle, ["monthly", "annual"] as const, ctx.inst.billingCycle);
  const plan = await getPlan(planId);
  if (plan.quoted && !ctx.platformAdmin) {
    const { platform } = await loadConfig();
    await sendEmail({ to: platform.alertEmails, subject: `[DocInsight] ${plan.name} plan request: ${ctx.inst.name}`, lines: [`${ctx.member.name} (${ctx.c.email}) asked about the ${plan.name} plan for ${ctx.inst.name}.`] });
    return { requested: true, message: `The ${plan.name} plan is quoted for each hospital group. We've let the DocInsight team know and they'll contact you.` };
  }
  if (plan.seatLimit != null) {
    const seats = await seatState({ ...ctx.inst, planId });
    if (seats.used > plan.seatLimit + (ctx.inst.extraSeats ?? 0)) throw fail.precondition(`You have ${seats.used} active staff, more than the ${plan.name} plan's ${plan.seatLimit} seats. Remove people or add seats first.`);
  }
  await inst(ctx.instId).update({ planId, billingCycle: cycle });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "billing.plan", target: { type: "institution", id: ctx.instId, title: ctx.inst.name }, before: { planId: ctx.inst.planId, billingCycle: ctx.inst.billingCycle }, after: { planId, billingCycle: cycle } });
  if (ctx.inst.status === "pending_payment") await ensureOpeningInvoice(ctx.instId);
  return { requested: false, message: ctx.inst.status === "pending_payment" ? "Your first invoice has been updated." : "Your new plan applies now. Your next invoice uses the new price." };
});

export const buySeats = callable(async (req) => {
  const ctx = await requireBillingOwner(req, req.data.instId);
  const blocks = Math.max(1, Math.min(50, Math.floor(Number(req.data.blocks) || 1)));
  const plan = await getPlan(ctx.inst.planId);
  if (plan.seatLimit == null) throw fail.precondition("Your plan already includes unlimited staff.");
  const end = toDate(ctx.inst.currentPeriodEnd);
  const monthsLeft = end ? Math.max(1, Math.ceil((end.getTime() - Date.now()) / (30 * DAY))) : 1;
  const unit = plan.extraSeatBlockPrice * monthsLeft;
  const invoice = await createInvoice(ctx.instId, { kind: "seats", lines: [{ description: `${blocks * 10} extra staff seats (${blocks} block${blocks > 1 ? "s" : ""} of 10) for ${monthsLeft} month${monthsLeft > 1 ? "s" : ""}`, quantity: blocks, unitAmount: unit, amount: unit * blocks }], meta: { extraSeatBlocks: blocks } });
  return { invoiceId: invoice.id };
});

export const cancelSubscription = callable(async (req) => {
  const ctx = await requireBillingOwner(req, req.data.instId);
  const undo = req.data.undo === true;
  await inst(ctx.instId).update({ cancelAtPeriodEnd: !undo });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "billing.plan", target: { type: "institution", id: ctx.instId, title: ctx.inst.name }, after: { cancelAtPeriodEnd: !undo } });
  return { ok: true };
});

// ---------- Platform admin (Tunde and Avelon staff) ----------

export const platformConfirmPayment = callable(async (req) => {
  const c = await requirePlatformAdmin(req);
  const instId = id(req.data.instId, "institution");
  await applyPayment(instId, id(req.data.invoiceId, "invoice"), "bank_transfer", str(req.data.reference, 100) || null, c.uid);
  return { ok: true };
});

export const platformIssueInvoice = callable(async (req) => {
  await requirePlatformAdmin(req);
  const instId = id(req.data.instId, "institution");
  const kind = oneOf(req.data.kind, ["subscription", "setup", "seats", "pages", "mixed"] as const, "mixed");
  const lines = ((Array.isArray(req.data.lines) ? req.data.lines : []) as Record<string, unknown>[]).slice(0, 20).map((l) => {
    const quantity = Math.max(1, Math.floor(Number(l.quantity) || 1));
    const unitAmount = Math.round(Number(l.unitAmount) || 0);
    return { description: reqStr(l.description, 300, "a description"), quantity, unitAmount, amount: quantity * unitAmount };
  });
  if (!lines.length) throw fail.invalid("Add at least one invoice line.");
  const institution = (await inst(instId).get()).data() as Institution;
  const extends_ = req.data.extendsPeriod === true;
  const start = toDate(institution.currentPeriodEnd) ?? new Date();
  const end = addPeriod(start, institution.billingCycle);
  const invoice = await createInvoice(instId, { kind, lines, ...(extends_ && { period: { start, end }, extendsTo: end, planId: institution.planId, cycle: institution.billingCycle }) });
  return { invoiceId: invoice.id };
});

export const platformVoidInvoice = callable(async (req) => {
  const c = await requirePlatformAdmin(req);
  const instId = id(req.data.instId, "institution");
  const iref = invoices(instId).doc(id(req.data.invoiceId, "invoice"));
  await iref.update({ status: "void", confirmedBy: c.uid });
  return { ok: true };
});

export const platformUpdateBilling = callable(async (req) => {
  const c = await requirePlatformAdmin(req);
  const instId = id(req.data.instId, "institution");
  const before = (await inst(instId).get()).data() as Institution;
  const { billing } = await loadConfig();
  const update: Record<string, unknown> = {};
  if (req.data.planId !== undefined) update.planId = oneOf(req.data.planId, ["clinic", "hospital", "group"] as const, before.planId);
  if (req.data.billingCycle !== undefined) update.billingCycle = oneOf(req.data.billingCycle, ["monthly", "annual"] as const, before.billingCycle);
  if (req.data.discountPct !== undefined) update.discountPct = Math.max(0, Math.min(100, Number(req.data.discountPct) || 0));
  if (req.data.extraSeats !== undefined) update.extraSeats = Math.max(0, Math.floor(Number(req.data.extraSeats) || 0));
  if (req.data.pilot !== undefined) update.pilot = req.data.pilot ? { startedAt: Timestamp.now(), endsAt: Timestamp.fromMillis(Date.now() + billing.pilotDays * DAY), discountPct: billing.pilotDiscountPct } : null;
  if (req.data.setupPackageId !== undefined) update.setupPackageId = req.data.setupPackageId === "large" ? "large" : req.data.setupPackageId === "standard" ? "standard" : null;
  if (req.data.status !== undefined) {
    update.status = oneOf(req.data.status, ["pending_payment", "active", "past_due", "restricted", "suspended", "cancelled"] as const, before.status);
    update.statusChangedAt = FieldValue.serverTimestamp();
    if (update.status === "cancelled") update.cancelledAt = FieldValue.serverTimestamp();
    if (update.status === "active" && !before.currentPeriodEnd) update.currentPeriodEnd = Timestamp.fromDate(addPeriod(new Date(), (update.billingCycle as BillingCycle) ?? before.billingCycle));
  }
  await inst(instId).update(update);
  await audit({ instId, actorId: c.uid, actorName: "DocInsight", action: req.data.discountPct !== undefined ? "billing.discount" : req.data.pilot !== undefined ? "billing.pilot" : "billing.plan", target: { type: "institution", id: instId, title: before.name }, before: Object.fromEntries(Object.keys(update).map((k) => [k, (before as unknown as Record<string, unknown>)[k] ?? null])), after: update });
  if (update.status) await recomputeMembers(instId);
  if (before.status === "pending_payment" && (update.pilot !== undefined || update.planId || update.billingCycle || update.setupPackageId !== undefined || update.discountPct !== undefined)) await ensureOpeningInvoice(instId);
  return { ok: true };
});

/** Annual contract after a pilot: the pilot fees paid are credited against the first year. */
export const platformConvertPilot = callable(async (req) => {
  await requirePlatformAdmin(req);
  const instId = id(req.data.instId, "institution");
  const institution = { id: instId, ...(await inst(instId).get()).data() } as Institution;
  if (!institution.pilot) throw fail.precondition("This institution isn't on a pilot.");
  const plan = await getPlan(institution.planId);
  const paidPilot = (await invoices(instId).where("status", "==", "paid").get()).docs.map((d) => d.data() as Invoice)
    .flatMap((i) => i.lines.filter((l) => /paid pilot/.test(l.description))).reduce((a, l) => a + l.amount, 0);
  const annual = periodPrice(plan, "annual", { discountPct: institution.discountPct });
  const start = toDate(institution.currentPeriodEnd) ?? new Date();
  const end = addPeriod(start, "annual");
  const lines: InvoiceLine[] = [{ description: `${plan.name} plan: 12 months (pay 10, get 12)`, quantity: 1, unitAmount: annual, amount: annual }];
  if (paidPilot) lines.push({ description: "Credit: pilot fees paid", quantity: 1, unitAmount: -paidPilot, amount: -paidPilot });
  const invoice = await createInvoice(instId, { kind: "subscription", lines, period: { start, end }, extendsTo: end, planId: plan.id, cycle: "annual", meta: { pilotToAnnual: true } });
  return { invoiceId: invoice.id };
});

/** Paystack webhook: set its URL in Paystack → Settings → API Keys & Webhooks. */
export const paystackWebhook = onRequest({ region: "europe-west1", secrets: [PAYSTACK_SECRET_KEY, RESEND_API_KEY] }, async (req, res) => {
  const key = secretValue(PAYSTACK_SECRET_KEY);
  const sig = String(req.headers["x-paystack-signature"] ?? "");
  if (!key) { res.status(503).send("not configured"); return; }
  const expected = crypto.createHmac("sha512", key).update(req.rawBody).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) { res.status(401).send("bad signature"); return; }
  const { event, data } = req.body as { event: string; data: Record<string, unknown> & { metadata?: Record<string, string>; customer?: { customer_code?: string; email?: string }; reference?: string } };
  try {
    const meta = data.metadata ?? {};
    let instId = meta.instId;
    if (!instId && data.customer?.customer_code) {
      const q = await db.collection("institutions").where("paystack.customerCode", "==", data.customer.customer_code).limit(1).get();
      instId = q.docs[0]?.id;
    }
    if (!instId) { logger.warn("paystack event without institution", { event }); res.status(200).send("ok"); return; }
    if (data.customer?.customer_code) await inst(instId).set({ paystack: { customerCode: data.customer.customer_code } }, { merge: true });
    if (event === "charge.success") {
      if (meta.invoiceId) await applyPayment(instId, meta.invoiceId, "paystack", String(data.reference ?? ""), "paystack");
      else {
        // A recurring subscription renewal: issue the period's invoice and mark it paid
        const institution = { id: instId, ...(await inst(instId).get()).data() } as Institution;
        const plan = await getPlan(institution.planId);
        const start = toDate(institution.currentPeriodEnd) ?? new Date();
        const end = addPeriod(start, institution.billingCycle);
        const amount = Number(data.amount) || periodPrice(plan, institution.billingCycle, { discountPct: institution.discountPct });
        const inv = await createInvoice(instId, { kind: "subscription", lines: [{ description: `${plan.name} plan renewal`, quantity: 1, unitAmount: amount, amount }], period: { start, end }, extendsTo: end, planId: plan.id, cycle: institution.billingCycle }, false);
        await applyPayment(instId, inv.id, "paystack", String(data.reference ?? ""), "paystack");
      }
    } else if (event === "subscription.create") {
      await inst(instId).set({ paystack: { subscriptionCode: String(data.subscription_code ?? ""), emailToken: String(data.email_token ?? "") } }, { merge: true });
    } else if (event === "invoice.payment_failed") {
      await notify(instId, "billing_reminder", (await managers(instId)).filter((m) => m.role === "owner"), { title: "Card payment failed", body: "Paystack couldn't charge your card. Update it or pay by bank transfer.", path: "/app/admin/billing", email: { subject: "DocInsight card payment failed", lines: ["Paystack couldn't charge the card for your DocInsight subscription. Update your card or pay the open invoice by bank transfer to keep full access."] } });
    }
    res.status(200).send("ok");
  } catch (e) {
    logger.error("paystack webhook failed", { err: (e as Error).message });
    res.status(500).send("error");
  }
});
