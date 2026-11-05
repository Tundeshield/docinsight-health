// F13 platform admin console (DocInsight staff) and F9 Knowledge Hub management.
import { onRequest } from "firebase-functions/v2/https";
import type { BillingConfig, ContentItem, ContentVersion, DigitisationJob, DocumentType, HubCollection, Institution, Invoice, Plan } from "../../../shared/src/types";
import { DOCUMENT_TYPES } from "../../../shared/src/config";
import { monthlyRevenue } from "../../../shared/src/billing";
import { db, FieldValue, monthKey, Timestamp, toDate } from "../lib/admin";
import { requirePlatformAdmin } from "../lib/access";
import { bool, dateStr, fail, id, oneOf, reqStr, str, strList } from "../lib/errors";
import { callable } from "../lib/fn";
import { loadConfig } from "../lib/plans";
import { ANTHROPIC_API_KEY, DOCAI_PROCESSOR, PAYSTACK_SECRET_KEY, RESEND_API_KEY, secretValue } from "../lib/params";
import { contentRef, paths, versionRef, type Scope } from "../lib/scope";
import { enqueueIngest } from "../pipeline/ingest";
import { readJson, writeJson, type TextFile } from "../pipeline/store";
import { activateChunks, bumpCorpus, enqueuePublish } from "../pipeline/publish";

export const platformListInstitutions = callable(async (req) => {
  await requirePlatformAdmin(req);
  const { plans } = await loadConfig();
  const snap = await db.collection("institutions").get();
  const month = monthKey();
  const rows = await Promise.all(snap.docs.map(async (d) => {
    const i = { id: d.id, ...d.data() } as Institution;
    const plan = plans.find((p) => p.id === i.planId)!;
    const [usage, members, open] = await Promise.all([
      db.doc(`institutions/${d.id}/usage/${month}`).get(),
      db.collection(`institutions/${d.id}/members`).where("status", "==", "active").count().get(),
      db.collection(`institutions/${d.id}/invoices`).where("status", "==", "open").get(),
    ]);
    const u = usage.data() ?? {};
    return {
      id: i.id, name: i.name, planId: i.planId, planName: plan?.name ?? i.planId, billingCycle: i.billingCycle, status: i.status,
      seats: members.data().count, seatLimit: plan?.seatLimit == null ? null : plan.seatLimit + (i.extraSeats ?? 0),
      questionsThisMonth: u.questions ?? 0, costMicrosThisMonth: u.costMicros ?? 0, ocrPagesThisMonth: u.ocrPages ?? 0,
      mrr: plan ? monthlyRevenue(plan, i.billingCycle, i.status, i.discountPct ?? 0, Math.floor((i.extraSeats ?? 0) / 10)) : 0,
      discountPct: i.discountPct ?? 0, pilot: !!i.pilot, currentPeriodEnd: toDate(i.currentPeriodEnd)?.toISOString() ?? null,
      lastActivityAt: toDate(i.lastActivityAt)?.toISOString() ?? null, createdAt: toDate(i.createdAt)?.toISOString() ?? null,
      openInvoices: open.docs.map((x) => { const v = x.data() as Invoice; return { id: v.id, number: v.number, amount: v.amount, method: v.method, dueAt: v.dueAt.toDate().toISOString() }; }),
    };
  }));
  const totals = { mrr: rows.reduce((a, r) => a + r.mrr, 0), institutions: rows.length, active: rows.filter((r) => ["active", "past_due"].includes(r.status)).length, pending: rows.filter((r) => r.status === "pending_payment").length, costMicros: rows.reduce((a, r) => a + r.costMicrosThisMonth, 0) };
  return { rows: rows.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "")), totals };
});

