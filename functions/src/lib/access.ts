// Server-side checks. Every function re-checks the caller's institution, role and
// billing status from Firestore; token claims are only a hint for the web app.
import type { CallableRequest } from "firebase-functions/v2/https";
import type { Institution, Member, MemberRole, Space } from "../../../shared/src/types";
import { capabilities, type Capabilities } from "../../../shared/src/billing";
import { db, inst, memberRef } from "./admin";
import { fail, id } from "./errors";

export interface Caller {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  authTime: number;
  secondFactor: boolean;
}

export function caller(req: CallableRequest): Caller {
  if (!req.auth?.uid) throw fail.auth();
  const t = req.auth.token as Record<string, unknown>;
  return {
    uid: req.auth.uid,
    email: String(t.email ?? ""),
    emailVerified: t.email_verified === true,
    name: String(t.name ?? t.email ?? t.phone_number ?? ""),
    authTime: Number(t.auth_time ?? 0),
    secondFactor: !!(t.firebase as Record<string, unknown> | undefined)?.sign_in_second_factor,
  };
}

export async function isPlatformAdmin(uid: string): Promise<boolean> {
  return (await db.doc(`platformAdmins/${uid}`).get()).exists;
}

export async function requirePlatformAdmin(req: CallableRequest): Promise<Caller> {
  const c = caller(req);
  if (!(await isPlatformAdmin(c.uid))) throw fail.denied("Only DocInsight staff can do this.");
  return c;
}

export interface Ctx {
  c: Caller;
  instId: string;
  inst: Institution;
  member: Member;
  caps: Capabilities;
  isManager: boolean;
  isOwner: boolean;
  platformAdmin: boolean;
}

export interface RequireOpts {
  roles?: MemberRole[];
  /** Capability the institution's billing status must allow */
  cap?: keyof Capabilities;
  /** Platform admins may act (support / digitisation) */
  allowPlatform?: boolean;
}

export async function requireMember(req: CallableRequest, instIdRaw: unknown, opts: RequireOpts = {}): Promise<Ctx> {
  const c = caller(req);
  const instId = id(instIdRaw, "institution");
  const [is, ms] = await Promise.all([inst(instId).get(), memberRef(instId, c.uid).get()]);
  if (!is.exists) throw fail.notFound("This institution doesn't exist.");
  const institution = { id: instId, ...is.data() } as Institution;
  const platformAdmin = !ms.exists && opts.allowPlatform ? await isPlatformAdmin(c.uid) : false;
  if (!ms.exists && !platformAdmin) throw fail.denied("You're not a member of this institution.");
  const member = (ms.exists ? ms.data() : { role: "admin", status: "active", access: "full", userId: c.uid, name: "DocInsight support", visibleSpaceIds: [], editSpaceIds: [], approveSpaceIds: [], signOutBefore: 0, expiresAt: null }) as Member;
  if (!platformAdmin) {
    if (member.status !== "active") throw fail.denied("Your access to this institution has been removed.");
    if (member.expiresAt && (member.expiresAt as FirebaseFirestore.Timestamp).toMillis() < Date.now()) throw fail.denied("Your locum access has expired. Ask an admin to extend it.");
    if (member.signOutBefore && c.authTime < member.signOutBefore) throw fail.denied("You were signed out by an admin. Sign in again.");
    if (member.access === "none") throw fail.precondition("Your institution's DocInsight access is paused. Contact your administrator.", { reason: "suspended" });
  }
  const isManager = member.role === "owner" || member.role === "admin";
  if (opts.roles && !opts.roles.includes(member.role) && !platformAdmin) throw fail.denied();
  // Group plan (or institutions that opt in) require two-factor sign-in for owners and admins
  if (isManager && !platformAdmin && (institution.settings?.requireAdmin2fa || institution.planId === "group") && opts.roles && !c.secondFactor) {
    throw fail.precondition("Set up two-factor sign-in to use admin tools.", { reason: "mfa_required" });
  }
  const caps = capabilities(institution.status);
  if (opts.cap && !caps[opts.cap] && !platformAdmin) {
    const msg: Record<keyof Capabilities, string> = {
      read: "Reading is paused while your subscription is suspended.",
      search: "Search is paused while your subscription is suspended.",
      ask: "AI answers are paused until your subscription payment is received. You can still read and search approved documents.",
      upload: "Uploads are paused until your subscription payment is received.",
      inviteStaff: institution.status === "pending_payment" ? "Staff can be invited once your first payment is received." : "New invites are paused until your subscription payment is received.",
      inviteAdmins: "New invites are paused until your subscription payment is received.",
      export: "Export isn't available.",
    };
    throw fail.precondition(msg[opts.cap], { reason: "billing", status: institution.status });
  }
  return { c, instId, inst: institution, member, caps, isManager: isManager || platformAdmin, isOwner: member.role === "owner", platformAdmin };
}

export async function getSpace(instId: string, spaceIdRaw: unknown): Promise<Space> {
  const spaceId = id(spaceIdRaw, "space");
  const s = await db.doc(`institutions/${instId}/spaces/${spaceId}`).get();
  if (!s.exists) throw fail.notFound("That space doesn't exist.");
  return { id: s.id, ...s.data() } as Space;
}

export const canSee = (ctx: Ctx, spaceId: string) => ctx.isManager || ctx.member.visibleSpaceIds.includes(spaceId);
export const canEdit = (ctx: Ctx, space: Space) => ctx.isManager || space.editorIds.includes(ctx.c.uid);
export const canApprove = (ctx: Ctx, space: Space) => ctx.isManager || space.approverIds.includes(ctx.c.uid);

export function requireEdit(ctx: Ctx, space: Space) {
  if (!canEdit(ctx, space)) throw fail.denied("You can't edit content in this space.");
}
export function requireApprove(ctx: Ctx, space: Space) {
  if (!canApprove(ctx, space)) throw fail.denied("You're not an approver for this space.");
}
