// F4 content library, F5 approval workflow, F8 must-read and acknowledgements.
import type { ContentItem, ContentType, ContentVersion, DocumentType, InboxItem, Member, PageText } from "../../../shared/src/types";
import { DOCUMENT_TYPES } from "../../../shared/src/config";
import { batchWrite, db, FieldValue, Timestamp } from "../lib/admin";
import { canSee, getSpace, requireApprove, requireEdit, requireMember, type Ctx } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { bool, dateStr, fail, id, oneOf, reqStr, str, strList } from "../lib/errors";
import { callable } from "../lib/fn";
import { membersWhere, notify } from "../lib/notify";
import { requireDocRoom } from "../lib/plans";
import { contentRef, paths, versionRef, type Scope } from "../lib/scope";
import { touchActivity } from "../lib/visibility";
import { enqueueIngest } from "../pipeline/ingest";
import { activateChunks, bumpCorpus, enqueuePublish, moveContent } from "../pipeline/publish";
import { readJson, writeJson, type TextFile } from "../pipeline/store";

const TYPES: readonly ContentType[] = ["file", "page", "checklist", "link", "image"];
const DOC_TYPES = DOCUMENT_TYPES.map((d) => d.id) as readonly DocumentType[];
const MIME_OK = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif|tiff)|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|application\/octet-stream)$/;

const scopeFor = (ctx: Ctx): Scope => ({ kind: "inst", instId: ctx.instId });

async function loadContent(ctx: Ctx, cidRaw: unknown): Promise<ContentItem> {
  const cid = id(cidRaw, "content");
  const s = await contentRef(scopeFor(ctx), cid).get();
  if (!s.exists) throw fail.notFound("That document no longer exists.");
  return { id: s.id, ...s.data() } as ContentItem;
}
async function loadVersion(ctx: Ctx, cid: string, vidRaw: unknown): Promise<ContentVersion> {
  const vid = id(vidRaw, "version");
  const s = await versionRef(scopeFor(ctx), cid, vid).get();
  if (!s.exists) throw fail.notFound("That version no longer exists.");
  return { id: s.id, ...s.data() } as ContentVersion;
}

