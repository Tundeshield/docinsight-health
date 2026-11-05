import type { BillingCycle, Institution, InstitutionSettings, PlanId, Site } from "../../../shared/src/types";
import { SPACE_TEMPLATES } from "../../../shared/src/config";
import { db, FieldValue, inst, randomId, Timestamp } from "../lib/admin";
import { caller, isPlatformAdmin, requireMember, requirePlatformAdmin } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { bool, fail, oneOf, reqStr, str, strList } from "../lib/errors";
import { callable } from "../lib/fn";
import { getPlan, loadConfig } from "../lib/plans";
import { recomputeMembers, syncUser } from "../lib/visibility";
import { createSpaceDocs } from "./spaces";
import { createInviteDocs } from "./members";
import { ensureOpeningInvoice } from "./billing";

const PLAN_IDS: readonly PlanId[] = ["clinic", "hospital", "group"];
const COLOUR = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_SETTINGS: InstitutionSettings = {
  phoneLogin: false, dataSaverDefault: false, hiddenHubCollections: [], questionLogOptIn: false, requireAdmin2fa: false, emailDigest: true,
};

async function uniqueJoinCode(): Promise<string> {
  for (;;) {
    const code = randomId(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    const taken = await db.collection("institutions").where("joinCode", "==", code).limit(1).get();
    if (taken.empty) return code;
  }
}

interface SetupInput {
  name: string; country: string; colour: string; planId: PlanId; billingCycle: BillingCycle; setupPackageId: "standard" | "large" | null;
  sites: { name: string; address: string }[]; templates: string[]; admins: { email: string; name: string }[];
  billingContact: { name: string; email: string; phone: string };
}

function parseSetup(d: Record<string, unknown>): SetupInput {
  const name = reqStr(d.name, 120, "the institution's name");
  if (name.length < 2) throw fail.invalid("Enter the institution's name.");
  const sites = (Array.isArray(d.sites) ? d.sites : []).slice(0, 50).map((s: Record<string, unknown>) => ({ name: str(s?.name, 120), address: str(s?.address, 300) })).filter((s) => s.name);
  const admins = (Array.isArray(d.admins) ? d.admins : []).slice(0, 20).map((a: Record<string, unknown>) => ({ email: str(a?.email, 200).toLowerCase(), name: str(a?.name, 120) })).filter((a) => /@/.test(a.email));
  const bc = (d.billingContact ?? {}) as Record<string, unknown>;
  return {
    name,
    country: str(d.country, 2).toUpperCase() || "NG",
    colour: COLOUR.test(String(d.colour)) ? String(d.colour) : "#0E7A68",
    planId: oneOf(d.planId, PLAN_IDS, "clinic"),
    billingCycle: oneOf(d.billingCycle, ["monthly", "annual"] as const, "monthly"),
    setupPackageId: d.setupPackageId === "large" ? "large" : d.setupPackageId === "none" ? null : "standard",
    sites: sites.length ? sites : [{ name: "Main site", address: "" }],
    templates: strList(d.templates, 30, 40).filter((t) => SPACE_TEMPLATES.some((x) => x.key === t)),
    admins,
    billingContact: { name: str(bc.name, 120), email: str(bc.email, 200), phone: str(bc.phone, 30) },
  };
}

/** Creates the tenant, its sites and spaces, and invites the first admins. Starts in Pending payment. */
async function createTenant(s: SetupInput, ownerUid: string | null, actor: { uid: string; name: string; email: string }, opts: { ownerEmail?: string; pilot?: boolean; discountPct?: number } = {}) {
  const plan = await getPlan(s.planId);
  if (plan.siteLimit != null && s.sites.length > plan.siteLimit) throw fail.invalid(`The ${plan.name} plan includes ${plan.siteLimit} site. Choose Group for more sites.`);
  const { billing } = await loadConfig();
  const ref = db.collection("institutions").doc();
  const instId = ref.id;
  const nowTs = Timestamp.now();
  const institution: Omit<Institution, "id"> = {
    name: s.name, logoRef: null, colour: s.colour, country: s.country, planId: s.planId, billingCycle: s.billingCycle,
    status: "pending_payment", statusChangedAt: nowTs, currentPeriodEnd: null, pastDueSince: null, cancelledAt: null, remindersSent: [],
    seatsUsed: ownerUid ? 1 : 0, extraSeats: 0, billingContact: s.billingContact.email ? s.billingContact : { name: actor.name, email: actor.email, phone: s.billingContact.phone },
    emailDomains: [], settings: { ...DEFAULT_SETTINGS, requireAdmin2fa: s.planId === "group" }, joinCode: await uniqueJoinCode(),
    discountPct: Math.max(0, Math.min(100, opts.discountPct ?? 0)),
    pilot: opts.pilot ? { startedAt: nowTs, endsAt: Timestamp.fromMillis(Date.now() + billing.pilotDays * 86_400_000), discountPct: billing.pilotDiscountPct } : null,
    setupPackageId: s.setupPackageId, corpusVersion: 0, createdBy: actor.uid, createdAt: nowTs, lastActivityAt: nowTs,
  };
  const batch = db.batch();
  batch.set(ref, institution);
  const siteIds: string[] = [];
  for (const site of s.sites) {
    const sr = ref.collection("sites").doc();
    siteIds.push(sr.id);
    batch.set(sr, { id: sr.id, name: site.name, address: site.address, createdAt: nowTs } satisfies Site);
  }
  if (ownerUid) {
    batch.set(ref.collection("members").doc(ownerUid), {
      userId: ownerUid, role: "owner", name: actor.name, email: actor.email, phone: "", jobTitle: "Administrator", department: "Management", spaceIds: [],
      status: "active", expiresAt: null, invitedBy: null, joinedAt: nowTs, lastActiveAt: nowTs,
      access: "full", visibleSpaceIds: [], editSpaceIds: [], approveSpaceIds: [], signOutBefore: 0,
    });
  }
  await audit({ instId, actorId: actor.uid, actorName: actor.name, action: "institution.create", target: { type: "institution", id: instId, title: s.name }, after: { name: s.name, planId: s.planId, billingCycle: s.billingCycle, status: "pending_payment" } }, batch);
  await batch.commit();
  const templates = s.templates.length ? s.templates : ["hospital-wide"];
  await createSpaceDocs(instId, templates.map((key) => ({ template: key, siteId: s.sites.length > 1 ? null : siteIds[0] ?? null })), actor);
  const invites = [
    ...s.admins.filter((a) => a.email !== actor.email.toLowerCase()).map((a) => ({ email: a.email, phone: null, name: a.name, role: "admin" as const, jobTitle: "Administrator", department: "", spaceIds: [], locumExpiresAt: null })),
    ...(opts.ownerEmail ? [{ email: opts.ownerEmail, phone: null, name: s.billingContact.name, role: "owner" as const, jobTitle: "Administrator", department: "", spaceIds: [], locumExpiresAt: null }] : []),
  ];
  if (invites.length) await createInviteDocs(instId, s.name, invites, actor, true);
  await recomputeMembers(instId);
  if (ownerUid) await syncUser(ownerUid);
  await ensureOpeningInvoice(instId);
  return instId;
}

/** F1(a): self-serve signup from the website. */
export const createInstitution = callable(async (req) => {
  const c = caller(req);
  const owned = await db.collection("institutions").where("createdBy", "==", c.uid).count().get();
  if (owned.data().count >= 3 && !(await isPlatformAdmin(c.uid))) throw fail.limit("You can register up to 3 institutions. Contact DocInsight to add more.");
  const s = parseSetup(req.data);
  const name = str(req.data.yourName, 120) || c.name || c.email;
  const instId = await createTenant(s, c.uid, { uid: c.uid, name, email: c.email });
  await db.doc(`users/${c.uid}`).set({ name, email: c.email, defaultInstitutionId: instId }, { merge: true });
  return { instId };
});

/** F1(b): DocInsight staff create an institution for a sales-led deal and invite its owner. */
export const platformCreateInstitution = callable(async (req) => {
  const c = await requirePlatformAdmin(req);
  const s = parseSetup(req.data);
  const ownerEmail = reqStr(req.data.ownerEmail, 200, "the owner's email").toLowerCase();
  const instId = await createTenant(s, null, { uid: c.uid, name: "DocInsight", email: c.email }, { ownerEmail, pilot: bool(req.data.pilot), discountPct: Number(req.data.discountPct) || 0 });
  return { instId };
});

export const updateInstitution = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const d = req.data;
  const before = { name: ctx.inst.name, colour: ctx.inst.colour, logoRef: ctx.inst.logoRef, country: ctx.inst.country, emailDomains: ctx.inst.emailDomains, settings: ctx.inst.settings, billingContact: ctx.inst.billingContact };
  const update: Record<string, unknown> = {};
  if (d.name !== undefined) update.name = reqStr(d.name, 120, "a name");
  if (d.colour !== undefined && COLOUR.test(String(d.colour))) update.colour = d.colour;
  if (d.logoRef !== undefined) {
    const lr = str(d.logoRef, 300);
    if (lr && !lr.startsWith(`inst/${ctx.instId}/branding/`)) throw fail.invalid("Invalid logo.");
    update.logoRef = lr || null;
  }
  if (d.country !== undefined) update.country = str(d.country, 2).toUpperCase();
  if (d.emailDomains !== undefined) {
    const domains = strList(d.emailDomains, 10, 100).map((x) => x.toLowerCase().replace(/^@/, "")).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x));
    const generic = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "ymail.com", "live.com", "aol.com", "proton.me", "protonmail.com"];
    if (domains.some((x) => generic.includes(x))) throw fail.invalid("Use your hospital's own email domain, not a public one like gmail.com.");
    update.emailDomains = domains;
  }
  if (d.settings && typeof d.settings === "object") {
    const s = d.settings as Record<string, unknown>;
    const cur = ctx.inst.settings ?? DEFAULT_SETTINGS;
    update.settings = {
      ...cur,
      ...(s.phoneLogin !== undefined && { phoneLogin: bool(s.phoneLogin) }),
      ...(s.dataSaverDefault !== undefined && { dataSaverDefault: bool(s.dataSaverDefault) }),
      ...(s.emailDigest !== undefined && { emailDigest: bool(s.emailDigest) }),
      ...(s.hiddenHubCollections !== undefined && { hiddenHubCollections: strList(s.hiddenHubCollections, 50, 100) }),
      // Only the owner may open individual question logs to admins, or relax 2FA (never below the Group plan's requirement)
      ...(s.questionLogOptIn !== undefined && ctx.isOwner && { questionLogOptIn: bool(s.questionLogOptIn) }),
      ...(s.requireAdmin2fa !== undefined && ctx.isOwner && { requireAdmin2fa: ctx.inst.planId === "group" ? true : bool(s.requireAdmin2fa) }),
    };
  }
  if (d.billingContact && typeof d.billingContact === "object" && ctx.isOwner) {
    const b = d.billingContact as Record<string, unknown>;
    update.billingContact = { name: str(b.name, 120), email: str(b.email, 200), phone: str(b.phone, 30) };
  }
  if (!Object.keys(update).length) return { ok: true };
  if ((update.settings as InstitutionSettings | undefined)?.hiddenHubCollections !== undefined) update.corpusVersion = FieldValue.increment(1);
  await inst(ctx.instId).update(update);
  const { before: b, after: a } = diff(before as Record<string, unknown>, { ...before, ...update, corpusVersion: undefined } as Record<string, unknown>);
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "settings.update", target: { type: "institution", id: ctx.instId, title: ctx.inst.name }, before: b, after: a });
  return { ok: true };
});

