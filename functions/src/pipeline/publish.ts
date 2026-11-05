// Publishing an approved version (PRD section 7): chunk, embed, activate, retire old versions,
// copy files to the published area, and tell the people who can see the space.
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { logger } from "firebase-functions";
import type { Chunk, ContentItem, ContentVersion, InboxItem, Member, Space, Update } from "../../../shared/src/types";
import { chunkPages } from "../../../shared/src/text";
import { batchWrite, bucket, db, FieldValue, taskQueue, Timestamp } from "../lib/admin";
import { audit } from "../lib/audit";
import { addUsage } from "../lib/plans";
import { pushTo } from "../lib/push";
import { chunksCol, contentRef, paths, scopeKey, scopeOf, versionRef, type Scope } from "../lib/scope";
import { embed } from "./embed";
import { copyPrefix, readJson, type TextFile } from "./store";

export async function enqueuePublish(scope: Scope, contentId: string, versionId: string, actor: { uid: string; name: string }) {
  await taskQueue("publishTask").enqueue({ scope: scopeKey(scope), contentId, versionId, actor }, { dispatchDeadlineSeconds: 1800 });
}

async function spaceName(scope: Scope, spaceId: string): Promise<string> {
  const ref = scope.kind === "hub" ? db.doc(`hubCollections/${spaceId}`) : db.doc(`institutions/${scope.instId}/spaces/${spaceId}`);
  return ((await ref.get()).data()?.name as string) ?? "";
}

export async function bumpCorpus(scope: Scope) {
  if (scope.kind === "hub") await db.doc("config/hub").set({ corpusVersion: FieldValue.increment(1) }, { merge: true });
  else await db.doc(`institutions/${scope.instId}`).update({ corpusVersion: FieldValue.increment(1) });
}

/** Writes chunks with embeddings for one version (inactive), returning their ids. */
async function buildChunks(scope: Scope, content: ContentItem, version: ContentVersion, text: TextFile): Promise<string[]> {
  const drafts = chunkPages(text.pages, content.title);
  const labels = new Map(text.pages.map((p) => [p.n, p.label]));
  const ocrPages = new Set(text.pages.filter((p) => p.ocr).map((p) => p.n));
  const inputs = drafts.map((d) => `${d.headingPath ? d.headingPath + "\n" : ""}${d.text}`);
  const vectors = inputs.length ? await embed(inputs, "RETRIEVAL_DOCUMENT", drafts.map(() => content.title)) : [];
  const col = chunksCol(scope);
  // Remove any chunks left by an earlier attempt for this version
  const old = await col.where("versionId", "==", version.id).get();
  await batchWrite(old.docs.map((d) => (b) => b.delete(d.ref)));
  const ids: string[] = [];
  const ops = drafts.map((d, i) => {
    const ref = col.doc(`${version.id}_${i + 1}`);
    ids.push(ref.id);
    const chunk: Chunk = {
      id: ref.id, contentId: content.id, versionId: version.id, spaceId: content.spaceId, sectionId: content.sectionId, title: content.title,
      versionNumber: version.number, documentType: content.documentType, pages: d.pages,
      pageLabels: [labels.get(d.pages[0]) ?? String(d.pages[0]), labels.get(d.pages[1]) ?? String(d.pages[1])],
      headingPath: d.headingPath, text: d.text, wordCount: d.wordCount,
      ocr: Array.from({ length: d.pages[1] - d.pages[0] + 1 }, (_, k) => d.pages[0] + k).some((n) => ocrPages.has(n)),
      embedding: FieldValue.vector(vectors[i]), active: false, source: scope.kind === "hub" ? "hub" : "hospital",
      effectiveDate: content.effectiveDate, language: content.language || "en", createdAt: Timestamp.now(),
    };
    return (b: FirebaseFirestore.WriteBatch) => b.set(ref, chunk);
  });
  await batchWrite(ops);
  return ids;
}

/** Makes this version's chunks the only active ones for the content item. */
export async function activateChunks(scope: Scope, contentId: string, versionId: string | null) {
  const col = chunksCol(scope);
  const all = await col.where("contentId", "==", contentId).get();
  await batchWrite(all.docs.map((d) => (b) => b.update(d.ref, { active: versionId != null && d.data().versionId === versionId })));
}