function versionBody(type: ContentType, d: Record<string, unknown>) {
  const body = type === "page" ? str(d.body, 200_000) : null;
  const checklist = type === "checklist" ? strList(d.checklist, 200, 500).map((text) => ({ text })) : null;
  const url = type === "link" ? str(d.url, 1000) : null;
  if (type === "page" && !body) throw fail.invalid("Write the page content.");
  if (type === "checklist" && !checklist?.length) throw fail.invalid("Add at least one checklist item.");
  if (type === "link" && !/^https?:\/\//.test(url ?? "")) throw fail.invalid("Enter a link starting with https://");
  return { body, checklist, url };
}

function newVersion(n: number, type: ContentType, ctx: Ctx, d: Record<string, unknown>, file: { name: string; size: number; mime: string } | null): ContentVersion {
  const b = versionBody(type, d);
  return {
    id: "", number: n, status: file ? "uploading" : "processing", fileRef: null, fileName: file?.name ?? null, mime: file?.mime ?? null, sizeBytes: file?.size ?? 0,
    pageCount: 0, pageLabels: [], ocrStatus: "pending", ocrConfidence: null, ocrPages: [], lowConfidencePages: [], checkedPages: [], processingError: null, processedPages: 0,
    body: b.body, checklist: b.checklist, url: b.url, changeNote: str(d.changeNote, 500), createdBy: ctx.c.uid, createdByName: ctx.member.name, createdAt: Timestamp.now(),
    submittedBy: null, submittedAt: null, reviewComment: null, reviewedBy: null, reviewedAt: null, approvedBy: null, approvedByName: null, approvedAt: null, active: false, chunkCount: 0,
  };
}

function parseFile(d: Record<string, unknown>, type: ContentType) {
  if (type !== "file" && type !== "image") return null;
  const f = (d.file ?? {}) as Record<string, unknown>;
  const name = str(f.name, 200).replace(/[^\w.\- ()]+/g, "_") || "document";
  const size = Number(f.size) || 0;
  const mime = str(f.mime, 120) || "application/octet-stream";
  if (!size) throw fail.invalid("Choose a file to upload.");
  if (size > 100 * 1024 * 1024) throw fail.invalid("Files must be under 100 MB. Split very large manuals into parts.");
  if (!MIME_OK.test(mime)) throw fail.invalid("Upload a PDF, Word (.docx) file, or a JPG or PNG image.");
  return { name, size, mime };
}

export const createContent = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { cap: "upload", allowPlatform: true });
  const d = req.data;
  const space = await getSpace(ctx.instId, d.spaceId);
  requireEdit(ctx, space);
  await requireDocRoom(ctx.inst);
  const type = oneOf(d.type, TYPES, "file");
  const sectionId = d.sectionId ? id(d.sectionId, "section") : null;
  if (sectionId) {
    const sec = (await db.doc(`institutions/${ctx.instId}/sections/${sectionId}`).get()).data();
    if (!sec || sec.spaceId !== space.id) throw fail.invalid("That section isn't in this space.");
  }
  const file = parseFile(d, type);
  const cref = db.collection(`institutions/${ctx.instId}/content`).doc();
  const vref = cref.collection("versions").doc();
  const title = reqStr(d.title, 200, "a title");
  const content: ContentItem = {
    id: cref.id, spaceId: space.id, sectionId, type, title, description: str(d.description, 1000), ownerId: ctx.c.uid, ownerName: ctx.member.name,
    documentType: oneOf(d.documentType, DOC_TYPES, "protocol"), tags: strList(d.tags, 20, 40), language: oneOf(d.language, ["en", "fr"] as const, "en"),
    status: "draft", published: false, currentVersionId: null, currentVersionNumber: null, latestVersionId: vref.id, versionCount: 1,
    effectiveDate: dateStr(d.effectiveDate), reviewDate: dateStr(d.reviewDate), reviewRemindersSent: [], mustRead: bool(d.mustRead), mustReadVersionId: null,
    pageCount: 0, approvedByName: null, approvedAt: null, url: type === "link" ? str(d.url, 1000) : null, source: "hospital",
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  };
  const version = { ...newVersion(1, type, ctx, d, file), id: vref.id, fileRef: file ? paths.upload(scopeFor(ctx), cref.id, vref.id, file.name) : null };
  const batch = db.batch();
  batch.set(cref, content);
  batch.set(vref, version);
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "content.create", target: { type: "content", id: cref.id, title }, after: { type, space: space.name, documentType: content.documentType, reviewDate: content.reviewDate } }, batch);
  await batch.commit();
  if (!file) await enqueueIngest(scopeFor(ctx), cref.id, vref.id);
  return { contentId: cref.id, versionId: vref.id, uploadPath: version.fileRef };
});

export const addVersion = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { cap: "upload", allowPlatform: true });
  const content = await loadContent(ctx, req.data.contentId);
  const space = await getSpace(ctx.instId, content.spaceId);
  requireEdit(ctx, space);
  const open = await contentRef(scopeFor(ctx), content.id).collection("versions").where("status", "in", ["uploading", "processing", "draft", "in_review", "changes_requested"]).get();
  if (!open.empty && req.data.replaceDraft !== true) throw fail.precondition("This document already has a version in progress. Finish or discard it first.", { reason: "open_version", versionId: open.docs[0].id });
  // Discard abandoned drafts when replacing
  await batchWrite(open.docs.map((d) => (b) => b.update(d.ref, { status: "rejected", reviewComment: "Replaced by a newer upload" })));
  const file = parseFile(req.data, content.type);
  const vref = contentRef(scopeFor(ctx), content.id).collection("versions").doc();
  const number = content.versionCount + 1;
  const version = { ...newVersion(number, content.type, ctx, req.data, file), id: vref.id, fileRef: file ? paths.upload(scopeFor(ctx), content.id, vref.id, file.name) : null };
  const batch = db.batch();
  batch.set(vref, version);
  batch.update(contentRef(scopeFor(ctx), content.id), { latestVersionId: vref.id, versionCount: number, status: content.published ? content.status : "draft", updatedAt: FieldValue.serverTimestamp() });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "version.upload", target: { type: "content", id: content.id, title: content.title }, after: { versionNumber: number, changeNote: version.changeNote, file: file?.name ?? null } }, batch);
  await batch.commit();
  if (!file) await enqueueIngest(scopeFor(ctx), content.id, vref.id);
  return { versionId: vref.id, uploadPath: version.fileRef };
});

