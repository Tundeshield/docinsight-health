// Hospital registration, invite links and team roles.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue, randomId } from "./admin.js";
import { APP_URL } from "./config.js";
import { requireAuth, requireMember, MANAGER_ROLES } from "./access.js";

const clean = (v, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ORG_TYPES = ["private_hospital", "public_hospital", "teaching_hospital", "clinic", "diagnostic_centre", "hmo", "equipment_distributor", "other"];

export const createOrganization = onCall(async (request) => {
  const uid = requireAuth(request);
  const name = clean(request.data?.name), city = clean(request.data?.city, 60), phone = clean(request.data?.phone, 30);
  const type = ORG_TYPES.includes(request.data?.type) ? request.data.type : "other";
  const yourName = clean(request.data?.yourName, 80), jobTitle = clean(request.data?.jobTitle, 80);
  if (name.length < 2) throw new HttpsError("invalid-argument", "Enter your hospital's name.");
  const owned = await db.collection("orgs").where("ownerUid", "==", uid).count().get();
  if (owned.data().count >= 3) throw new HttpsError("resource-exhausted", "You can register up to 3 organisations. Contact Avelon for more.");
  const ref = db.collection("orgs").doc();
  const email = request.auth.token.email || "";
  await db.runTransaction(async (tx) => {
    tx.set(ref, { name, type, city, phone, country: "NG", ownerUid: uid, plan: "pilot", billingExempt: false, billing: { status: "none" }, corpusVersion: 0, createdAt: FieldValue.serverTimestamp() });
    tx.set(ref.collection("members").doc(uid), { role: "owner", email, name: yourName, jobTitle, joinedAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`users/${uid}`), { email, name: yourName, orgId: ref.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { orgId: ref.id };
});

export const createInvite = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId } = request.data || {};
  const role = request.data?.role === "manager" ? "manager" : "staff";
  const { member } = await requireMember(uid, orgId, MANAGER_ROLES);
  if (role === "manager" && member.role !== "owner") throw new HttpsError("permission-denied", "Only the owner can invite library managers.");
  const token = randomId(24);
  await db.doc(`orgs/${orgId}/invites/${token}`).set({ role, createdBy: uid, createdAt: FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + 14 * 864e5), uses: 0, maxUses: 200, revoked: false });
  return { link: `${APP_URL.value()}/join/${orgId}/${token}`, role, expiresInDays: 14 };
});

export const getInvite = onCall(async (request) => {
  requireAuth(request);
  const { orgId, token } = request.data || {};
  if (typeof orgId !== "string" || typeof token !== "string") throw new HttpsError("invalid-argument", "This invite link is incomplete.");
  const [inv, org] = await Promise.all([db.doc(`orgs/${orgId}/invites/${token}`).get(), db.doc(`orgs/${orgId}`).get()]);
  if (!inv.exists || !org.exists) throw new HttpsError("not-found", "This invite link isn't valid. Ask for a new one.");
  const i = inv.data();
  if (i.revoked || i.expiresAt.toDate() < new Date() || i.uses >= i.maxUses) throw new HttpsError("failed-precondition", "This invite link has expired. Ask for a new one.");
  return { orgName: org.data().name, role: i.role };
});

export const acceptInvite = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, token } = request.data || {};
  const name = clean(request.data?.name, 80), jobTitle = clean(request.data?.jobTitle, 80);
  const invRef = db.doc(`orgs/${orgId}/invites/${token}`);
  const memRef = db.doc(`orgs/${orgId}/members/${uid}`);
  await db.runTransaction(async (tx) => {
    const [inv, mem] = await Promise.all([tx.get(invRef), tx.get(memRef)]);
    if (!inv.exists) throw new HttpsError("not-found", "This invite link isn't valid. Ask for a new one.");
    const i = inv.data();
    if (i.revoked || i.expiresAt.toDate() < new Date() || i.uses >= i.maxUses) throw new HttpsError("failed-precondition", "This invite link has expired. Ask for a new one.");
    if (!mem.exists) {
      tx.set(memRef, { role: i.role, email: request.auth.token.email || "", name, jobTitle, joinedAt: FieldValue.serverTimestamp(), invitedBy: i.createdBy });
      tx.update(invRef, { uses: FieldValue.increment(1) });
    }
    tx.set(db.doc(`users/${uid}`), { email: request.auth.token.email || "", name, orgId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { orgId };
});

export const revokeInvite = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, token } = request.data || {};
  await requireMember(uid, orgId, MANAGER_ROLES);
  await db.doc(`orgs/${orgId}/invites/${token}`).update({ revoked: true });
  return { ok: true };
});

export const setMemberRole = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, memberUid } = request.data || {};
  const role = request.data?.role === "manager" ? "manager" : "staff";
  await requireMember(uid, orgId, ["owner"]);
  const ref = db.doc(`orgs/${orgId}/members/${memberUid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That person isn't in this organisation.");
  if (snap.data().role === "owner") throw new HttpsError("failed-precondition", "The owner's role can't be changed.");
  await ref.update({ role });
  return { ok: true };
});

export const removeMember = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, memberUid } = request.data || {};
  const { member } = await requireMember(uid, orgId, MANAGER_ROLES);
  const ref = db.doc(`orgs/${orgId}/members/${memberUid}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  const target = snap.data().role;
  if (target === "owner") throw new HttpsError("failed-precondition", "The owner can't be removed.");
  if (target === "manager" && member.role !== "owner") throw new HttpsError("permission-denied", "Only the owner can remove library managers.");
  await ref.delete();
  const userRef = db.doc(`users/${memberUid}`); const u = await userRef.get();
  if (u.exists && u.data().orgId === orgId) await userRef.update({ orgId: FieldValue.delete() });
  return { ok: true };
});
