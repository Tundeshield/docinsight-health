// F2: people. Invites (email, phone, CSV, link), join codes and QR, join requests,
// roles, locum expiry, deactivation and forced sign-out.
import type { Institution, Invite, JoinRequest, Member, MemberRole } from "../../../shared/src/types";
import { JOB_TITLES } from "../../../shared/src/config";
import { adminAuth, db, FieldValue, inst, memberRef, randomId, Timestamp } from "../lib/admin";
import { caller, requireMember } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { fail, id, oneOf, reqStr, str, strList } from "../lib/errors";
import { callable } from "../lib/fn";
import { sendEmail } from "../lib/email";
import { managers, notify } from "../lib/notify";
import { APP_URL } from "../lib/params";
import { requireSeats } from "../lib/plans";
import { recomputeMembers, syncUser } from "../lib/visibility";
import { capabilities } from "../../../shared/src/billing";

const ROLES: readonly MemberRole[] = ["owner", "admin", "editor", "approver", "staff", "locum"];
const STAFF_ROLES: MemberRole[] = ["editor", "approver", "staff", "locum"];
const normPhone = (p: string) => {
  const digits = p.replace(/[^\d+]/g, "");
  if (/^0[789]\d{9}$/.test(digits)) return "+234" + digits.slice(1);
  if (/^234\d{10}$/.test(digits)) return "+" + digits;
  return digits;
};

export interface InviteInput {
  email: string | null; phone: string | null; name: string; role: MemberRole; jobTitle: string; department: string;
  spaceIds: string[]; locumExpiresAt: Date | null;
}

export function joinUrl(instId: string, token: string) {
  return `${APP_URL.value()}/join/${instId}/${token}`;
}

/** Creates invite records and emails them where possible. Returns the links (for WhatsApp, SMS or QR). */
export async function createInviteDocs(instId: string, instName: string, invites: InviteInput[], actor: { uid: string; name: string }, sendEmails: boolean) {
  const out: { token: string; link: string; email: string | null; phone: string | null; emailed: boolean }[] = [];
  const batch = db.batch();
  for (const i of invites) {
    const token = randomId(24);
    const invite: Invite = {
      token, email: i.email, phone: i.phone, name: i.name, role: i.role, jobTitle: i.jobTitle, department: i.department, spaceIds: i.spaceIds,
      locumExpiresAt: i.locumExpiresAt ? Timestamp.fromDate(i.locumExpiresAt) : null, status: "pending", createdBy: actor.uid,
      createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000), sentVia: ["link"],
    };
    batch.set(db.doc(`institutions/${instId}/invites/${token}`), invite);
    out.push({ token, link: joinUrl(instId, token), email: i.email, phone: i.phone, emailed: false });
  }
  await audit({ instId, actorId: actor.uid, actorName: actor.name, action: "member.invite", target: { type: "invites", id: String(invites.length), title: `${invites.length} invite${invites.length === 1 ? "" : "s"}` }, after: { invites: invites.map((i) => ({ email: i.email, phone: i.phone, role: i.role, locum: !!i.locumExpiresAt })) } }, batch);
  await batch.commit();
  if (sendEmails) {
    await Promise.all(out.map(async (o, idx) => {
      if (!o.email) return;
      const i = invites[idx];
      o.emailed = await sendEmail({
        to: o.email,
        subject: `You're invited to ${instName} on DocInsight Health`,
        lines: [
          `${actor.name} has invited you to ${instName}'s protocols, guidelines and equipment manuals on DocInsight Health.`,
          i.locumExpiresAt ? `This is temporary access until ${i.locumExpiresAt.toDateString()}.` : "Sign in with this email address to accept.",
        ],
        button: { label: "Accept invite", url: o.link },
      });
      if (o.emailed) await db.doc(`institutions/${instId}/invites/${o.token}`).update({ sentVia: FieldValue.arrayUnion("email") });
    }));
  }
  return out;
}