/** After the browser finishes uploading the file, start processing. */
export const processVersion = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { cap: "upload", allowPlatform: true });
  const content = await loadContent(ctx, req.data.contentId);
  const version = await loadVersion(ctx, content.id, req.data.versionId);
  if (version.createdBy !== ctx.c.uid && !ctx.isManager) throw fail.denied();
  if (!["uploading", "draft"].includes(version.status)) return { ok: true };
  if (version.status === "draft" && !version.processingError) return { ok: true };
  await versionRef(scopeFor(ctx), content.id, version.id).update({ status: "processing", processingError: null, processedPages: 0 });
  await enqueueIngest(scopeFor(ctx), content.id, version.id);
  return { ok: true };
});

export const updateContent = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { allowPlatform: true });
  const content = await loadContent(ctx, req.data.contentId);
  const space = await getSpace(ctx.instId, content.spaceId);
  requireEdit(ctx, space);
  const d = req.data;
  const update: Partial<ContentItem> = {};
  if (d.title !== undefined) update.title = reqStr(d.title, 200, "a title");
  if (d.description !== undefined) update.description = str(d.description, 1000);
  if (d.documentType !== undefined) update.documentType = oneOf(d.documentType, DOC_TYPES, content.documentType);
  if (d.tags !== undefined) update.tags = strList(d.tags, 20, 40);
  if (d.effectiveDate !== undefined) update.effectiveDate = dateStr(d.effectiveDate);
  if (d.reviewDate !== undefined) { update.reviewDate = dateStr(d.reviewDate); update.reviewRemindersSent = []; }
  if (d.language !== undefined) update.language = oneOf(d.language, ["en", "fr"] as const, "en");
  if (d.ownerId !== undefined) {
    const owner = (await db.doc(`institutions/${ctx.instId}/members/${id(d.ownerId, "owner")}`).get()).data() as Member | undefined;
    if (!owner) throw fail.invalid("Choose an owner who is a member.");
    update.ownerId = String(d.ownerId); update.ownerName = owner.name;
  }
  let moved = false;
  if (d.sectionId !== undefined || d.spaceId !== undefined) {
    const toSpace = d.spaceId ? await getSpace(ctx.instId, d.spaceId) : space;
    requireEdit(ctx, toSpace);
    const sectionId = d.sectionId ? id(d.sectionId, "section") : null;
    if (sectionId) {
      const sec = (await db.doc(`institutions/${ctx.instId}/sections/${sectionId}`).get()).data();
      if (!sec || sec.spaceId !== toSpace.id) throw fail.invalid("That section isn't in this space.");
    }
    update.sectionId = sectionId;
    if (toSpace.id !== content.spaceId) { update.spaceId = toSpace.id; moved = true; }
  }
  if (!Object.keys(update).length) return { ok: true };
  await contentRef(scopeFor(ctx), content.id).update({ ...update, updatedAt: FieldValue.serverTimestamp() });
  if (moved) await moveContent(scopeFor(ctx), content, update.spaceId!, update.sectionId ?? null);
  else if (update.title && content.published) await bumpCorpus(scopeFor(ctx));
  const { before, after } = diff(content as unknown as Record<string, unknown>, { ...content, ...update } as unknown as Record<string, unknown>);
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "content.update", target: { type: "content", id: content.id, title: content.title }, before, after });
  return { ok: true };
});

/** Edits the extracted text of scanned pages (digitisation check) and marks pages as checked. */
export const savePageCorrections = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { allowPlatform: true });
  const content = await loadContent(ctx, req.data.contentId);
  const version = await loadVersion(ctx, content.id, req.data.versionId);
  const space = await getSpace(ctx.instId, content.spaceId);
  if (!ctx.platformAdmin && !ctx.isManager && !space.editorIds.includes(ctx.c.uid) && !space.approverIds.includes(ctx.c.uid)) throw fail.denied();
  if (["approved", "superseded"].includes(version.status)) throw fail.precondition("Published versions can't be edited. Upload a new version instead.");
  const path = `${paths.draft(scopeFor(ctx), content.id, version.id)}text.json`;
  const text = await readJson<TextFile>(path);
  if (!text) throw fail.notFound("This version hasn't been processed yet.");
  const edits = (Array.isArray(req.data.pages) ? req.data.pages : []).slice(0, 2000) as { n: number; text: string }[];
  const changed: number[] = [];
  for (const e of edits) {
    const p = text.pages.find((x: PageText) => x.n === Number(e.n));
    if (p && typeof e.text === "string" && e.text !== p.text) { p.text = e.text.slice(0, 50_000); p.edited = true; changed.push(p.n); }
  }
  if (changed.length) await writeJson(path, text);
  const checked = [...new Set([...(version.checkedPages ?? []), ...((Array.isArray(req.data.checked) ? req.data.checked : []) as number[]).map(Number).filter((n) => version.lowConfidencePages.includes(n))])];
  const remaining = version.lowConfidencePages.filter((n) => !checked.includes(n));
  await versionRef(scopeFor(ctx), content.id, version.id).update({ checkedPages: checked, ocrStatus: remaining.length ? "needs_review" : version.ocrPages.length ? "done" : version.ocrStatus });
  await db.doc(`digitisationJobs/${version.id}`).set({ pagesChecked: checked.length, status: remaining.length ? "checking" : "ready", updatedAt: FieldValue.serverTimestamp(), assignee: ctx.member.name }, { merge: true }).catch(() => {});
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "version.pages_corrected", target: { type: "content", id: content.id, title: content.title }, after: { versionNumber: version.number, editedPages: changed, checkedPages: checked } });
  return { ok: true, remaining };
});