/** Read-only support view of an institution's setup. Never staff conversations. */
export const platformSupportView = callable(async (req) => {
  await requirePlatformAdmin(req);
  const instId = id(req.data.instId, "institution");
  const [i, spaces, sections, members, content, invoices] = await Promise.all([
    db.doc(`institutions/${instId}`).get(),
    db.collection(`institutions/${instId}/spaces`).get(),
    db.collection(`institutions/${instId}/sections`).get(),
    db.collection(`institutions/${instId}/members`).get(),
    db.collection(`institutions/${instId}/content`).get(),
    db.collection(`institutions/${instId}/invoices`).orderBy("issuedAt", "desc").limit(30).get(),
  ]);
  if (!i.exists) throw fail.notFound();
  const inst = i.data() as Institution;
  const roles: Record<string, number> = {};
  members.docs.forEach((m) => { if (m.data().status === "active") roles[m.data().role] = (roles[m.data().role] ?? 0) + 1; });
  return {
    institution: { id: instId, name: inst.name, status: inst.status, planId: inst.planId, billingCycle: inst.billingCycle, joinCode: inst.joinCode, emailDomains: inst.emailDomains, settings: inst.settings, billingContact: inst.billingContact, discountPct: inst.discountPct, extraSeats: inst.extraSeats, pilot: inst.pilot ? { endsAt: toDate(inst.pilot.endsAt)?.toISOString() } : null, setupPackageId: inst.setupPackageId, currentPeriodEnd: toDate(inst.currentPeriodEnd)?.toISOString() ?? null },
    spaces: spaces.docs.map((s) => ({ id: s.id, name: s.data().name, visibility: s.data().visibility, archived: s.data().archived, requiresApproval: s.data().requiresApproval, approvers: s.data().approverNames, sections: sections.docs.filter((x) => x.data().spaceId === s.id).map((x) => x.data().name), documents: content.docs.filter((c) => c.data().spaceId === s.id).length })),
    members: { total: members.size, active: Object.values(roles).reduce((a, b) => a + b, 0), roles },
    content: { total: content.size, published: content.docs.filter((c) => c.data().published).length, inReview: content.docs.filter((c) => c.data().status === "in_review").length, drafts: content.docs.filter((c) => c.data().status === "draft").length },
    invoices: invoices.docs.map((d) => { const v = d.data() as Invoice; return { id: v.id, number: v.number, amount: v.amount, status: v.status, method: v.method, kind: v.kind, issuedAt: v.issuedAt.toDate().toISOString(), paidAt: v.paidAt?.toDate().toISOString() ?? null, pdfRef: v.pdfRef, receiptRef: v.receiptRef }; }),
  };
});

export const platformUpdateJob = callable(async (req) => {
  const c = await requirePlatformAdmin(req);
  const ref = db.doc(`digitisationJobs/${id(req.data.jobId, "job")}`);
  const job = (await ref.get()).data() as DigitisationJob | undefined;
  if (!job) throw fail.notFound();
  await ref.update({
    ...(req.data.assignee !== undefined && { assignee: str(req.data.assignee, 120) || null }),
    ...(req.data.status !== undefined && { status: oneOf(req.data.status, ["received", "ocr", "checking", "ready", "published", "failed"] as const, job.status) }),
    ...(req.data.pagesReceived !== undefined && { pagesReceived: Math.max(0, Number(req.data.pagesReceived) || 0) }),
    updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid,
  });
  return { ok: true };
});

/** Paper binders received on site but not yet scanned: tracked as a job before any upload exists. */
export const platformCreateJob = callable(async (req) => {
  await requirePlatformAdmin(req);
  const instId = id(req.data.instId, "institution");
  const i = (await db.doc(`institutions/${instId}`).get()).data();
  if (!i) throw fail.notFound();
  const ref = db.collection("digitisationJobs").doc();
  await ref.set({ id: ref.id, institutionId: instId, institutionName: i.name, contentId: "", versionId: "", title: reqStr(req.data.title, 200, "a title"), pagesReceived: Math.max(0, Number(req.data.pagesReceived) || 0), pagesOcrd: 0, pagesChecked: 0, lowConfidencePages: [], status: "received", assignee: str(req.data.assignee, 120) || null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() } satisfies DigitisationJob);
  return { jobId: ref.id };
});

