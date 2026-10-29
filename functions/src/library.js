// The document library: upload, ingestion, background OCR of scanned pages, removal.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { logger } from "firebase-functions";
import Anthropic from "@anthropic-ai/sdk";
import os from "node:os"; import fs from "node:fs/promises"; import path from "node:path";
import { db, bucket, FieldValue, taskQueue, monthKey, randomId } from "./admin.js";
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, REGION, CATEGORIES } from "./config.js";
import { requireAuth, requireMember, MANAGER_ROLES } from "./access.js";
import { checkAllowance } from "./plans.js";
import { chunkMarkdown, htmlToMarkdown, pagesToSections } from "./chunking.js";
import { openPdf, extractPages, renderPage } from "./pdf.js";
import { pagePieces } from "./images.js";
import { ocrPrompt, parseOcr } from "./prompts.js";
import { loadCorpus, neighbour, overdue } from "./corpus.js";

const OCR_PAGES_PER_CALL = 4;
const MAX_FILE_BYTES = 150 * 1024 * 1024;
const clean = (v, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isImageName = (n) => /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(n);
const srcRef = (orgId, srcId) => db.doc(`orgs/${orgId}/sources/${srcId}`);
const workFile = (orgId, srcId) => bucket().file(`orgs/${orgId}/sources/${srcId}/work.json`);
const uploadPrefix = (orgId, srcId) => `orgs/${orgId}/uploads/${srcId}/`;

async function readWork(orgId, srcId) { const [b] = await workFile(orgId, srcId).download(); return JSON.parse(b.toString("utf8")); }
async function writeWork(orgId, srcId, work) { await workFile(orgId, srcId).save(JSON.stringify(work), { contentType: "application/json", resumable: false }); }

/** Step 1: a library manager registers a document and gets an upload location. */
export const createSource = onCall(async (request) => {
  const uid = requireAuth(request);
  const d = request.data || {};
  const { org } = await requireMember(uid, d.orgId, MANAGER_ROLES);
  await checkAllowance(org, "documents", 1);
  const files = Array.isArray(d.files) ? d.files.slice(0, 400) : [];
  if (!files.length) throw new HttpsError("invalid-argument", "Choose at least one file.");
  if (files.some(f => !f || typeof f.name !== "string" || !(f.size > 0) || f.size > MAX_FILE_BYTES)) throw new HttpsError("invalid-argument", "Each file must be under 150 MB.");
  const photos = files.length > 1 || isImageName(files[0].name);
  if (files.length > 1 && !files.every(f => isImageName(f.name))) throw new HttpsError("invalid-argument", "Add documents one at a time. Several files at once are treated as photos of one document's pages.");
  const srcId = "s" + randomId(8);
  const title = clean(d.title) || files[0].name.replace(/\.[^.]+$/, "");
  await srcRef(d.orgId, srcId).set({
    title, category: CATEGORIES[d.category] ? d.category : "protocol", area: clean(d.area), version: clean(d.version, 80),
    reviewDate: /^\d{4}-\d{2}-\d{2}$/.test(d.reviewDate || "") ? d.reviewDate : "", sourceUrl: clean(d.sourceUrl, 500),
    kind: photos ? "photos" : "document", fileNames: files.map(f => clean(f.name, 200)), status: "uploading",
    readScans: d.readScans !== false, createdBy: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });
  return { srcId, uploadPrefix: uploadPrefix(d.orgId, srcId) };
});

/** Step 2: after the browser has uploaded the files, queue processing. */
export const processSource = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, srcId } = request.data || {};
  await requireMember(uid, orgId, MANAGER_ROLES);
  const ref = srcRef(orgId, srcId); const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That document doesn't exist.");
  if (!["uploading", "failed"].includes(snap.data().status)) return { ok: true };
  await ref.update({ status: "queued", error: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  await taskQueue(`locations/${REGION}/functions/ingestTask`).enqueue({ orgId, srcId }, { dispatchDeadlineSeconds: 1800 });
  return { ok: true };
});