function assertReadyForReview(version: ContentVersion) {
  if (version.status === "processing" || version.status === "uploading") throw fail.precondition("This version is still being processed.");
  if (version.processingError) throw fail.precondition(`This version couldn't be processed: ${version.processingError}`);
  const unchecked = version.lowConfidencePages.filter((n) => !(version.checkedPages ?? []).includes(n));
  if (unchecked.length) throw fail.precondition(`${unchecked.length} scanned page${unchecked.length > 1 ? "s" : ""} (${unchecked.slice(0, 8).join(", ")}${unchecked.length > 8 ? "…" : ""}) need checking before this can be approved.`, { reason: "ocr_check", pages: unchecked });
}

export const submitForReview = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { allowPlatform: true });
  const content = await loadContent(ctx, req.data.contentId);
  const version = await loadVersion(ctx, content.id, req.data.versionId);
  const space = await getSpace(ctx.instId, content.spaceId);
  requireEdit(ctx, space);
  if (!["draft", "changes_requested"].includes(version.status)) throw fail.precondition("This version can't be submitted right now.");
  assertReadyForReview(version);
  const note = str(req.data.note, 500);
  // Non-clinical spaces (marked by an admin) publish without clinical approval
  if (!space.requiresApproval) return approveAndPublish(ctx, content, version, "Published without clinical approval (non-clinical space)");
  if (!space.approverIds.length) throw fail.precondition(`${space.name} has no clinical approver. Ask an admin to name one in the space settings.`, { reason: "no_approver" });
  const batch = db.batch();
  batch.update(versionRef(scopeFor(ctx), content.id, version.id), { status: "in_review", submittedBy: ctx.c.uid, submittedAt: FieldValue.serverTimestamp(), ...(note && { changeNote: note }) });
  batch.update(contentRef(scopeFor(ctx), content.id), { status: content.published ? content.status : "in_review", updatedAt: FieldValue.serverTimestamp() });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "version.submit", target: { type: "content", id: content.id, title: content.title }, after: { versionNumber: version.number, note } }, batch);
  await batch.commit();
  const approvers = await membersWhere(ctx.instId, (m) => space.approverIds.includes(m.userId));
  await notify(ctx.instId, "approval_request", approvers, {
    title: "Approval needed", body: `${ctx.member.name} submitted "${content.title}" (v${version.number}) for review.`, path: `/app/admin/content/${content.id}`,
    email: { subject: `Approval needed: ${content.title}`, lines: [`${ctx.member.name} submitted "${content.title}" (version ${version.number}) in ${space.name} for clinical approval.`, note ? `Note: ${note}` : "Nothing reaches staff or the AI until you approve it."] },
  }, content.id);
  return { status: "in_review" };
});

async function approveAndPublish(ctx: Ctx, content: ContentItem, version: ContentVersion, comment: string) {
  const batch = db.batch();
  batch.update(versionRef(scopeFor(ctx), content.id, version.id), {
    status: "approved", reviewedBy: ctx.c.uid, reviewedAt: FieldValue.serverTimestamp(), reviewComment: comment || null,
    approvedBy: ctx.c.uid, approvedByName: ctx.member.name, approvedAt: Timestamp.now(),
  });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "version.approve", target: { type: "content", id: content.id, title: content.title }, after: { versionNumber: version.number, comment } }, batch);
  await batch.commit();
  await enqueuePublish(scopeFor(ctx), content.id, version.id, { uid: ctx.c.uid, name: ctx.member.name });
  return { status: "approved" };
}

