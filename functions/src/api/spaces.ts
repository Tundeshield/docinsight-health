// F3: spaces (departments) and sections, with templates, visibility, editors and approvers.
import type { Space } from "../../../shared/src/types";
import { SPACE_TEMPLATES } from "../../../shared/src/config";
import { db, FieldValue, batchWrite } from "../lib/admin";
import { requireMember, getSpace } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { bool, fail, id, oneOf, reqStr, str, strList } from "../lib/errors";
import { callable } from "../lib/fn";
import { recomputeMembers } from "../lib/visibility";

const COLOUR = /^#[0-9a-fA-F]{6}$/;

async function names(instId: string, uids: string[]): Promise<string[]> {
  if (!uids.length) return [];
  const snaps = await Promise.all(uids.map((u) => db.doc(`institutions/${instId}/members/${u}`).get()));
  return snaps.map((s) => (s.data()?.name as string) || "").filter(Boolean);
}

async function validMembers(instId: string, uids: string[]): Promise<string[]> {
  const snaps = await Promise.all(uids.map((u) => db.doc(`institutions/${instId}/members/${u}`).get()));
  return snaps.filter((s) => s.exists && s.data()?.status === "active").map((s) => s.id);
}

/** Creates spaces (from templates or custom) with their sections. Used by setup and the admin UI. */
export async function createSpaceDocs(instId: string, items: { template?: string; name?: string; siteId?: string | null; data?: Partial<Space>; sections?: string[] }[], actor: { uid: string; name: string }): Promise<string[]> {
  const col = db.collection(`institutions/${instId}/spaces`);
  const existing = (await col.count().get()).data().count;
  const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
  const ids: string[] = [];
  items.forEach((it, i) => {
    const t = SPACE_TEMPLATES.find((x) => x.key === it.template);
    const ref = col.doc();
    ids.push(ref.id);
    const space: Space = {
      id: ref.id, siteId: it.siteId ?? null, name: it.name || t?.name || "New space", icon: t?.icon ?? "folder", colour: t?.colour ?? "#0E7A68", description: "",
      visibility: t?.visibility ?? "all", allowedUserIds: [], allowedJobTitles: t?.allowedJobTitles ?? [], editorIds: [], approverIds: [], approverNames: [],
      requiresApproval: t?.requiresApproval ?? true, order: existing + i, archived: false, template: t?.key ?? null, createdAt: FieldValue.serverTimestamp(),
      ...(it.data ?? {}),
    };
    ops.push((b) => b.set(ref, space));
    (it.sections ?? t?.sections ?? []).forEach((name, j) => {
      const sref = db.collection(`institutions/${instId}/sections`).doc();
      ops.push((b) => b.set(sref, { id: sref.id, spaceId: ref.id, name, order: j, archived: false }));
    });
    ops.push((b) => {
      const aref = db.collection(`institutions/${instId}/auditLog`).doc();
      b.set(aref, { id: aref.id, actorId: actor.uid, actorName: actor.name, action: "space.create", target: { type: "space", id: ref.id, title: space.name }, before: null, after: { name: space.name, visibility: space.visibility, template: space.template }, at: FieldValue.serverTimestamp() });
    });
  });
  await batchWrite(ops);
  return ids;
}

function spaceFields(d: Record<string, unknown>) {
  return {
    ...(d.name !== undefined && { name: reqStr(d.name, 80, "a space name") }),
    ...(d.icon !== undefined && { icon: str(d.icon, 40) || "folder" }),
    ...(d.colour !== undefined && COLOUR.test(String(d.colour)) && { colour: String(d.colour) }),
    ...(d.description !== undefined && { description: str(d.description, 300) }),
    ...(d.visibility !== undefined && { visibility: oneOf(d.visibility, ["all", "restricted"] as const, "all") }),
    ...(d.allowedUserIds !== undefined && { allowedUserIds: strList(d.allowedUserIds, 500, 128) }),
    ...(d.allowedJobTitles !== undefined && { allowedJobTitles: strList(d.allowedJobTitles, 50, 60) }),
    ...(d.editorIds !== undefined && { editorIds: strList(d.editorIds, 100, 128) }),
    ...(d.approverIds !== undefined && { approverIds: strList(d.approverIds, 50, 128) }),
    ...(d.requiresApproval !== undefined && { requiresApproval: bool(d.requiresApproval, true) }),
    ...(d.siteId !== undefined && { siteId: d.siteId ? id(d.siteId, "site") : null }),
  };
}