async function listUploads(orgId, srcId) {
  const [files] = await bucket().getFiles({ prefix: uploadPrefix(orgId, srcId) });
  return files.filter(f => !f.name.endsWith("/")).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Step 3 (background): extract text, decide which pages need OCR. */
export const ingestTask = onTaskDispatched({ retryConfig: { maxAttempts: 3, minBackoffSeconds: 30 }, rateLimits: { maxConcurrentDispatches: 10 }, memory: "2GiB", timeoutSeconds: 540, cpu: 2 }, async (req) => {
  const { orgId, srcId } = req.data;
  const ref = srcRef(orgId, srcId); const snap = await ref.get();
  if (!snap.exists) return;
  const src = snap.data();
  try {
    await ref.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() });
    const files = await listUploads(orgId, srcId);
    if (!files.length) throw new Error("No uploaded file was found. Remove this document and add it again.");
    let work;
    if (src.kind === "photos") {
      work = { mode: "photos", files: files.map(f => f.name), pages: files.map((f, i) => ({ n: i + 1, text: "", ocr: false })) };
    } else {
      const f = files[0]; const name = f.name.toLowerCase();
      const [buf] = await f.download();
      if (name.endsWith(".pdf")) {
        const pdf = await openPdf(buf);
        work = { mode: "pdf", files: [f.name], pages: await extractPages(pdf) };
        await pdf.destroy();
      } else if (/\.html?$/.test(name)) {
        const { md } = htmlToMarkdown(buf.toString("utf8"));
        work = { mode: "text", sections: chunkMarkdown(md, src.title) };
      } else if (/\.(md|markdown|txt)$/.test(name)) {
        work = { mode: "text", sections: chunkMarkdown(buf.toString("utf8"), src.title) };
      } else throw new Error("This file type isn't supported. Use PDF, photos (JPG or PNG), web pages, Markdown or text.");
    }
    const scanned = (work.pages || []).filter(p => !p.text).map(p => p.n);
    if (scanned.length && src.readScans) {
      const org = { id: orgId, ...(await db.doc(`orgs/${orgId}`).get()).data() };
      try { await checkAllowance(org, "ocrPages", scanned.length); }
      catch (e) { work.skippedScans = scanned; work.skipReason = e.message; await writeWork(orgId, srcId, work); return finalize(orgId, srcId); }
      work.queue = scanned; work.failed = [];
      await writeWork(orgId, srcId, work);
      await ref.update({ status: "reading_scans", pages: work.pages.length, scannedPages: scanned.length, ocrDone: 0, updatedAt: FieldValue.serverTimestamp() });
      await enqueueOcr(orgId, srcId);
      return;
    }
    if (scanned.length) work.skippedScans = scanned;
    await writeWork(orgId, srcId, work);
    await finalize(orgId, srcId);
  } catch (e) {
    logger.error("ingest failed", { orgId, srcId, err: e.message });
    await ref.update({ status: "failed", error: e.message.slice(0, 300), updatedAt: FieldValue.serverTimestamp() });
  }
});

const enqueueOcr = (orgId, srcId) => taskQueue(`locations/${REGION}/functions/ocrTask`).enqueue({ orgId, srcId }, { dispatchDeadlineSeconds: 1800 });

const tmpFor = (srcId, name) => path.join(os.tmpdir(), `${srcId}-${path.basename(name)}`);
async function localCopy(objectName, srcId) {
  const p = tmpFor(srcId, objectName);
  try { await fs.access(p); } catch { await bucket().file(objectName).download({ destination: p }); }
  return p;
}