export const reviewVersion = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { allowPlatform: false });
  const content = await loadContent(ctx, req.data.contentId);
  const version = await loadVersion(ctx, content.id, req.data.versionId);
  const space = await getSpace(ctx.instId, content.spaceId);
  requireApprove(ctx, space);
  if (version.status !== "in_review") throw fail.precondition("This version isn't waiting for review.");
  const decision = oneOf(req.data.decision, ["approve", "reject", "changes"] as const, "approve");
  const comment = str(req.data.comment, 1000);
  if (decision !== "approve" && !comment) throw fail.invalid("Add a comment so the editor knows what to change.");
  if (decision === "approve") {
    assertReadyForReview(version);
    const r = await approveAndPublish(ctx, content, version, comment);
    const author = await membersWhere(ctx.instId, (m) => m.userId === version.createdBy || m.userId === version.submittedBy);
    await notify(ctx.instId, "approval_decision", author, { title: "Approved", body: `"${content.title}" v${version.number} was approved by ${ctx.member.name} and is being published.`, path: `/app/admin/content/${content.id}` }, content.id);
    return r;
  }
  const status = decision === "reject" ? "rejected" : "changes_requested";
  const batch = db.batch();
  batch.update(versionRef(scopeFor(ctx), content.id, version.id), { status, reviewedBy: ctx.c.uid, reviewedAt: FieldValue.serverTimestamp(), reviewComment: comment });
  batch.update(contentRef(scopeFor(ctx), content.id), { status: content.published ? "approved" : "draft", updatedAt: FieldValue.serverTimestamp() });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: decision === "reject" ? "version.reject" : "version.changes_requested", target: { type: "content", id: content.id, title: content.title }, after: { versionNumber: version.number, comment } }, batch);
  await batch.commit();
  const author = await membersWhere(ctx.instId, (m) => m.userId === version.createdBy || m.userId === version.submittedBy);
  await notify(ctx.instId, "approval_decision", author, {
    title: decision === "reject" ? "Not approved" : "Changes requested", body: `${ctx.member.name}: ${comment.slice(0, 120)}`, path: `/app/admin/content/${content.id}`,
    email: { subject: `${decision === "reject" ? "Not approved" : "Changes requested"}: ${content.title}`, lines: [`${ctx.member.name} reviewed "${content.title}" (version ${version.number}).`, `Comment: ${comment}`] },
  }, content.id);
  return { status };
});

export const archiveContent = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { allowPlatform: true });
  const content = await loadContent(ctx, req.data.contentId);
  const space = await getSpace(ctx.instId, content.spaceId);
  requireEdit(ctx, space);
  const archive = req.data.archived !== false;
  if (archive) {
    await contentRef(scopeFor(ctx), content.id).update({ status: "archived", published: false, updatedAt: FieldValue.serverTimestamp() });
    await activateChunks(scopeFor(ctx), content.id, null);
  } else {
    if (!content.currentVersionId) throw fail.precondition("This document was never published. Submit a version for review instead.");
    await contentRef(scopeFor(ctx), content.id).update({ status: "approved", published: true, updatedAt: FieldValue.serverTimestamp() });
    await activateChunks(scopeFor(ctx), content.id, content.currentVersionId);
  }
  await bumpCorpus(scopeFor(ctx));
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "content.archive", target: { type: "content", id: content.id, title: content.title }, before: { status: content.status }, after: { status: archive ? "archived" : "approved" } });
  return { ok: true };
});

