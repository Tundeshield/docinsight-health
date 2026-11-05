import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import type { ContentItem, InboxItem, Institution, Member, Space, Update } from "../../../shared/src/types";
import { addPeriod, formatMoney, limitState, periodPrice, STATUS_LABEL, tickBilling } from "../../../shared/src/billing";
import { bucket, db, FieldValue, monthKey, Timestamp, toDate } from "../lib/admin";
import { audit } from "../lib/audit";
import { sendEmail } from "../lib/email";
import { managers, notify } from "../lib/notify";
import { APP_URL, RESEND_API_KEY } from "../lib/params";
import { getPlan, loadConfig, questionState, docState } from "../lib/plans";
import { recomputeMembers, syncUser } from "../lib/visibility";
import { createInvoice } from "../api/billing";

const DAY = 86_400_000;
const opts = { region: "europe-west1", timeZone: "Africa/Lagos", secrets: [RESEND_API_KEY], memory: "512MiB" as const, timeoutSeconds: 540 };

async function forEachInstitution(fn: (i: Institution) => Promise<void>) {
  const snap = await db.collection("institutions").get();
  for (const d of snap.docs) {
    try { await fn({ id: d.id, ...d.data() } as Institution); } catch (e) { logger.error("job failed for institution", { instId: d.id, err: (e as Error).message }); }
  }
}

async function owners(instId: string, institution: Institution): Promise<Member[]> {
  const ms = (await managers(instId)).filter((m) => m.role === "owner");
  if (institution.billingContact?.email && !ms.some((m) => m.email === institution.billingContact.email)) ms.push({ email: institution.billingContact.email, userId: "", name: institution.billingContact.name } as Member);
  return ms;
}

const REMINDER_COPY: Record<number, (i: Institution) => string[]> = {
  1: (i) => [`Your DocInsight subscription payment for ${i.name} is now due. Everything keeps working for now.`, "Pay the open invoice on the Billing page to avoid interruption."],
  7: (i) => [`Your DocInsight payment for ${i.name} is 7 days overdue.`, "On day 15, AI answers, uploads and new invites are switched off (staff keep read access to approved protocols). Please pay the open invoice."],
  14: (i) => [`Final reminder: your DocInsight payment for ${i.name} is 14 days overdue.`, "Tomorrow your account becomes restricted: staff can still read and search approved documents, but AI answers, uploads and invites stop. After 45 days overdue, staff access is suspended."],
};