function parseInvite(raw: Record<string, unknown>): InviteInput {
  const email = str(raw.email, 200).toLowerCase() || null;
  const phone = str(raw.phone, 30) ? normPhone(str(raw.phone, 30)) : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail.invalid(`"${email}" isn't a valid email address.`);
  if (phone && !/^\+\d{8,15}$/.test(phone)) throw fail.invalid(`"${raw.phone}" isn't a valid phone number. Use +234… or 080…`);
  const role = oneOf(raw.role, ROLES, "staff");
  const exp = raw.locumExpiresAt ? new Date(String(raw.locumExpiresAt)) : null;
  if (exp && (isNaN(exp.getTime()) || exp.getTime() < Date.now())) throw fail.invalid("The locum end date must be in the future.");
  if (role === "locum" && !exp) throw fail.invalid("Locum and guest access needs an end date.");
  return {
    email, phone, name: str(raw.name, 120), role, jobTitle: str(raw.jobTitle, 60), department: str(raw.department, 80),
    spaceIds: strList(raw.spaceIds, 50, 128), locumExpiresAt: role === "locum" || exp ? exp : null,
  };
}

/** Invite by email, phone or CSV (the web app parses the CSV and sends rows). */
export const createInvites = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const rows = (Array.isArray(req.data.invites) ? req.data.invites : []).slice(0, 500) as Record<string, unknown>[];
  if (!rows.length) throw fail.invalid("Add at least one person to invite.");
  const invites = rows.map(parseInvite);
  if (invites.some((i) => i.role === "owner") && !ctx.isOwner) throw fail.denied("Only the owner can invite another owner.");
  const staff = invites.filter((i) => STAFF_ROLES.includes(i.role));
  if (staff.length && !ctx.caps.inviteStaff) throw fail.precondition(ctx.inst.status === "pending_payment" ? "Staff can be invited once your first payment is received. You can invite admins now." : "New invites are paused until your subscription payment is received.", { reason: "billing" });
  if (invites.length > staff.length && !ctx.caps.inviteAdmins) throw fail.precondition("New invites are paused until your subscription payment is received.", { reason: "billing" });
  const pending = (await db.collection(`institutions/${ctx.instId}/invites`).where("status", "==", "pending").where("expiresAt", ">", Timestamp.now()).count().get()).data().count;
  await requireSeats(ctx.inst, invites.length + pending);
  const out = await createInviteDocs(ctx.instId, ctx.inst.name, invites, { uid: ctx.c.uid, name: ctx.member.name }, req.data.sendEmails !== false);
  return { invites: out };
});

export const revokeInvite = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  await db.doc(`institutions/${ctx.instId}/invites/${id(req.data.token, "invite")}`).update({ status: "revoked" });
  return { ok: true };
});

async function publicInstInfo(i: Institution) {
  return { name: i.name, colour: i.colour, logoRef: i.logoRef, phoneLogin: !!i.settings?.phoneLogin };
}

export const getInvite = callable(async (req) => {
  caller(req);
  const instId = id(req.data.instId, "institution"), token = id(req.data.token, "invite");
  const [is, iv] = await Promise.all([inst(instId).get(), db.doc(`institutions/${instId}/invites/${token}`).get()]);
  if (!is.exists || !iv.exists) throw fail.notFound("This invite link isn't valid. Ask your administrator for a new one.");
  const invite = iv.data() as Invite;
  if (invite.status !== "pending" || invite.expiresAt.toMillis() < Date.now()) throw fail.precondition("This invite has expired or was already used. Ask your administrator for a new one.");
  return { institution: await publicInstInfo({ id: instId, ...is.data() } as Institution), role: invite.role, email: invite.email, phone: invite.phone, name: invite.name, locumExpiresAt: invite.locumExpiresAt?.toMillis() ?? null };
});