export const saveSite = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const plan = await getPlan(ctx.inst.planId);
  const name = reqStr(req.data.name, 120, "a site name");
  const address = str(req.data.address, 300);
  const col = db.collection(`institutions/${ctx.instId}/sites`);
  if (req.data.siteId) {
    const ref = col.doc(String(req.data.siteId));
    const before = (await ref.get()).data();
    if (!before) throw fail.notFound();
    await ref.update({ name, address });
    await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "site.update", target: { type: "site", id: ref.id, title: name }, ...diff(before, { ...before, name, address }) });
    return { siteId: ref.id };
  }
  const count = (await col.count().get()).data().count;
  if (plan.siteLimit != null && count >= plan.siteLimit) throw fail.limit(`Your plan includes ${plan.siteLimit} site. Upgrade to Group for multiple sites.`, { reason: "sites" });
  const ref = col.doc();
  await ref.set({ id: ref.id, name, address, createdAt: FieldValue.serverTimestamp() });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "site.create", target: { type: "site", id: ref.id, title: name }, after: { name, address } });
  return { siteId: ref.id };
});

/**
 * Called by the web app after every sign-in. Creates the profile, grants platform admin to
 * verified configured emails, and auto-joins verified users on approved email domains.
 */
export const ensureUser = callable(async (req) => {
  const c = caller(req);
  const userRef = db.doc(`users/${c.uid}`);
  const user = await userRef.get();
  const phone = String((req.auth?.token as Record<string, unknown>).phone_number ?? "");
  if (!user.exists) {
    await userRef.set({ id: c.uid, name: c.name, email: c.email, phone, institutionIds: [], defaultInstitutionId: null, hubAccess: false, lastActiveAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
  } else {
    await userRef.set({ lastActiveAt: FieldValue.serverTimestamp(), ...(c.email && { email: c.email }), ...(phone && { phone }) }, { merge: true });
  }
  const { platform } = await loadConfig();
  let platformAdmin = await isPlatformAdmin(c.uid);
  if (!platformAdmin && c.emailVerified && platform.adminEmails.map((e) => e.toLowerCase()).includes(c.email.toLowerCase())) {
    await db.doc(`platformAdmins/${c.uid}`).set({ email: c.email, grantedAt: FieldValue.serverTimestamp() });
    platformAdmin = true;
  }
  const joined: string[] = [];
  if (c.emailVerified && c.email.includes("@")) {
    const domain = c.email.split("@")[1].toLowerCase();
    const matches = await db.collection("institutions").where("emailDomains", "array-contains", domain).limit(5).get();
    for (const d of matches.docs) {
      const institution = { id: d.id, ...d.data() } as Institution;
      const mref = d.ref.collection("members").doc(c.uid);
      if ((await mref.get()).exists) continue;
      if (!["active", "past_due"].includes(institution.status)) continue;
      try {
        const { requireSeats } = await import("../lib/plans");
        await requireSeats(institution);
      } catch { continue; }
      await mref.set({
        userId: c.uid, role: "staff", name: c.name || c.email, email: c.email, phone, jobTitle: "", department: "", spaceIds: [],
        status: "active", expiresAt: null, invitedBy: "email-domain", joinedAt: FieldValue.serverTimestamp(), lastActiveAt: null,
        access: "full", visibleSpaceIds: [], editSpaceIds: [], approveSpaceIds: [], signOutBefore: 0,
      });
      await recomputeMembers(d.id, [c.uid]);
      await audit({ instId: d.id, actorId: c.uid, actorName: c.name || c.email, action: "member.join", target: { type: "member", id: c.uid, title: c.email }, after: { via: "email domain", domain, role: "staff" } });
      joined.push(d.id);
    }
  }
  await syncUser(c.uid);
  const fresh = (await userRef.get()).data()!;
  if (req.data.fresh === true) {
    // Record the sign-in in each institution's audit log (F14)
    await Promise.all((fresh.institutionIds ?? []).map((instId: string) => audit({ instId, actorId: c.uid, actorName: c.name || c.email, action: "signin", target: { type: "member", id: c.uid, title: c.email || phone } })));
  }
  return { platformAdmin, institutionIds: fresh.institutionIds ?? [], defaultInstitutionId: fresh.defaultInstitutionId ?? null, autoJoined: joined };
});

export const setDefaultInstitution = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId);
  await db.doc(`users/${ctx.c.uid}`).set({ defaultInstitutionId: ctx.instId }, { merge: true });
  return { ok: true };
});