export const createSpace = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const fields = spaceFields(req.data) as Partial<Space>;
  for (const k of ["allowedUserIds", "editorIds", "approverIds"] as const) if (fields[k]) fields[k] = await validMembers(ctx.instId, fields[k]!);
  if (fields.approverIds) fields.approverNames = await names(ctx.instId, fields.approverIds);
  const sections = strList(req.data.sections, 30, 60);
  const [spaceId] = await createSpaceDocs(ctx.instId, [{ template: str(req.data.template, 40) || undefined, name: fields.name, siteId: fields.siteId, data: fields, sections: sections.length ? sections : undefined }], { uid: ctx.c.uid, name: ctx.member.name });
  await recomputeMembers(ctx.instId);
  return { spaceId };
});

export const updateSpace = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const space = await getSpace(ctx.instId, req.data.spaceId);
  const fields = spaceFields(req.data) as Partial<Space>;
  for (const k of ["allowedUserIds", "editorIds", "approverIds"] as const) if (fields[k]) fields[k] = await validMembers(ctx.instId, fields[k]!);
  if (fields.approverIds) fields.approverNames = await names(ctx.instId, fields.approverIds);
  if (req.data.archived !== undefined) (fields as Record<string, unknown>).archived = bool(req.data.archived);
  if (fields.requiresApproval === false && !["billing", "hr"].includes(space.template ?? "") && req.data.confirmNonClinical !== true) {
    throw fail.precondition("Turning off clinical approval means content in this space reaches staff and the AI without an approval record. Confirm this is a non-clinical space.", { reason: "confirm_non_clinical" });
  }
  await db.doc(`institutions/${ctx.instId}/spaces/${space.id}`).update(fields);
  const { before, after } = diff(space as unknown as Record<string, unknown>, { ...space, ...fields } as unknown as Record<string, unknown>);
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: (fields as Record<string, unknown>).archived ? "space.archive" : "space.update", target: { type: "space", id: space.id, title: space.name }, before, after });
  await recomputeMembers(ctx.instId);
  // Searchable scope changes when a space is archived or its visibility changes
  if ("archived" in fields || "visibility" in fields) await db.doc(`institutions/${ctx.instId}`).update({ corpusVersion: FieldValue.increment(1) });
  return { ok: true };
});

export const reorderSpaces = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const ids = strList(req.data.spaceIds, 200, 128);
  await batchWrite(ids.map((sid, i) => (b) => b.update(db.doc(`institutions/${ctx.instId}/spaces/${id(sid)}`), { order: i })));
  return { ok: true };
});

export const saveSection = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const space = await getSpace(ctx.instId, req.data.spaceId);
  const col = db.collection(`institutions/${ctx.instId}/sections`);
  if (req.data.sectionId) {
    const ref = col.doc(id(req.data.sectionId, "section"));
    const before = (await ref.get()).data();
    if (!before || before.spaceId !== space.id) throw fail.notFound();
    const update = { ...(req.data.name !== undefined && { name: reqStr(req.data.name, 60, "a section name") }), ...(req.data.archived !== undefined && { archived: bool(req.data.archived) }) };
    await ref.update(update);
    await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: (update as Record<string, unknown>).archived ? "section.archive" : "section.update", target: { type: "section", id: ref.id, title: String(before.name) }, ...diff(before, { ...before, ...update }) });
    return { sectionId: ref.id };
  }
  const name = reqStr(req.data.name, 60, "a section name");
  const order = (await col.where("spaceId", "==", space.id).count().get()).data().count;
  const ref = col.doc();
  await ref.set({ id: ref.id, spaceId: space.id, name, order, archived: false });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "section.create", target: { type: "section", id: ref.id, title: name }, after: { name, space: space.name } });
  return { sectionId: ref.id };
});

export const reorderSections = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const ids = strList(req.data.sectionIds, 200, 128);
  await batchWrite(ids.map((sid, i) => (b) => b.update(db.doc(`institutions/${ctx.instId}/sections/${id(sid)}`), { order: i })));
  return { ok: true };
});

export const addSpacesFromTemplates = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const keys = strList(req.data.templates, 20, 40).filter((k) => SPACE_TEMPLATES.some((t) => t.key === k));
  if (!keys.length) throw fail.invalid("Choose at least one department.");
  const ids = await createSpaceDocs(ctx.instId, keys.map((template) => ({ template })), { uid: ctx.c.uid, name: ctx.member.name });
  await recomputeMembers(ctx.instId);
  return { spaceIds: ids };
});