async function addMember(instId: string, institution: Institution, uid: string, m: Partial<Member> & { role: MemberRole }, actor: { uid: string; name: string }, via: string) {
  const ref = memberRef(instId, uid);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status === "active") return false;
  const caps = capabilities(institution.status);
  const isStaff = STAFF_ROLES.includes(m.role);
  if (isStaff && !caps.inviteStaff) throw fail.precondition("This institution isn't accepting new staff yet. Ask your administrator.", { reason: "billing" });
  await requireSeats(institution);
  const member: Member = {
    userId: uid, role: m.role, name: m.name ?? "", email: m.email ?? "", phone: m.phone ?? "", jobTitle: m.jobTitle ?? "", department: m.department ?? "",
    spaceIds: m.spaceIds ?? [], status: "active", expiresAt: m.expiresAt ?? null, invitedBy: m.invitedBy ?? actor.uid,
    joinedAt: Timestamp.now(), lastActiveAt: null, access: "none", visibleSpaceIds: [], editSpaceIds: [], approveSpaceIds: [], signOutBefore: 0,
  };
  await ref.set(member);
  await recomputeMembers(instId, [uid]);
  await syncUser(uid);
  await inst(instId).update({ seatsUsed: (await db.collection(`institutions/${instId}/members`).where("status", "==", "active").count().get()).data().count });
  await audit({ instId, actorId: actor.uid, actorName: actor.name, action: "member.join", target: { type: "member", id: uid, title: member.name || member.email || member.phone }, after: { role: member.role, via, jobTitle: member.jobTitle, expiresAt: member.expiresAt ? (member.expiresAt as Timestamp).toDate().toISOString() : null } });
  return true;
}

export const acceptInvite = callable(async (req) => {
  const c = caller(req);
  const instId = id(req.data.instId, "institution"), token = id(req.data.token, "invite");
  const [is, iv] = await Promise.all([inst(instId).get(), db.doc(`institutions/${instId}/invites/${token}`).get()]);
  if (!is.exists || !iv.exists) throw fail.notFound("This invite link isn't valid.");
  const institution = { id: instId, ...is.data() } as Institution;
  const invite = iv.data() as Invite;
  if (invite.status !== "pending" || invite.expiresAt.toMillis() < Date.now()) throw fail.precondition("This invite has expired or was already used. Ask your administrator for a new one.");
  const phone = String((req.auth?.token as Record<string, unknown>).phone_number ?? "");
  if (invite.email && (c.email.toLowerCase() !== invite.email || !c.emailVerified)) {
    throw fail.denied(c.email.toLowerCase() === invite.email ? "Verify your email address first: check your inbox for the verification link, then try again." : `This invite is for ${invite.email}. Sign in with that email address.`);
  }
  if (!invite.email && invite.phone && phone !== invite.phone) throw fail.denied(`This invite is for ${invite.phone}. Sign in with that phone number.`);
  const name = str(req.data.name, 120) || invite.name || c.name;
  const added = await addMember(instId, institution, c.uid, {
    role: invite.role, name, email: c.email, phone, jobTitle: invite.jobTitle || str(req.data.jobTitle, 60), department: invite.department,
    spaceIds: invite.spaceIds, expiresAt: invite.locumExpiresAt, invitedBy: invite.createdBy,
  }, { uid: c.uid, name }, "invite");
  if (invite.role === "owner") {
    // Ownership hand-over for sales-led institutions: the previous owner (if any) becomes an admin
    const owners = await db.collection(`institutions/${instId}/members`).where("role", "==", "owner").get();
    for (const o of owners.docs) if (o.id !== c.uid) await o.ref.update({ role: "admin" });
    await recomputeMembers(instId);
  }
  // Addressed invites are single-use; open links (no email/phone) stay usable until they expire
  if (invite.email || invite.phone) await iv.ref.update({ status: "accepted" });
  await db.doc(`users/${c.uid}`).set({ name, defaultInstitutionId: instId }, { merge: true });
  return { instId, alreadyMember: !added };
});

/** Join code / QR code: the person asks to join and an admin approves. */
export const requestToJoin = callable(async (req) => {
  const c = caller(req);
  const code = reqStr(req.data.code, 20, "the join code").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const found = await db.collection("institutions").where("joinCode", "==", code).limit(1).get();
  if (found.empty) throw fail.notFound("That join code isn't valid. Check it with your administrator.");
  const d = found.docs[0];
  const instId = d.id;
  const institution = { id: instId, ...d.data() } as Institution;
  if ((await memberRef(instId, c.uid).get()).data()?.status === "active") return { instId, status: "member" };
  const jr: JoinRequest = {
    userId: c.uid, name: str(req.data.name, 120) || c.name, email: c.email, phone: String((req.auth?.token as Record<string, unknown>).phone_number ?? ""),
    jobTitle: str(req.data.jobTitle, 60), department: str(req.data.department, 80), status: "pending", createdAt: Timestamp.now(), decidedBy: null, decidedAt: null,
  };
  await db.doc(`institutions/${instId}/joinRequests/${c.uid}`).set(jr);
  await notify(instId, "approval_request", await managers(instId), {
    title: "New request to join", body: `${jr.name || jr.email || jr.phone} asked to join ${institution.name}.`, path: "/app/admin/people?tab=requests",
    email: { subject: `${jr.name || "Someone"} asked to join ${institution.name} on DocInsight`, lines: [`${jr.name || jr.email || jr.phone} (${jr.jobTitle || "no job title given"}) used your join code. Approve or decline the request in DocInsight.`] },
  });
  return { instId, status: "pending", institution: await publicInstInfo(institution) };
});