/** Billing status, reminders, renewal invoices, cancellations and deletion after retention. */
export const dailyBilling = onSchedule({ ...opts, schedule: "15 6 * * *" }, async () => {
  const { billing } = await loadConfig();
  await forEachInstitution(async (i) => {
    const instRef = db.doc(`institutions/${i.id}`);
    const cancelAtPeriodEnd = (i as Institution & { cancelAtPeriodEnd?: boolean }).cancelAtPeriodEnd;
    const periodEnd = toDate(i.currentPeriodEnd);
    if (cancelAtPeriodEnd && i.status !== "cancelled" && periodEnd && periodEnd.getTime() < Date.now()) {
      await instRef.update({ status: "cancelled", cancelledAt: FieldValue.serverTimestamp(), statusChangedAt: FieldValue.serverTimestamp() });
      await audit({ instId: i.id, actorId: "system", actorName: "DocInsight billing", action: "institution.status", target: { type: "institution", id: i.id, title: i.name }, before: { status: i.status }, after: { status: "cancelled" } });
      await recomputeMembers(i.id);
      return;
    }
    const t = tickBilling({ status: i.status, currentPeriodEnd: periodEnd, pastDueSince: toDate(i.pastDueSince), cancelledAt: toDate(i.cancelledAt), remindersSent: i.remindersSent ?? [] }, new Date());
    if (t.deleteTenant) {
      logger.warn("deleting cancelled tenant after retention", { instId: i.id });
      await db.recursiveDelete(instRef);
      await bucket().deleteFiles({ prefix: `inst/${i.id}/`, force: true }).catch(() => {});
      return;
    }
    if (i.status === "cancelled" && i.cancelledAt) {
      const days = Math.floor((Date.now() - toDate(i.cancelledAt)!.getTime()) / DAY);
      if (days === 83) await notify(i.id, "billing_reminder", await owners(i.id, i), { title: "Data deletion in 7 days", body: "Export your content now.", path: "/app/admin/settings", email: { subject: `Your DocInsight data will be deleted in 7 days`, lines: [`${i.name}'s DocInsight subscription was cancelled 83 days ago. All content will be permanently deleted in 7 days.`, "Owners and admins can export all content from Settings until then."] } });
    }
    if (t.status !== i.status || JSON.stringify(t.pastDueSince?.getTime() ?? null) !== JSON.stringify(toDate(i.pastDueSince)?.getTime() ?? null)) {
      await instRef.update({ status: t.status, pastDueSince: t.pastDueSince ? Timestamp.fromDate(t.pastDueSince) : null, ...(t.status !== i.status && { statusChangedAt: FieldValue.serverTimestamp() }) });
      if (t.status !== i.status) {
        await audit({ instId: i.id, actorId: "system", actorName: "DocInsight billing", action: "institution.status", target: { type: "institution", id: i.id, title: i.name }, before: { status: i.status }, after: { status: t.status } });
        await recomputeMembers(i.id);
        if (t.status === "restricted" || t.status === "suspended") {
          await notify(i.id, "billing_reminder", await managers(i.id), { title: `Account ${STATUS_LABEL[t.status].toLowerCase()}`, body: t.status === "restricted" ? "Staff can read and search; AI answers, uploads and invites are off until payment." : "Staff access is suspended. Admins can still export content.", path: "/app/admin/billing", email: { subject: `DocInsight is now ${STATUS_LABEL[t.status].toLowerCase()} for ${i.name}`, lines: t.status === "restricted" ? ["Your payment is 15 days overdue. Staff keep read and search access to approved protocols for 30 days, but AI answers, uploads and new invites are switched off.", "Pay the open invoice to restore everything immediately."] : ["Your payment is 45 days overdue, so staff access is suspended. Owners and admins can still sign in to export content.", "Pay the open invoice to restore access immediately."] } });
        }
      }
    }
    for (const day of t.sendReminders) {
      await notify(i.id, "billing_reminder", await owners(i.id, i), { title: "Payment overdue", body: REMINDER_COPY[day](i)[0], path: "/app/admin/billing", email: { subject: `DocInsight payment reminder (${day} day${day > 1 ? "s" : ""} overdue)`, lines: REMINDER_COPY[day](i) } });
      await db.doc(`institutions/${i.id}`).update({ remindersSent: FieldValue.arrayUnion(day) });
    }
    // Renewal invoice 14 days before the period ends, for hospitals that don't pay by card subscription
    if (periodEnd && !cancelAtPeriodEnd && ["active", "past_due"].includes(t.status) && !i.paystack?.subscriptionCode && periodEnd.getTime() - Date.now() < 14 * DAY) {
      const open = await db.collection(`institutions/${i.id}/invoices`).where("status", "==", "open").where("kind", "in", ["subscription", "pilot", "mixed"]).limit(1).get();
      if (open.empty) {
        const plan = await getPlan(i.planId);
        const pilotOver = i.pilot && toDate(i.pilot.endsAt)!.getTime() <= periodEnd.getTime() + DAY;
        const cycle = i.billingCycle;
        const amount = periodPrice(plan, cycle, { discountPct: i.discountPct, extraSeatBlocks: Math.floor((i.extraSeats ?? 0) / 10) });
        const end = addPeriod(periodEnd, cycle);
        await createInvoice(i.id, { kind: "subscription", lines: [{ description: `${plan.name} plan: ${cycle === "annual" ? "12 months (pay 10, get 12)" : "1 month"}, ${periodEnd.toDateString()} to ${end.toDateString()}${i.extraSeats ? ` including ${i.extraSeats} extra seats` : ""}`, quantity: 1, unitAmount: amount, amount }], period: { start: periodEnd, end }, extendsTo: end, planId: plan.id, cycle, dueInDays: Math.max(1, Math.ceil((periodEnd.getTime() - Date.now()) / DAY)) });
        if (pilotOver) await db.doc(`institutions/${i.id}`).update({ pilot: null });
        logger.info("renewal invoice issued", { instId: i.id, amount: formatMoney(amount, billing.currency) });
      }
    }
  });
});

/** Review reminders 30 and 7 days before each document's review date. */
export const reviewReminders = onSchedule({ ...opts, schedule: "30 7 * * *" }, async () => {
  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  await forEachInstitution(async (i) => {
    if (!["active", "past_due", "pending_payment"].includes(i.status)) return;
    const in30 = ymd(new Date(today.getTime() + 30 * DAY));
    const snap = await db.collection(`institutions/${i.id}/content`).where("published", "==", true).where("reviewDate", "<=", in30).get();
    const admins = await managers(i.id);
    for (const d of snap.docs) {
      const c = { id: d.id, ...d.data() } as ContentItem;
      const days = Math.ceil((new Date(c.reviewDate + "T00:00:00Z").getTime() - today.getTime()) / DAY);
      const due = days <= 7 ? 7 : days <= 30 ? 30 : null;
      if (!due || (c.reviewRemindersSent ?? []).includes(due)) continue;
      const owner = (await db.doc(`institutions/${i.id}/members/${c.ownerId}`).get()).data() as Member | undefined;
      const people = [...(owner ? [{ ...owner, userId: c.ownerId }] : []), ...admins.filter((a) => a.userId !== c.ownerId)];
      await notify(i.id, "review_reminder", people, {
        title: days < 0 ? "Review overdue" : `Review due in ${days} days`, body: c.title, path: `/app/admin/content/${c.id}`,
        email: { subject: days < 0 ? `Overdue for review: ${c.title}` : `Review due ${c.reviewDate}: ${c.title}`, lines: [days < 0 ? `"${c.title}" was due for review on ${c.reviewDate}. Staff still see it, flagged as overdue.` : `"${c.title}" is due for review on ${c.reviewDate} (in ${days} days).`, "Upload a new version, or confirm it's still current by setting a new review date."] },
      }, c.id);
      await d.ref.update({ reviewRemindersSent: FieldValue.arrayUnion(due) });
    }
  });
});

