// Membership and role checks shared by every function.
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin.js";

export const MANAGER_ROLES = ["owner", "manager"];

export function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return request.auth.uid;
}

/** Loads the org and the caller's membership; throws unless the caller has one of `roles`. */
export async function requireMember(uid, orgId, roles = null) {
  if (typeof orgId !== "string" || !orgId) throw new HttpsError("invalid-argument", "Missing organisation.");
  const [orgSnap, memSnap] = await Promise.all([db.doc(`orgs/${orgId}`).get(), db.doc(`orgs/${orgId}/members/${uid}`).get()]);
  if (!orgSnap.exists || !memSnap.exists) throw new HttpsError("permission-denied", "You're not a member of this organisation.");
  const member = memSnap.data();
  if (roles && !roles.includes(member.role)) throw new HttpsError("permission-denied", "Only library managers can do this.");
  return { org: { id: orgId, ...orgSnap.data() }, member };
}