export const decideJoinRequest = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const uid = id(req.data.userId, "user");
  const ref = db.doc(`institutions/${ctx.instId}/joinRequests/${uid}`);
  const jr = (await ref.get()).data() as JoinRequest | undefined;
  if (!jr || jr.status !== "pending") throw fail.notFound("This request was already handled.");
  const approve = req.data.approve === true;
  if (approve) {
    const role = oneOf(req.data.role, STAFF_ROLES, "staff");
    const exp = req.data.locumExpiresAt ? new Date(String(req.data.locumExpiresAt)) : null;
    if (role === "locum" && (!exp || isNaN(exp.getTime()))) throw fail.invalid("Locum access needs an end date.");
    await addMember(ctx.instId, ctx.inst, uid, {
      role, name: jr.name, email: jr.email, phone: jr.phone, jobTitle: str(req.data.jobTitle, 60) || jr.jobTitle, department: str(req.data.department, 80) || jr.department,
      spaceIds: strList(req.data.spaceIds, 50, 128), expiresAt: exp ? Timestamp.fromDate(exp) : null,
    }, { uid: ctx.c.uid, name: ctx.member.name }, "join code");
  }
  await ref.update({ status: approve ? "approved" : "declined", decidedBy: ctx.c.uid, decidedAt: FieldValue.serverTimestamp() });
  if (jr.email) await sendEmail({ to: jr.email, subject: approve ? `You've joined ${ctx.inst.name} on DocInsight` : `Your request to join ${ctx.inst.name}`, lines: [approve ? `Your request was approved. Open DocInsight to see ${ctx.inst.name}'s protocols.` : `Your request to join ${ctx.inst.name} wasn't approved. Contact your administrator if you think this is a mistake.`], button: approve ? { label: "Open DocInsight", url: `${APP_URL.value()}/app` } : undefined });
  return { ok: true };
});

export const regenerateJoinCode = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const code = randomId(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  await inst(ctx.instId).update({ joinCode: code });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "settings.update", target: { type: "institution", id: ctx.instId, title: "Join code" }, after: { joinCode: "regenerated" } });
  return { joinCode: code };
});

export const updateMember = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const uid = id(req.data.userId, "user");
  const ref = memberRef(ctx.instId, uid);
  const before = (await ref.get()).data() as Member | undefined;
  if (!before) throw fail.notFound("This person isn't a member.");
  const d = req.data;
  const update: Record<string, unknown> = {};
  if (d.role !== undefined) {
    const role = oneOf(d.role, ROLES, before.role);
    if ((role === "owner" || role === "admin" || before.role === "owner" || before.role === "admin") && !ctx.isOwner && role !== before.role) throw fail.denied("Only the owner can make someone an admin or owner, or change an admin's role.");
    if (before.role === "owner" && role !== "owner") {
      const owners = (await db.collection(`institutions/${ctx.instId}/members`).where("role", "==", "owner").where("status", "==", "active").count().get()).data().count;
      if (owners <= 1) throw fail.precondition("An institution needs an owner. Make someone else the owner first.");
    }
    update.role = role;
    if (role === "owner" && uid !== ctx.c.uid && d.transferOwnership === true) await memberRef(ctx.instId, ctx.c.uid).update({ role: "admin" });
  }
  if (d.jobTitle !== undefined) update.jobTitle = str(d.jobTitle, 60);
  if (d.department !== undefined) update.department = str(d.department, 80);
  if (d.name !== undefined) update.name = str(d.name, 120);
  if (d.spaceIds !== undefined) update.spaceIds = strList(d.spaceIds, 50, 128);
  if (d.expiresAt !== undefined) {
    const exp = d.expiresAt ? new Date(String(d.expiresAt)) : null;
    if (exp && isNaN(exp.getTime())) throw fail.invalid("Invalid end date.");
    update.expiresAt = exp ? Timestamp.fromDate(exp) : null;
  }
  if (!Object.keys(update).length) return { ok: true };
  await ref.update(update);
  await recomputeMembers(ctx.instId, [uid, ctx.c.uid]);
  await syncUser(uid);
  const { before: b, after: a } = diff(before as unknown as Record<string, unknown>, { ...before, ...update } as unknown as Record<string, unknown>);
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "member.update", target: { type: "member", id: uid, title: before.name || before.email }, before: b, after: a });
  return { ok: true };
});