/** Step 4 (background, repeated): transcribe the next few scanned pages with Claude. */
export const ocrTask = onTaskDispatched({ secrets: [ANTHROPIC_API_KEY], retryConfig: { maxAttempts: 8, minBackoffSeconds: 60, maxBackoffSeconds: 900 }, rateLimits: { maxConcurrentDispatches: 6 }, memory: "2GiB", timeoutSeconds: 540, cpu: 2 }, async (req) => {
  const { orgId, srcId } = req.data;
  const ref = srcRef(orgId, srcId); const snap = await ref.get();
  if (!snap.exists) return; // removed while reading
  const src = snap.data();
  const work = await readWork(orgId, srcId);
  const batch = (work.queue || []).slice(0, OCR_PAGES_PER_CALL);
  if (!batch.length) return finalize(orgId, srcId);

  const images = []; let split = false;
  try {
    let pdf = null;
    if (work.mode === "pdf") pdf = await openPdf(await fs.readFile(await localCopy(work.files[0], srcId)));
    for (const n of batch) {
      const raw = work.mode === "pdf" ? await renderPage(pdf, n) : await fs.readFile(await localCopy(work.files[n - 1], srcId));
      const prepared = await pagePieces(raw);
      if (prepared.split) split = true;
      images.push(...prepared.pieces);
    }
    if (pdf) await pdf.destroy();
  } catch (e) {
    logger.warn("page preparation failed", { srcId, batch, err: e.message });
    work.failed.push(...batch); work.queue = work.queue.slice(batch.length);
    await writeWork(orgId, srcId, work);
    await ref.update({ ocrDone: FieldValue.increment(batch.length), updatedAt: FieldValue.serverTimestamp() });
    return work.queue.length ? enqueueOcr(orgId, srcId) : finalize(orgId, srcId);
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  let msg;
  try {
    msg = await client.messages.create({
      model: CLAUDE_MODEL.value(), max_tokens: 1800 * batch.length,
      messages: [{ role: "user", content: [
        ...images.map(b => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } })),
        { type: "text", text: ocrPrompt(src.title, batch, split) }
      ] }]
    });
  } catch (e) {
    // Rate limits and outages: throw so Cloud Tasks retries this batch later with backoff.
    if (e?.status === 429 || e?.status >= 500 || !e?.status) throw e;
    logger.warn("ocr refused", { srcId, batch, status: e.status, err: e.message });
    msg = null;
  }
  const got = msg ? parseOcr(msg.content.filter(c => c.type === "text").map(c => c.text).join("\n")) : {};
  for (const n of batch) {
    const page = work.pages.find(p => p.n === n);
    if (got[n]) { page.text = got[n]; page.ocr = true; } else work.failed.push(n);
  }
  work.queue = work.queue.slice(batch.length);
  await writeWork(orgId, srcId, work);
  const read = batch.filter(n => got[n]).length;
  await Promise.all([
    ref.update({ ocrDone: FieldValue.increment(batch.length), updatedAt: FieldValue.serverTimestamp() }),
    db.doc(`orgs/${orgId}/usage/${monthKey()}`).set({ ocrPages: FieldValue.increment(read), inputTokens: FieldValue.increment(msg?.usage?.input_tokens || 0), outputTokens: FieldValue.increment(msg?.usage?.output_tokens || 0) }, { merge: true })
  ]);
  if (work.queue.length) await enqueueOcr(orgId, srcId); else await finalize(orgId, srcId);
});

