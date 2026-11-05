// Ingestion (PRD section 7): extract text per page, OCR scanned pages, render page images
// for the fast viewer, and flag low-confidence pages for a person to check before publishing.
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { logger } from "firebase-functions";
import type { ContentItem, ContentVersion, PageText } from "../../../shared/src/types";
import { markdownToPages } from "../../../shared/src/text";
import { bucket, db, FieldValue, taskQueue } from "../lib/admin";
import { DOCAI_PROCESSOR } from "../lib/params";
import { addUsage } from "../lib/plans";
import { contentRef, paths, scopeKey, scopeOf, versionRef, type Scope } from "../lib/scope";
import { notify } from "../lib/notify";
import { LOW_CONFIDENCE, ocrPage } from "./ocr";
import { openPdf, pageText, renderPage } from "./pdf";
import { ocrImage, viewerImage } from "./images";
import { docxToMarkdown } from "./docx";
import { readJson, writeBytes, writeJson, type TextFile } from "./store";

const PAGES_PER_TASK = 15;

interface Work { pages: PageText[]; total: number }

export async function enqueueIngest(scope: Scope, contentId: string, versionId: string) {
  await taskQueue("ingestTask").enqueue({ scope: scopeKey(scope), contentId, versionId }, { dispatchDeadlineSeconds: 1800 });
}

const isPdf = (name: string, mime: string) => mime === "application/pdf" || /\.pdf$/i.test(name);
const isDocx = (name: string, mime: string) => /wordprocessingml/.test(mime) || /\.docx$/i.test(name);
const isImage = (name: string, mime: string) => /^image\//.test(mime) || /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(name);