/** Deactivates a member: access ends on their next request. The record stays for the audit trail. */
export const removeMember = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const uid = id(req.data.userId, "user");
  const ref = memberRef(ctx.instId, uid);
  const before = (await ref.get()).data() as Member | undefined;
  if (!before) throw fail.notFound();
  if (before.role === "owner") throw fail.precondition("The owner can't be removed. Transfer ownership first.");
  if (before.role === "admin" && !ctx.isOwner) throw fail.denied("Only the owner can remove an admin.");
  const reactivate = req.data.reactivate === true;
  if (reactivate) await requireSeats(ctx.inst);
  await ref.update({ status: reactivate ? "active" : "deactivated", access: reactivate ? before.access : "none" });
  if (!reactivate) {
    // Drop them from space editor and approver lists
    const spaces = await db.collection(`institutions/${ctx.instId}/spaces`).get();
    await Promise.all(spaces.docs.filter((s) => (s.data().editorIds ?? []).includes(uid) || (s.data().approverIds ?? []).includes(uid) || (s.data().allowedUserIds ?? []).includes(uid)).map(async (s) => {
      const approverIds = (s.data().approverIds as string[]).filter((x) => x !== uid);
      const approverNames = (await Promise.all(approverIds.map((u) => memberRef(ctx.instId, u).get()))).map((x) => x.data()?.name ?? "").filter(Boolean);
      await s.ref.update({ editorIds: FieldValue.arrayRemove(uid), approverIds, approverNames, allowedUserIds: FieldValue.arrayRemove(uid) });
    }));
  }
  await recomputeMembers(ctx.instId, [uid]);
  await syncUser(uid);
  await inst(ctx.instId).update({ seatsUsed: (await db.collection(`institutions/${ctx.instId}/members`).where("status", "==", "active").count().get()).data().count });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "member.remove", target: { type: "member", id: uid, title: before.name || before.email }, before: { status: before.status }, after: { status: reactivate ? "active" : "deactivated" } });
  return { ok: true };
});

export const forceSignOut = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const uid = id(req.data.userId, "user");
  const before = (await memberRef(ctx.instId, uid).get()).data() as Member | undefined;
  if (!before) throw fail.notFound();
  const at = Math.floor(Date.now() / 1000) + 1;
  await memberRef(ctx.instId, uid).update({ signOutBefore: at });
  await adminAuth().revokeRefreshTokens(uid).catch(() => {});
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "member.signout", target: { type: "member", id: uid, title: before.name || before.email }, after: { signOutBefore: new Date(at * 1000).toISOString() } });
  return { ok: true };
});

/** A member edits their own name and phone (job title is set by admins: it controls space access). */
export const updateMyProfile = callable(async (req) => {
  const c = caller(req);
  const name = str(req.data.name, 120);
  const phone = str(req.data.phone, 30);
  const user = await db.doc(`users/${c.uid}`).get();
  const ids: string[] = user.data()?.institutionIds ?? [];
  await db.doc(`users/${c.uid}`).set({ ...(name && { name }), ...(phone && { phone }) }, { merge: true });
  await Promise.all(ids.map((i) => memberRef(i, c.uid).update({ ...(name && { name }), ...(phone && { phone }) }).catch(() => {})));
  return { ok: true };
});

export const jobTitles = () => JOB_TITLES;