export const platformUpdatePlan = callable(async (req) => {
  await requirePlatformAdmin(req);
  const planId = oneOf(req.data.planId, ["clinic", "hospital", "group"] as const, "clinic");
  const f = (req.data.fields ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null ? null : Math.max(0, Math.round(Number(v))));
  const update: Partial<Plan> = {
    ...(f.name !== undefined && { name: reqStr(f.name, 60, "a name") }),
    ...(f.description !== undefined && { description: str(f.description, 200) }),
    ...(f.priceMonthly !== undefined && { priceMonthly: num(f.priceMonthly)! }),
    ...(f.priceAnnual !== undefined && { priceAnnual: num(f.priceAnnual)! }),
    ...(f.seatLimit !== undefined && { seatLimit: num(f.seatLimit) }),
    ...(f.siteLimit !== undefined && { siteLimit: num(f.siteLimit) }),
    ...(f.docLimit !== undefined && { docLimit: num(f.docLimit) }),
    ...(f.aiQuestionLimit !== undefined && { aiQuestionLimit: num(f.aiQuestionLimit) }),
    ...(f.extraSeatBlockPrice !== undefined && { extraSeatBlockPrice: num(f.extraSeatBlockPrice)! }),
    ...(f.paystackPlanCodeMonthly !== undefined && { paystackPlanCodeMonthly: str(f.paystackPlanCodeMonthly, 60) }),
    ...(f.paystackPlanCodeAnnual !== undefined && { paystackPlanCodeAnnual: str(f.paystackPlanCodeAnnual, 60) }),
    ...(f.features !== undefined && { features: strList(f.features, 12, 80) }),
    ...(f.active !== undefined && { active: bool(f.active, true) }),
  };
  await db.doc(`plans/${planId}`).set(update, { merge: true });
  return { ok: true };
});

export const platformUpdateBillingConfig = callable(async (req) => {
  await requirePlatformAdmin(req);
  const f = (req.data.fields ?? {}) as Record<string, unknown>;
  const update: Partial<BillingConfig> = {
    ...(f.paystackEnabled !== undefined && { paystackEnabled: bool(f.paystackEnabled) }),
    ...(f.bankTransfer !== undefined && { bankTransfer: { accountName: str((f.bankTransfer as Record<string, unknown>).accountName, 120), bankName: str((f.bankTransfer as Record<string, unknown>).bankName, 120), accountNumber: str((f.bankTransfer as Record<string, unknown>).accountNumber, 30), note: str((f.bankTransfer as Record<string, unknown>).note, 300) } }),
    ...(f.supportEmail !== undefined && { supportEmail: str(f.supportEmail, 200) }),
    ...(f.companyAddress !== undefined && { companyAddress: str(f.companyAddress, 300) }),
    ...(f.extraPagePrice !== undefined && { extraPagePrice: Math.max(0, Math.round(Number(f.extraPagePrice))) }),
    ...(f.vatPct !== undefined && { vatPct: Math.max(0, Math.min(50, Number(f.vatPct) || 0)) }),
  };
  await db.doc("config/billing").set(update, { merge: true });
  return { ok: true };
});

// ---------- Knowledge Hub (platform-owned, read-only to institutions) ----------

const HUB: Scope = { kind: "hub" };
const DOC_TYPES = DOCUMENT_TYPES.map((d) => d.id) as readonly DocumentType[];

export const hubSaveCollection = callable(async (req) => {
  await requirePlatformAdmin(req);
  const ref = req.data.collectionId ? db.doc(`hubCollections/${id(req.data.collectionId, "collection")}`) : db.collection("hubCollections").doc();
  const order = req.data.collectionId ? undefined : (await db.collection("hubCollections").count().get()).data().count;
  await ref.set({ id: ref.id, name: reqStr(req.data.name, 100, "a name"), description: str(req.data.description, 300), archived: bool(req.data.archived), ...(order !== undefined && { order }) } satisfies Partial<HubCollection>, { merge: true });
  if (req.data.archived !== undefined) await bumpCorpus(HUB);
  return { collectionId: ref.id };
});