async function finish(scope: Scope, content: ContentItem, version: ContentVersion, pages: PageText[]) {
  const draft = paths.draft(scope, content.id, version.id);
  const text: TextFile = { pages, title: content.title, language: content.language || "en" };
  await writeJson(`${draft}text.json`, text);
  await bucket().file(`${draft}work.json`).delete().catch(() => {});
  const ocrPages = pages.filter((p) => p.ocr).map((p) => p.n);
  const low = pages.filter((p) => p.ocr && (p.confidence ?? 0) < LOW_CONFIDENCE).map((p) => p.n);
  const confs = pages.filter((p) => p.ocr && p.confidence != null).map((p) => p.confidence!);
  await versionRef(scope, content.id, version.id).update({
    status: "draft", pageCount: pages.length, pageLabels: pages.map((p) => p.label), processedPages: pages.length,
    ocrStatus: ocrPages.length ? (low.length ? "needs_review" : "done") : "not_needed",
    ocrConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
    ocrPages, lowConfidencePages: low, checkedPages: [], processingError: null,
  });
  await contentRef(scope, content.id).update({ status: content.published ? content.status : "draft", updatedAt: FieldValue.serverTimestamp() });
  if (ocrPages.length) {
    const instName = scope.kind === "hub" ? "Knowledge Hub" : ((await db.doc(`institutions/${scope.instId}`).get()).data()?.name ?? "");
    await db.doc(`digitisationJobs/${version.id}`).set({
      id: version.id, institutionId: scopeKey(scope), institutionName: instName, contentId: content.id, versionId: version.id, title: content.title,
      pagesReceived: pages.length, pagesOcrd: ocrPages.length, pagesChecked: 0, lowConfidencePages: low,
      status: low.length ? "checking" : "ready", assignee: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (scope.kind === "inst") await addUsage(scope.instId, { ocrPages: ocrPages.length });
  }
  if (scope.kind === "inst") {
    const m = (await db.doc(`institutions/${scope.instId}/members/${version.createdBy}`).get()).data();
    if (m) await notify(scope.instId, "approval_request", [{ ...m, userId: version.createdBy } as never], {
      title: low.length ? "Pages need checking" : "Ready to submit",
      body: low.length ? `"${content.title}": ${low.length} scanned page${low.length > 1 ? "s" : ""} need checking before it can be approved.` : `"${content.title}" has been processed and is ready to submit for review.`,
      path: `/app/admin/content/${content.id}`,
    }, content.id);
  }
}

async function processPdf(scope: Scope, content: ContentItem, version: ContentVersion, file: Buffer) {
  const draft = paths.draft(scope, content.id, version.id);
  const work = (await readJson<Work>(`${draft}work.json`)) ?? { pages: [], total: 0 };
  const pdf = await openPdf(file);
  work.total = pdf.numPages;
  const start = work.pages.length + 1;
  const end = Math.min(pdf.numPages, start + PAGES_PER_TASK - 1);
  const ocrAvailable = !!DOCAI_PROCESSOR.value() || true; // Vision fallback needs no processor
  for (let n = start; n <= end; n++) {
    const png = await renderPage(pdf, n, 1600);
    const img = await viewerImage(png);
    await Promise.all([writeBytes(`${draft}pages/${n}.jpg`, img.full, "image/jpeg"), writeBytes(`${draft}thumbs/${n}.jpg`, img.thumb, "image/jpeg")]);
    let text = await pageText(pdf, n);
    let ocr = false, confidence: number | null = null;
    if (!text && ocrAvailable) {
      const r = await ocrPage(await ocrImage(png));
      text = r.text; ocr = true; confidence = r.confidence;
    }
    work.pages.push({ n, label: String(n), text, ocr, confidence, edited: false });
  }
  await pdf.destroy();
  await writeJson(`${draft}work.json`, work);
  await versionRef(scope, content.id, version.id).update({ processedPages: work.pages.length, pageCount: work.total });
  if (work.pages.length < work.total) {
    await enqueueIngest(scope, content.id, version.id);
    return;
  }
  await finish(scope, content, version, work.pages);
}

export async function runIngest(scope: Scope, contentId: string, versionId: string, retryCount = 0) {
  const [cs, vs] = await Promise.all([contentRef(scope, contentId).get(), versionRef(scope, contentId, versionId).get()]);
  if (!cs.exists || !vs.exists) return;
  const content = { id: cs.id, ...cs.data() } as ContentItem;
  const version = { id: vs.id, ...vs.data() } as ContentVersion;
  if (version.status !== "processing") return;
  const draft = paths.draft(scope, content.id, version.id);
  try {
    if (content.type === "page") return finish(scope, content, version, markdownToPages(version.body ?? "").map((p) => ({ ...p, ocr: false, confidence: null, edited: false })));
    if (content.type === "checklist") {
      const text = `# ${content.title}\n\n` + (version.checklist ?? []).map((c, i) => `${i + 1}. ${c.text}`).join("\n");
      return finish(scope, content, version, [{ n: 1, label: "Checklist", text, ocr: false, confidence: null, edited: false }]);
    }
    if (content.type === "link") {
      return finish(scope, content, version, [{ n: 1, label: "Link", text: `# ${content.title}\n\n${content.description}\n\nLink: ${version.url ?? content.url ?? ""}`, ocr: false, confidence: null, edited: false }]);
    }
    const [files] = await bucket().getFiles({ prefix: paths.uploadPrefix(scope, content.id, version.id) });
    const f = files.find((x) => !x.name.endsWith("/"));
    if (!f) throw new Error("The uploaded file wasn't found. Upload it again.");
    const [meta] = await f.getMetadata();
    const mime = String(meta.contentType ?? version.mime ?? "");
    const [buf] = await f.download();
    if (isPdf(f.name, mime)) return processPdf(scope, content, version, buf);
    if (isDocx(f.name, mime)) {
      const md = await docxToMarkdown(buf);
      const pages = markdownToPages(md).map((p, i) => ({ ...p, label: `Part ${i + 1}`, ocr: false, confidence: null, edited: false }));
      if (!pages.length) throw new Error("No text was found in this Word document.");
      return finish(scope, content, version, pages);
    }
    if (isImage(f.name, mime)) {
      const img = await viewerImage(buf);
      await Promise.all([writeBytes(`${draft}pages/1.jpg`, img.full, "image/jpeg"), writeBytes(`${draft}thumbs/1.jpg`, img.thumb, "image/jpeg")]);
      const r = await ocrPage(await ocrImage(buf));
      return finish(scope, content, version, [{ n: 1, label: "1", text: r.text, ocr: true, confidence: r.confidence, edited: false }]);
    }
    throw new Error("This file type isn't supported. Upload a PDF, Word (.docx) file, or a JPG or PNG image.");
  } catch (e) {
    // Rate limits and outages: let Cloud Tasks retry with backoff before giving up
    if (/\b(429|500|502|503|504)\b|ECONNRESET|ETIMEDOUT|fetch failed/.test((e as Error).message) && retryCount < 4) throw e;
    logger.error("ingest failed", { scope: scopeKey(scope), contentId, versionId, err: (e as Error).message });
    await versionRef(scope, contentId, versionId).update({ status: "draft", processingError: (e as Error).message.slice(0, 400), ocrStatus: "failed" });
    await db.doc(`digitisationJobs/${versionId}`).set({ status: "failed", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
  }
}

export const ingestTask = onTaskDispatched(
  { region: "europe-west1", retryConfig: { maxAttempts: 5, minBackoffSeconds: 30, maxBackoffSeconds: 600 }, rateLimits: { maxConcurrentDispatches: 8 }, memory: "2GiB", cpu: 2, timeoutSeconds: 540 },
  async (req) => {
    const { scope, contentId, versionId } = req.data as { scope: string; contentId: string; versionId: string };
    await runIngest(scopeOf(scope), contentId, versionId, req.retryCount ?? 0);
  },
);