/** F8: admins mark an update as Must read; staff must open it and confirm. */
export const setMustRead = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const content = await loadContent(ctx, req.data.contentId);
  const mustRead = req.data.mustRead !== false;
  await contentRef(scopeFor(ctx), content.id).update({ mustRead, mustReadVersionId: mustRead ? content.currentVersionId : null });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "content.must_read", target: { type: "content", id: content.id, title: content.title }, before: { mustRead: content.mustRead }, after: { mustRead, versionNumber: content.currentVersionNumber } });
  if (mustRead && content.published && content.currentVersionId) {
    const people = await membersWhere(ctx.instId, (m) => m.visibleSpaceIds.includes(content.spaceId) && (m.access === "full" || m.access === "read"));
    const space = await getSpace(ctx.instId, content.spaceId);
    const ref = db.collection(`institutions/${ctx.instId}/updates`).doc();
    const at = Timestamp.now();
    await batchWrite([
      (b) => b.set(ref, { id: ref.id, kind: "updated", contentId: content.id, versionId: content.currentVersionId, versionNumber: content.currentVersionNumber, title: content.title, spaceId: content.spaceId, spaceName: space.name, changeNote: "Marked as must read", mustRead: true, recipientCount: people.length, at }),
      ...people.map((m) => (b: FirebaseFirestore.WriteBatch) => b.set(db.doc(`institutions/${ctx.instId}/members/${m.userId}/inbox/${ref.id}`), { updateId: ref.id, contentId: content.id, versionId: content.currentVersionId!, title: content.title, spaceName: space.name, kind: "updated", changeNote: "Marked as must read", mustRead: true, read: false, acknowledgedAt: null, at } satisfies InboxItem)),
    ]);
    await notify(ctx.instId, "update", people, { title: `Must read: ${content.title}`, body: `Open it and confirm you have read and understood it.`, path: `/app/doc/${content.id}`, email: { subject: `Must read: ${content.title}`, lines: [`${ctx.member.name} has asked all ${space.name} staff to read "${content.title}" and confirm.`] } }, content.id);
  }
  return { ok: true };
});

export const acknowledge = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { cap: "read" });
  const content = await loadContent(ctx, req.data.contentId);
  if (!canSee(ctx, content.spaceId) || !content.published) throw fail.denied();
  if (!content.mustRead || !content.mustReadVersionId) throw fail.precondition("This document doesn't need an acknowledgement.");
  const ackId = `${content.id}_${content.mustReadVersionId}_${ctx.c.uid}`;
  const ref = db.doc(`institutions/${ctx.instId}/acknowledgements/${ackId}`);
  if ((await ref.get()).exists) return { ok: true, already: true };
  const at = Timestamp.now();
  const batch = db.batch();
  batch.set(ref, { contentId: content.id, versionId: content.mustReadVersionId, userId: ctx.c.uid, userName: ctx.member.name, jobTitle: ctx.member.jobTitle, acknowledgedAt: at });
  await audit({ instId: ctx.instId, actorId: ctx.c.uid, actorName: ctx.member.name, action: "acknowledge", target: { type: "content", id: content.id, title: content.title }, after: { versionNumber: content.currentVersionNumber, at: at.toDate().toISOString() } }, batch);
  await batch.commit();
  const inbox = await db.collection(`institutions/${ctx.instId}/members/${ctx.c.uid}/inbox`).where("contentId", "==", content.id).get();
  await batchWrite(inbox.docs.map((d) => (b) => b.update(d.ref, { read: true, acknowledgedAt: at })));
  return { ok: true };
});

export const remindMustRead = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { roles: ["owner", "admin"] });
  const content = await loadContent(ctx, req.data.contentId);
  if (!content.mustRead || !content.mustReadVersionId) throw fail.precondition("This document isn't marked must read.");
  const acks = await db.collection(`institutions/${ctx.instId}/acknowledgements`).where("contentId", "==", content.id).where("versionId", "==", content.mustReadVersionId).get();
  const done = new Set(acks.docs.map((d) => d.data().userId));
  const pending = await membersWhere(ctx.instId, (m) => m.visibleSpaceIds.includes(content.spaceId) && !done.has(m.userId) && (m.access === "full" || m.access === "read"));
  await notify(ctx.instId, "must_read_reminder", pending, { title: `Reminder: ${content.title}`, body: "Please read it and confirm you have read and understood it.", path: `/app/doc/${content.id}`, email: { subject: `Reminder: please read ${content.title}`, lines: [`You haven't yet confirmed that you've read "${content.title}". Open it in DocInsight and tap "I have read and understood".`] } }, content.id);
  return { reminded: pending.length };
});

/** Records a document view for analytics (top documents, active users). */
export const recordView = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { cap: "read" });
  const cid = id(req.data.contentId, "content");
  await db.collection(`institutions/${ctx.instId}/events`).add({ type: "view", userId: ctx.c.uid, contentId: cid, query: null, at: FieldValue.serverTimestamp() });
  await touchActivity(ctx.instId, ctx.c.uid);
  return { ok: true };
}, { memory: "256MiB" });