export const hubCreateContent = callable(async (req) => {
  const c = await requirePlatformAdmin(req);
  const d = req.data;
  const col = (await db.doc(`hubCollections/${id(d.collectionId, "collection")}`).get());
  if (!col.exists) throw fail.notFound("That collection doesn't exist.");
  const f = (d.file ?? {}) as Record<string, unknown>;
  const fileName = str(f.name, 200).replace(/[^\w.\- ()]+/g, "_");
  if (!fileName) throw fail.invalid("Choose a file.");
  const cref = db.collection("hubContent").doc();
  const vref = cref.collection("versions").doc();
  const content: ContentItem = {
    id: cref.id, spaceId: col.id, sectionId: null, type: "file", title: reqStr(d.title, 200, "a title"), description: str(d.description, 1000), ownerId: c.uid, ownerName: "DocInsight",
    documentType: oneOf(d.documentType, DOC_TYPES, "guideline"), tags: strList(d.tags, 20, 40), language: oneOf(d.language, ["en", "fr"] as const, "en"), status: "draft", published: false,
    currentVersionId: null, currentVersionNumber: null, latestVersionId: vref.id, versionCount: 1, effectiveDate: dateStr(d.publicationDate), reviewDate: dateStr(d.reviewDate),
    reviewRemindersSent: [], mustRead: false, mustReadVersionId: null, pageCount: 0, approvedByName: null, approvedAt: null, url: null, source: "hub",
    sourceName: reqStr(d.sourceName, 200, "the source (publisher)"), publicationDate: dateStr(d.publicationDate) ?? "", originalUrl: str(d.originalUrl, 1000),
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  };
  const version: Partial<ContentVersion> = {
    id: vref.id, number: 1, status: "uploading", fileRef: paths.upload(HUB, cref.id, vref.id, fileName), fileName, mime: str(f.mime, 120), sizeBytes: Number(f.size) || 0,
    pageCount: 0, pageLabels: [], ocrStatus: "pending", ocrConfidence: null, ocrPages: [], lowConfidencePages: [], checkedPages: [], processingError: null, processedPages: 0,
    body: null, checklist: null, url: null, changeNote: str(d.changeNote, 300), createdBy: c.uid, createdByName: "DocInsight", createdAt: Timestamp.now(), active: false, chunkCount: 0,
  };
  await cref.set(content);
  await vref.set(version);
  return { contentId: cref.id, versionId: vref.id, uploadPath: version.fileRef };
});

export const hubProcessVersion = callable(async (req) => {
  await requirePlatformAdmin(req);
  const cid = id(req.data.contentId, "content"), vid = id(req.data.versionId, "version");
  await versionRef(HUB, cid, vid).update({ status: "processing", processingError: null, processedPages: 0 });
  await enqueueIngest(HUB, cid, vid);
  return { ok: true };
});

export const hubPublish = callable(async (req) => {
  const c = await requirePlatformAdmin(req);
  const cid = id(req.data.contentId, "content"), vid = id(req.data.versionId, "version");
  const v = (await versionRef(HUB, cid, vid).get()).data() as ContentVersion | undefined;
  if (!v) throw fail.notFound();
  const unchecked = v.lowConfidencePages.filter((n) => !(v.checkedPages ?? []).includes(n));
  if (unchecked.length) throw fail.precondition(`${unchecked.length} scanned pages still need checking.`);
  if (bool(req.data.confirmRights) !== true) throw fail.precondition("Confirm you have checked the usage rights for this document before publishing it to every hospital.", { reason: "rights" });
  await versionRef(HUB, cid, vid).update({ status: "approved", approvedBy: c.uid, approvedByName: "DocInsight", approvedAt: Timestamp.now() });
  await contentRef(HUB, cid).update({ rightsConfirmedBy: c.uid, rightsConfirmedAt: FieldValue.serverTimestamp() });
  await enqueuePublish(HUB, cid, vid, { uid: c.uid, name: "DocInsight" });
  return { ok: true };
});