async function fanOut(instId: string, content: ContentItem, version: ContentVersion, kind: Update["kind"], spaceNameStr: string) {
  const members = await db.collection(`institutions/${instId}/members`).where("visibleSpaceIds", "array-contains", content.spaceId).where("status", "==", "active").get();
  const people = members.docs.map((d) => ({ ...d.data(), userId: d.id }) as Member).filter((m) => m.access === "full" || m.access === "read");
  const ref = db.collection(`institutions/${instId}/updates`).doc();
  const update: Update = {
    id: ref.id, kind, contentId: content.id, versionId: version.id, versionNumber: version.number, title: content.title, spaceId: content.spaceId,
    spaceName: spaceNameStr, changeNote: version.changeNote ?? "", mustRead: content.mustRead, recipientCount: people.length, at: Timestamp.now(),
  };
  const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [(b) => b.set(ref, update)];
  for (const m of people) {
    const item: InboxItem = { updateId: ref.id, contentId: content.id, versionId: version.id, title: content.title, spaceName: spaceNameStr, kind, changeNote: update.changeNote, mustRead: content.mustRead, read: false, acknowledgedAt: null, at: update.at };
    ops.push((b) => b.set(db.doc(`institutions/${instId}/members/${m.userId}/inbox/${ref.id}`), item));
  }
  await batchWrite(ops);
  const title = content.mustRead ? `Must read: ${content.title}` : kind === "published" ? `New: ${content.title}` : `Updated: ${content.title}`;
  await pushTo(people.map((m) => m.userId), title, version.changeNote || `${spaceNameStr}: version ${version.number}`, `/app/doc/${content.id}`);
  const nref = db.collection(`institutions/${instId}/notifications`).doc();
  await nref.set({ id: nref.id, type: "update", contentId: content.id, recipients: people.map((m) => m.userId).slice(0, 500), channels: ["in_app", "push"], sentAt: FieldValue.serverTimestamp() });
}

export async function runPublish(scope: Scope, contentId: string, versionId: string, actor: { uid: string; name: string }) {
  const [cs, vs] = await Promise.all([contentRef(scope, contentId).get(), versionRef(scope, contentId, versionId).get()]);
  if (!cs.exists || !vs.exists) return;
  const content = { id: cs.id, ...cs.data() } as ContentItem;
  const version = { id: vs.id, ...vs.data() } as ContentVersion;
  if (version.status !== "approved") return;
  const draft = paths.draft(scope, contentId, versionId);
  const text = await readJson<TextFile>(`${draft}text.json`);
  if (!text) throw new Error("Processed text is missing for this version.");
  const chunkIds = await buildChunks(scope, content, version, text);
  // Files: processed pages and text, plus the original upload
  const pub = paths.published(scope, content.spaceId, contentId, versionId);
  await copyPrefix(draft, pub);
  const [uploads] = await bucket().getFiles({ prefix: paths.uploadPrefix(scope, contentId, versionId) });
  await Promise.all(uploads.map((f) => f.copy(bucket().file(`${pub}original/${f.name.split("/").pop()}`))));
  // Retire the previous version, activate this one
  const prevId = content.currentVersionId;
  await activateChunks(scope, contentId, versionId);
  const batch = db.batch();
  if (prevId && prevId !== versionId) batch.update(versionRef(scope, contentId, prevId), { active: false, status: "superseded" });
  batch.update(versionRef(scope, contentId, versionId), { active: true, chunkCount: chunkIds.length });
  const isUpdate = !!prevId && prevId !== versionId;
  batch.update(contentRef(scope, contentId), {
    published: true, status: "approved", currentVersionId: versionId, currentVersionNumber: version.number, pageCount: version.pageCount,
    approvedByName: version.approvedByName, approvedAt: version.approvedAt, reviewRemindersSent: [], updatedAt: FieldValue.serverTimestamp(),
    ...(content.mustRead && { mustReadVersionId: versionId }),
  });
  await batch.commit();
  await bumpCorpus(scope);
  await db.doc(`digitisationJobs/${versionId}`).set({ status: "published", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
  if (scope.kind === "inst") {
    await addUsage(scope.instId, { embeddedChunks: chunkIds.length });
    await audit({ instId: scope.instId, actorId: actor.uid, actorName: actor.name, action: "version.publish", target: { type: "content", id: contentId, title: content.title }, before: prevId ? { versionId: prevId, versionNumber: content.currentVersionNumber } : null, after: { versionId, versionNumber: version.number, chunks: chunkIds.length } });
    await fanOut(scope.instId, { ...content, mustRead: content.mustRead }, version, isUpdate ? "updated" : "published", await spaceName(scope, content.spaceId));
  }
  logger.info("published", { scope: scopeKey(scope), contentId, versionId, chunks: chunkIds.length });
}

export const publishTask = onTaskDispatched(
  { region: "europe-west1", retryConfig: { maxAttempts: 5, minBackoffSeconds: 30, maxBackoffSeconds: 600 }, rateLimits: { maxConcurrentDispatches: 6 }, memory: "1GiB", timeoutSeconds: 540 },
  async (req) => {
    const { scope, contentId, versionId, actor } = req.data as { scope: string; contentId: string; versionId: string; actor: { uid: string; name: string } };
    await runPublish(scopeOf(scope), contentId, versionId, actor);
  },
);

/** Moves published files and chunks when content changes space (visibility follows the new space). */
export async function moveContent(scope: Scope, content: ContentItem, toSpaceId: string, toSectionId: string | null) {
  if (content.currentVersionId) {
    const from = paths.published(scope, content.spaceId, content.id, content.currentVersionId);
    const to = paths.published(scope, toSpaceId, content.id, content.currentVersionId);
    await copyPrefix(from, to);
    await bucket().deleteFiles({ prefix: from, force: true }).catch(() => {});
  }
  const chunks = await chunksCol(scope).where("contentId", "==", content.id).get();
  await batchWrite(chunks.docs.map((d) => (b) => b.update(d.ref, { spaceId: toSpaceId, sectionId: toSectionId })));
  await bumpCorpus(scope);
}

export type { Space };
