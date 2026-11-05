// Subscription rules from PRD section 4, as pure functions so they are unit-tested
// and shared by the scheduled job, the security-rule mirror and the UI.
import type { BillingCycle, InstitutionStatus, MemberAccess, MemberRole, Plan } from "./types";

const DAY = 86_400_000;

export const PAST_DUE_REMINDER_DAYS = [1, 7, 14] as const;
export const RESTRICT_AFTER_DAYS = 15;
export const SUSPEND_AFTER_DAYS = 45; // 15 days past due + 30 days of read access
export const CANCELLED_RETENTION_DAYS = 90;

export interface BillingClock {
  status: InstitutionStatus;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  cancelledAt: Date | null;
  remindersSent: number[];
}

export interface BillingTick {
  status: InstitutionStatus;
  pastDueSince: Date | null;
  /** Past-due reminder days that are now due and not yet sent */
  sendReminders: number[];
  /** True when a cancelled tenant has passed its 90-day retention */
  deleteTenant: boolean;
}

/** Advances an institution's billing status to `now`. Pure: the caller persists the result. */
export function tickBilling(c: BillingClock, now: Date): BillingTick {
  const out: BillingTick = { status: c.status, pastDueSince: c.pastDueSince, sendReminders: [], deleteTenant: false };
  if (c.status === "pending_payment") return out;
  if (c.status === "cancelled") {
    out.deleteTenant = !!c.cancelledAt && now.getTime() - c.cancelledAt.getTime() >= CANCELLED_RETENTION_DAYS * DAY;
    return out;
  }
  const periodEnd = c.currentPeriodEnd;
  if (!periodEnd) return out;
  if (now.getTime() < periodEnd.getTime()) {
    // Paid up (a payment moved the period end forward)
    return { status: "active", pastDueSince: null, sendReminders: [], deleteTenant: false };
  }
  const since = c.pastDueSince ?? periodEnd;
  const daysPast = Math.floor((now.getTime() - since.getTime()) / DAY);
  out.pastDueSince = since;
  out.status = daysPast >= SUSPEND_AFTER_DAYS ? "suspended" : daysPast >= RESTRICT_AFTER_DAYS ? "restricted" : "past_due";
  out.sendReminders = PAST_DUE_REMINDER_DAYS.filter((d) => daysPast >= d && !c.remindersSent.includes(d));
  // Never send a backlog of reminders at once: only the latest one that is due
  if (out.sendReminders.length > 1) out.sendReminders = [out.sendReminders[out.sendReminders.length - 1]];
  return out;
}

/** What a member can do, derived from the institution status and their role. Security rules read the result. */
export function memberAccess(status: InstitutionStatus, role: MemberRole): MemberAccess {
  const manager = role === "owner" || role === "admin";
  switch (status) {
    case "pending_payment":
      return manager ? "full" : "none"; // admins set up spaces and content; staff can't join yet
    case "active":
    case "past_due":
      return "full";
    case "restricted":
      return "read"; // read and search approved documents only
    case "suspended":
    case "cancelled":
      return manager ? "admin_only" : "none"; // admins can export their content
  }
}

export interface Capabilities {
  read: boolean;
  search: boolean;
  ask: boolean;
  upload: boolean;
  inviteStaff: boolean;
  inviteAdmins: boolean;
  export: boolean;
}

export function capabilities(status: InstitutionStatus): Capabilities {
  switch (status) {
    case "pending_payment":
      return { read: true, search: true, ask: true, upload: true, inviteStaff: false, inviteAdmins: true, export: true };
    case "active":
    case "past_due":
      return { read: true, search: true, ask: true, upload: true, inviteStaff: true, inviteAdmins: true, export: true };
    case "restricted":
      return { read: true, search: true, ask: false, upload: false, inviteStaff: false, inviteAdmins: false, export: true };
    case "suspended":
    case "cancelled":
      return { read: false, search: false, ask: false, upload: false, inviteStaff: false, inviteAdmins: false, export: true };
  }
}

export const STATUS_LABEL: Record<InstitutionStatus, string> = {
  pending_payment: "Pending payment",
  active: "Active",
  past_due: "Past due",
  restricted: "Restricted",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

/** Price for one billing period after pilot and discount, in the smallest unit. */
export function periodPrice(plan: Plan, cycle: BillingCycle, opts: { discountPct?: number; pilotDiscountPct?: number; extraSeatBlocks?: number } = {}): number {
  const base = cycle === "annual" ? plan.priceAnnual : plan.priceMonthly;
  const seats = (opts.extraSeatBlocks ?? 0) * plan.extraSeatBlockPrice * (cycle === "annual" ? 10 : 1);
  let total = base + seats;
  if (opts.pilotDiscountPct) total = Math.round(total * (1 - opts.pilotDiscountPct / 100));
  if (opts.discountPct) total = Math.round(total * (1 - opts.discountPct / 100));
  return total;
}

/** Monthly recurring revenue contribution, smallest unit. */
export function monthlyRevenue(plan: Plan, cycle: BillingCycle, status: InstitutionStatus, discountPct = 0, extraSeatBlocks = 0): number {
  if (!["active", "past_due", "restricted"].includes(status)) return 0;
  const period = periodPrice(plan, cycle, { discountPct, extraSeatBlocks });
  return cycle === "annual" ? Math.round(period / 12) : period;
}

export function seatLimit(plan: Plan, extraSeats: number): number | null {
  return plan.seatLimit == null ? null : plan.seatLimit + extraSeats;
}

export type LimitState = "ok" | "warn" | "blocked";
export function limitState(used: number, limit: number | null, warnAtPct = 80): LimitState {
  if (limit == null) return "ok";
  if (used >= limit) return "blocked";
  if (used >= Math.ceil((limit * warnAtPct) / 100)) return "warn";
  return "ok";
}

export function addPeriod(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + (cycle === "annual" ? 12 : 1));
  return d;
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = currency === "NGN" ? "₦" : currency === "USD" ? "$" : currency === "XOF" ? "CFA " : `${currency} `;
  const major = amount / 100;
  return symbol + major.toLocaleString("en-NG", { minimumFractionDigits: major % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
