// Recomputes the fields security rules read on each member document:
// access (from billing status + role), visibleSpaceIds, editSpaceIds, approveSpaceIds.
// Also keeps token claims and users/{uid}.hubAccess in step.
import type { Institution, Member, Space } from "../../../shared/src/types";
import { memberAccess } from "../../../shared/src/billing";
import { adminAuth, batchWrite, db, FieldValue } from "./admin";

export function spaceRights(m: Pick<Member, "userId" | "role" | "jobTitle" | "spaceIds">, spaces: Space[]) {
  const manager = m.role === "owner" || m.role === "admin";
  const live = spaces.filter((s) => !s.archived);
  const visible = manager ? spaces : live.filter((s) =>
    s.visibility === "all" || s.allowedUserIds.includes(m.userId) || m.spaceIds.includes(s.id) ||
    (m.jobTitle && s.allowedJobTitles.includes(m.jobTitle)) || s.editorIds.includes(m.userId) || s.approverIds.includes(m.userId));
  return {
    visibleSpaceIds: visible.map((s) => s.id),
    editSpaceIds: (manager ? spaces : live.filter((s) => s.editorIds.includes(m.userId))).map((s) => s.id),
    approveSpaceIds: (manager ? spaces : live.filter((s) => s.approverIds.includes(m.userId))).map((s) => s.id),
  };
}

export async function loadSpaces(instId: string): Promise<Space[]> {
  const snap = await db.collection(`institutions/${instId}/spaces`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Space);
}

/** Recompute rights for some or all members of an institution. */
export async function recomputeMembers(instId: string, userIds?: string[]): Promise<void> {
  const [instSnap, spaces] = await Promise.all([db.doc(`institutions/${instId}`).get(), loadSpaces(instId)]);
  if (!instSnap.exists) return;
  const institution = instSnap.data() as Institution;
  const col = db.collection(`institutions/${instId}/members`);
  const docs = userIds ? (await Promise.all(userIds.map((u) => col.doc(u).get()))).filter((d) => d.exists) : (await col.get()).docs;
  const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
  const changedUsers: string[] = [];
  for (const d of docs) {
    const m = d.data() as Member;
    const rights = spaceRights({ ...m, userId: d.id }, spaces);
    const access = m.status === "active" ? memberAccess(institution.status, m.role) : "none";
    const next = { ...rights, access };
    const cur = { visibleSpaceIds: m.visibleSpaceIds, editSpaceIds: m.editSpaceIds, approveSpaceIds: m.approveSpaceIds, access: m.access };
    if (JSON.stringify(cur) !== JSON.stringify(next)) {
      ops.push((b) => b.update(d.ref, next));
      if (cur.access !== next.access) changedUsers.push(d.id);
    }
  }
  await batchWrite(ops);
  await Promise.all(changedUsers.map((u) => syncUser(u)));
}

/** Token claims ({ insts: { id: role } }) and users/{uid}.hubAccess / institutionIds. */
export async function syncUser(uid: string): Promise<void> {
  const memberships = await db.collectionGroup("members").where("userId", "==", uid).get();
  const insts: Record<string, string> = {};
  let hubAccess = false;
  const ids: string[] = [];
  for (const d of memberships.docs) {
    const m = d.data() as Member;
    const instId = d.ref.parent.parent!.id;
    if (m.status !== "active") continue;
    ids.push(instId);
    insts[instId] = m.role;
    if (m.access === "full" || m.access === "read") hubAccess = true;
  }
  const userRef = db.doc(`users/${uid}`);
  const user = await userRef.get();
  const update: Record<string, unknown> = { institutionIds: ids, hubAccess };
  if (!user.exists || !ids.includes(user.data()?.defaultInstitutionId)) update.defaultInstitutionId = ids[0] ?? null;
  await userRef.set(update, { merge: true });
  try {
    const u = await adminAuth().getUser(uid);
    const pa = (await db.doc(`platformAdmins/${uid}`).get()).exists;
    await adminAuth().setCustomUserClaims(uid, { ...(u.customClaims ?? {}), insts, pa });
  } catch {
    /* user may have been deleted */
  }
}

export async function touchActivity(instId: string, uid: string): Promise<void> {
  const ts = FieldValue.serverTimestamp();
  await Promise.all([
    db.doc(`institutions/${instId}/members/${uid}`).update({ lastActiveAt: ts }).catch(() => {}),
    db.doc(`institutions/${instId}`).update({ lastActivityAt: ts }).catch(() => {}),
    db.doc(`users/${uid}`).set({ lastActiveAt: ts }, { merge: true }),
  ]);
}