/** Digitisation check for hub documents: correct scanned-page text and mark pages checked. */
export const hubSavePageCorrections = callable(async (req) => {
  await requirePlatformAdmin(req);
  const cid = id(req.data.contentId, "content"), vid = id(req.data.versionId, "version");
  const v = (await versionRef(HUB, cid, vid).get()).data() as ContentVersion | undefined;
  if (!v) throw fail.notFound();
  if (["approved", "superseded"].includes(v.status)) throw fail.precondition("Published versions can't be edited. Upload a new version instead.");
  const path = `${paths.draft(HUB, cid, vid)}text.json`;
  const text = await readJson<TextFile>(path);
  if (!text) throw fail.notFound("This version hasn't been processed yet.");
  let changed = false;
  for (const e of (Array.isArray(req.data.pages) ? req.data.pages : []).slice(0, 2000) as { n: number; text: string }[]) {
    const p = text.pages.find((x) => x.n === Number(e.n));
    if (p && typeof e.text === "string" && e.text !== p.text) { p.text = e.text.slice(0, 50_000); p.edited = true; changed = true; }
  }
  if (changed) await writeJson(path, text);
  const checked = [...new Set([...(v.checkedPages ?? []), ...((Array.isArray(req.data.checked) ? req.data.checked : []) as number[]).map(Number).filter((n) => v.lowConfidencePages.includes(n))])];
  const remaining = v.lowConfidencePages.filter((n) => !checked.includes(n));
  await versionRef(HUB, cid, vid).update({ checkedPages: checked, ocrStatus: remaining.length ? "needs_review" : "done" });
  await db.doc(`digitisationJobs/${vid}`).set({ pagesChecked: checked.length, status: remaining.length ? "checking" : "ready", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
  return { ok: true, remaining };
});

export const hubArchive = callable(async (req) => {
  await requirePlatformAdmin(req);
  const cid = id(req.data.contentId, "content");
  const archive = req.data.archived !== false;
  const content = (await contentRef(HUB, cid).get()).data() as ContentItem;
  await contentRef(HUB, cid).update({ status: archive ? "archived" : "approved", published: !archive && !!content.currentVersionId });
  await activateChunks(HUB, cid, archive ? null : content.currentVersionId);
  await bumpCorpus(HUB);
  return { ok: true };
});

// ---------- Health page ----------

async function healthReport() {
  const since = Timestamp.fromMillis(Date.now() - 86_400_000);
  const stuckBefore = Timestamp.fromMillis(Date.now() - 30 * 60_000);
  const [processing, failedJobs, checking, hub] = await Promise.all([
    db.collectionGroup("versions").where("status", "==", "processing").get(),
    db.collection("digitisationJobs").where("status", "==", "failed").where("updatedAt", ">=", since).get(),
    db.collection("digitisationJobs").where("status", "==", "checking").count().get(),
    db.doc("config/hub").get(),
  ]);
  const stuck = processing.docs.filter((d) => (d.data().createdAt as Timestamp)?.toMillis?.() < stuckBefore.toMillis());
  const checks = {
    anthropic: !!secretValue(ANTHROPIC_API_KEY), documentAi: !!DOCAI_PROCESSOR.value(), email: !!secretValue(RESEND_API_KEY), paystack: !!secretValue(PAYSTACK_SECRET_KEY),
  };
  return {
    ok: stuck.length === 0 && checks.anthropic,
    at: new Date().toISOString(),
    ingestion: { processing: processing.size, stuck: stuck.map((d) => d.ref.path), failedLast24h: failedJobs.docs.map((d) => ({ id: d.id, title: d.data().title, institution: d.data().institutionName })), pagesAwaitingCheck: checking.data().count },
    configured: checks,
    hubCorpusVersion: hub.data()?.corpusVersion ?? 0,
  };
}

export const platformHealth = callable(async (req) => {
  await requirePlatformAdmin(req);
  return healthReport();
}, { secrets: [ANTHROPIC_API_KEY, PAYSTACK_SECRET_KEY] });

/** Public liveness check for uptime monitors: no details. */
export const health = onRequest({ region: "europe-west1", secrets: [ANTHROPIC_API_KEY, PAYSTACK_SECRET_KEY, RESEND_API_KEY] }, async (_req, res) => {
  try {
    const r = await healthReport();
    res.status(r.ok ? 200 : 503).json({ ok: r.ok, at: r.at, stuck: r.ingestion.stuck.length, ai: r.configured.anthropic });
  } catch (e) {
    res.status(503).json({ ok: false, error: (e as Error).message.slice(0, 200) });
  }
});