/** Step 5: build sections, save them, and make the document searchable. */
async function finalize(orgId, srcId) {
  const ref = srcRef(orgId, srcId); const snap = await ref.get();
  if (!snap.exists) return;
  const src = snap.data();
  const work = await readWork(orgId, srcId);
  const sections = work.mode === "text" ? work.sections : pagesToSections(work.pages, src.title);
  if (!sections.length) {
    const why = work.skipReason ? work.skipReason : (work.pages || []).length ? "No readable text was found, even after reading the scanned pages." : "No readable text was found in this file.";
    await ref.update({ status: "failed", error: why, updatedAt: FieldValue.serverTimestamp() });
    return;
  }
  const chunks = sections.map((s, i) => { const c = { id: `${srcId}.${i + 1}`, srcId, path: s.path, text: s.text }; if (s.ocr) c.ocr = true; if (s.page) c.page = s.page; return c; });
  await bucket().file(`orgs/${orgId}/sources/${srcId}/chunks.json`).save(JSON.stringify(chunks), { contentType: "application/json", resumable: false });
  const notes = [];
  if (work.failed?.length) notes.push(`${work.failed.length} scanned page${work.failed.length > 1 ? "s" : ""} couldn't be read (pages ${compactRanges(work.failed)})`);
  if (work.skippedScans?.length) notes.push(`${work.skippedScans.length} scanned page${work.skippedScans.length > 1 ? "s were" : " was"} not read${work.skipReason ? ": " + work.skipReason : ""}`);
  await ref.update({ status: "ready", sections: chunks.length, scannedRead: chunks.some(c => c.ocr) ? (work.pages || []).filter(p => p.ocr).length : 0, note: notes.join(". "), readyAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await db.doc(`orgs/${orgId}`).update({ corpusVersion: FieldValue.increment(1) });
  for (const f of work.files || []) await fs.rm(tmpFor(srcId, f), { force: true }).catch(() => {});
}

function compactRanges(nums) {
  const s = [...new Set(nums)].sort((a, b) => a - b); const out = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (s[j + 1] === s[j] + 1) j++; out.push(i === j ? `${s[i]}` : `${s[i]}–${s[j]}`); i = j; }
  return out.join(", ");
}

export const removeSource = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, srcId } = request.data || {};
  await requireMember(uid, orgId, MANAGER_ROLES);
  if (typeof srcId !== "string" || !/^s[a-z0-9]{8}$/.test(srcId)) throw new HttpsError("invalid-argument", "Unknown document.");
  await srcRef(orgId, srcId).delete();
  await Promise.all([bucket().deleteFiles({ prefix: uploadPrefix(orgId, srcId) }), bucket().deleteFiles({ prefix: `orgs/${orgId}/sources/${srcId}/` })]).catch(e => logger.warn("cleanup", e.message));
  await db.doc(`orgs/${orgId}`).update({ corpusVersion: FieldValue.increment(1) });
  return { ok: true };
});

/** Any member: one passage with its neighbours, for the source drawer. */
export const getPassage = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, id } = request.data || {};
  const { org } = await requireMember(uid, orgId);
  const corpus = await loadCorpus(orgId, org.corpusVersion || 0);
  const c = corpus.byId.get(id);
  if (!c) throw new HttpsError("not-found", "That section is no longer in the library.");
  const s = corpus.sources.get(c.srcId);
  return { passage: passageView(c, s), prev: neighbour(corpus, id, -1), next: neighbour(corpus, id, 1) };
});

export function passageView(c, s) {
  return { id: c.id, path: c.path, text: c.text, ocr: !!c.ocr, page: c.page || null,
    source: { id: s.id, title: s.title, category: s.category, area: s.area || "", version: s.version || "", reviewDate: s.reviewDate || "", overdue: overdue(s), kind: s.kind, fileNames: s.fileNames || [], sourceUrl: s.sourceUrl || "" } };
}

/** If background reading stalls (e.g. retries exhausted during an outage), a manager can restart it. */
export const resumeSource = onCall(async (request) => {
  const uid = requireAuth(request);
  const { orgId, srcId } = request.data || {};
  await requireMember(uid, orgId, MANAGER_ROLES);
  const snap = await srcRef(orgId, srcId).get();
  if (!snap.exists) throw new HttpsError("not-found", "That document doesn't exist.");
  const s = snap.data();
  const idleMin = (Date.now() - (s.updatedAt?.toMillis?.() || 0)) / 60000;
  if (s.status === "reading_scans" && idleMin > 20) { await enqueueOcr(orgId, srcId); return { resumed: true }; }
  if (["queued", "processing"].includes(s.status) && idleMin > 20) { await taskQueue(`locations/${REGION}/functions/ingestTask`).enqueue({ orgId, srcId }); return { resumed: true }; }
  return { resumed: false };
});