/** Expired locums are deactivated (rules already block them) so their seats free up. Usage warnings at 80%. */
export const hourlyHousekeeping = onSchedule({ ...opts, schedule: "5 * * * *" }, async () => {
  const expired = await db.collectionGroup("members").where("status", "==", "active").where("expiresAt", "<", Timestamp.now()).get();
  for (const d of expired.docs) {
    const instId = d.ref.parent.parent!.id;
    await d.ref.update({ status: "deactivated", access: "none" });
    await audit({ instId, actorId: "system", actorName: "DocInsight", action: "member.remove", target: { type: "member", id: d.id, title: String(d.data().name || d.data().email) }, before: { status: "active" }, after: { status: "deactivated", reason: "locum access expired" } });
    await syncUser(d.id);
  }
  if (new Date().getUTCHours() !== 8) return;
  await forEachInstitution(async (i) => {
    if (!["active", "past_due"].includes(i.status)) return;
    const usageRef = db.doc(`institutions/${i.id}/usage/${monthKey()}`);
    const warned = ((await usageRef.get()).data()?.warned ?? []) as string[];
    const checks = [{ key: "questions", s: await questionState(i), what: "AI questions this month" }, { key: "documents", s: await docState(i), what: "documents" }];
    for (const c of checks) {
      const state = limitState(c.s.used, c.s.limit);
      if (state === "ok" || warned.includes(`${c.key}:${state}`)) continue;
      await notify(i.id, "billing_reminder", await managers(i.id), { title: state === "blocked" ? `Plan limit reached: ${c.what}` : `80% of your ${c.what} used`, body: `${c.s.used} of ${c.s.limit} used. Upgrade on the Billing page.`, path: "/app/admin/billing", email: { subject: state === "blocked" ? `DocInsight: ${c.what} limit reached` : `DocInsight: 80% of your ${c.what} used`, lines: [`${i.name} has used ${c.s.used} of the ${c.s.limit} ${c.what} in its plan.`, state === "blocked" ? (c.key === "questions" ? "Staff can still search and read; AI answers resume next month or when you upgrade." : "New uploads are paused until you archive documents or upgrade.") : "You can upgrade any time on the Billing page."] } });
      await usageRef.set({ warned: FieldValue.arrayUnion(`${c.key}:${state}`) }, { merge: true });
    }
  });
});

/** Weekly email digest of updates and pending must-read items. */
export const weeklyDigest = onSchedule({ ...opts, schedule: "0 7 * * 1" }, async () => {
  const since = Timestamp.fromMillis(Date.now() - 7 * DAY);
  await forEachInstitution(async (i) => {
    if (!["active", "past_due"].includes(i.status) || i.settings?.emailDigest === false) return;
    const updates = (await db.collection(`institutions/${i.id}/updates`).where("at", ">=", since).get()).docs.map((d) => d.data() as Update);
    const members = (await db.collection(`institutions/${i.id}/members`).where("status", "==", "active").get()).docs.map((d) => ({ ...d.data(), userId: d.id }) as Member);
    for (const m of members) {
      if (!m.email || m.access === "none") continue;
      const settings = (await db.doc(`users/${m.userId}/private/settings`).get()).data();
      if (settings?.emailDigest === false) continue;
      const mine = updates.filter((u) => m.visibleSpaceIds.includes(u.spaceId));
      const pending = (await db.collection(`institutions/${i.id}/members/${m.userId}/inbox`).where("mustRead", "==", true).where("acknowledgedAt", "==", null).get()).docs.map((d) => d.data() as InboxItem);
      if (!mine.length && !pending.length) continue;
      await sendEmail({
        to: m.email, subject: `${i.name}: ${mine.length} update${mine.length === 1 ? "" : "s"} this week${pending.length ? `, ${pending.length} to read` : ""}`,
        lines: [
          ...(pending.length ? [`Must read (${pending.length}): ${pending.map((p) => p.title).join("; ")}.`] : []),
          ...(mine.length ? [`New and updated: ${mine.slice(0, 15).map((u) => `${u.title} (${u.spaceName}, v${u.versionNumber})`).join("; ")}${mine.length > 15 ? "…" : ""}.`] : []),
        ],
        button: { label: "Open DocInsight", url: `${APP_URL.value()}/app` },
      });
    }
  });
});

export type { Space };
