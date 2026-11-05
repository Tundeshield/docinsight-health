// F6 search and F7 Ask DocInsight.
import { onCall, HttpsError, type CallableRequest, type CallableResponse } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { createHash } from "node:crypto";
import type { AnswerStatus, Citation, ContentItem, QuestionRecord, Space } from "../../../shared/src/types";
import { NOT_FOUND_MESSAGE, OFF_TOPIC_MESSAGE } from "../../../shared/src/config";
import { detectPii, piiMessage } from "../../../shared/src/pii";
import { renumber, stripInvalid, validateCitations } from "../../../shared/src/citations";
import { normalizeQuestion, snippet, buildBm25, searchBm25 } from "../../../shared/src/text";
import { db, FieldValue, Timestamp } from "../lib/admin";
import { requireMember, type Ctx } from "../lib/access";
import { fail, id, oneOf, reqStr, str } from "../lib/errors";
import { callable } from "../lib/fn";
import { ANTHROPIC_API_KEY, RESEND_API_KEY } from "../lib/params";
import { addUsage, costMicros, loadConfig, questionState } from "../lib/plans";
import { managers, notify } from "../lib/notify";
import { sendEmail } from "../lib/email";
import { touchActivity } from "../lib/visibility";
import { answerModel, fastModel } from "../ai/provider";
import { retrieve, type Retrieved } from "../ai/retrieve";
import { ANSWER_SYSTEM, RERANK_SYSTEM, formatPassages, PROMPT_VERSION } from "../ai/prompts";

async function scopeFor(ctx: Ctx) {
  const hidden = new Set(ctx.inst.settings?.hiddenHubCollections ?? []);
  const [hubCols, hubCfg, spaces] = await Promise.all([
    db.collection("hubCollections").where("archived", "==", false).get(),
    db.doc("config/hub").get(),
    db.collection(`institutions/${ctx.instId}/spaces`).where("archived", "==", false).get(),
  ]);
  const visible = new Set(ctx.member.visibleSpaceIds);
  const spaceDocs = spaces.docs.map((d) => ({ id: d.id, ...d.data() }) as Space).filter((s) => ctx.isManager || visible.has(s.id));
  return {
    scope: { instId: ctx.instId, spaceIds: spaceDocs.map((s) => s.id), hubCollectionIds: hubCols.docs.map((d) => d.id).filter((x) => !hidden.has(x)), instCorpus: ctx.inst.corpusVersion ?? 0, hubCorpus: Number(hubCfg.data()?.corpusVersion ?? 0) },
    spaces: new Map(spaceDocs.map((s) => [s.id, s])),
    hubNames: new Map(hubCols.docs.map((d) => [d.id, String(d.data().name ?? "Knowledge Hub")])),
  };
}

async function rateLimit(instId: string, uid: string, perMinute = 8, perDay = 300) {
  const ref = db.doc(`institutions/${instId}/rateLimits/${uid}`);
  await db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data() ?? {};
    const minute = Math.floor(Date.now() / 60_000), day = Math.floor(Date.now() / 86_400_000);
    const m = s.minute === minute ? s.mCount ?? 0 : 0, d = s.day === day ? s.dCount ?? 0 : 0;
    if (m >= perMinute) throw fail.limit("You're asking very quickly. Wait a minute and try again.", { reason: "rate" });
    if (d >= perDay) throw fail.limit("You've reached today's question limit. Try again tomorrow.", { reason: "rate" });
    tx.set(ref, { minute, mCount: m + 1, day, dCount: d + 1 });
  });
}

function label(c: { source: string }): Citation["label"] {
  return c.source === "hub" ? "National guidance" : "Hospital protocol";
}

interface AskResult { questionId: string | null; status: AnswerStatus; answer: string; citations: Citation[]; message?: string; cached?: boolean }

async function rerank(question: string, items: Retrieved[]): Promise<{ picked: Retrieved[]; topic: string; tokens: { i: number; o: number; model: string } }> {
  const fallback = { picked: items.slice(0, 8), topic: "", tokens: { i: 0, o: 0, model: "" } };
  if (items.length <= 3) return fallback;
  try {
    const m = fastModel();
    const r = await m.complete({
      system: RERANK_SYSTEM, maxTokens: 200,
      messages: [{ role: "user", content: `Question: ${question}\n\n${items.map((x, i) => `[${i + 1}] ${x.chunk.title}${x.chunk.headingPath ? " › " + x.chunk.headingPath : ""}\n${x.chunk.text.slice(0, 700)}`).join("\n\n")}` }],
    });
    const json = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)) as { ids: number[]; topic?: string };
    const picked = (json.ids ?? []).map((n) => items[n - 1]).filter(Boolean).slice(0, 8);
    // Keep at least the top 5 fused results available when the reranker is too strict
    const final = picked.length >= 5 ? picked : [...picked, ...items.filter((x) => !picked.includes(x))].slice(0, Math.max(5, picked.length));
    return { picked: final, topic: String(json.topic ?? "").slice(0, 60), tokens: { i: r.inputTokens, o: r.outputTokens, model: r.model } };
  } catch (e) {
    logger.warn("rerank failed", { err: (e as Error).message });
    return fallback;
  }
}

async function likelyOwner(ctx: Ctx, top: Retrieved | undefined, spaces: Map<string, Space>): Promise<string> {
  if (top && top.chunk.source === "hospital") {
    const space = spaces.get(top.chunk.spaceId);
    const content = (await db.doc(`institutions/${ctx.instId}/content/${top.chunk.contentId}`).get()).data() as ContentItem | undefined;
    if (space) return ` The ${space.name} team${content?.ownerName ? ` (${content.ownerName})` : space.approverNames?.length ? ` (${space.approverNames[0]})` : ""} is most likely to know.`;
  }
  const hw = [...spaces.values()].find((s) => s.template === "hospital-wide");
  return hw ? ` Ask the ${hw.name} space admin, or your line manager.` : " Ask your line manager or an admin.";
}

export async function answerQuestion(ctx: Ctx, question: string, progress: (s: string) => void): Promise<AskResult> {
  const hits = detectPii(question);
  if (hits.length) {
    // Blocked and not stored (PRD section 10)
    return { questionId: null, status: "blocked", answer: "", citations: [], message: piiMessage(hits) };
  }
  const qs = await questionState(ctx.inst);
  if (qs.state === "blocked") throw fail.limit(ctx.isManager ? `Your plan's ${qs.limit} AI questions for this month are used up. Upgrade on the Billing page, or questions resume on the 1st. Search still works.` : "Your hospital has used this month's AI questions. Search still works; ask an admin about upgrading.", { reason: "questions", ...qs });
  await rateLimit(ctx.instId, ctx.c.uid);
  const { billing } = await loadConfig();
  const { scope, spaces, hubNames } = await scopeFor(ctx);
  const cacheKey = createHash("sha256").update([PROMPT_VERSION, normalizeQuestion(question), [...scope.spaceIds].sort().join(","), [...scope.hubCollectionIds].sort().join(","), scope.instCorpus, scope.hubCorpus].join("|")).digest("hex");
  const cacheRef = db.doc(`institutions/${ctx.instId}/answerCache/${cacheKey}`);
  const qref = db.collection(`institutions/${ctx.instId}/questions`).doc();
  const cached = await cacheRef.get();
  if (cached.exists && (cached.data()!.expiresAt as Timestamp).toMillis() > Date.now()) {
    const c = cached.data()!;
    const rec: QuestionRecord = { id: qref.id, userId: ctx.c.uid, question, retrievedChunkIds: c.retrievedChunkIds ?? [], answer: c.answer, citations: c.citations, status: c.status, conflict: c.conflict ?? null, topic: c.topic ?? "", feedback: null, cached: true, tokens: { input: 0, output: 0, costMicros: 0 }, hiddenByUser: false, createdAt: Timestamp.now() };
    await qref.set(rec);
    await addUsage(ctx.instId, { questions: 1, notFound: c.status === "not_found" ? 1 : 0 });
    return { questionId: qref.id, status: c.status, answer: c.answer, citations: c.citations, cached: true };
  }

  progress("Searching your hospital's documents…");
  const retrieved = await retrieve(scope, question, 20);
  progress(retrieved.length ? `Reading ${Math.min(8, retrieved.length)} passages…` : "Checking…");
  const tokens = { input: 0, output: 0, cost: 0 };
  const { picked, topic, tokens: rt } = await rerank(question, retrieved);
  tokens.input += rt.i; tokens.output += rt.o; tokens.cost += costMicros(billing.modelPrices, rt.model, rt.i, rt.o);

  let status: AnswerStatus = "answered";
  let answer = "";
  let citations: Citation[] = [];
  let conflict: QuestionRecord["conflict"] = null;

  if (!picked.length) {
    status = "not_found";
  } else {
    const passages = picked.map((r, i) => ({
      n: i + 1, label: label(r.chunk), title: r.chunk.title, version: r.chunk.versionNumber,
      pageLabel: r.chunk.pageLabels[0] === r.chunk.pageLabels[1] ? r.chunk.pageLabels[0] : `${r.chunk.pageLabels[0]}–${r.chunk.pageLabels[1]}`,
      spaceName: r.chunk.source === "hub" ? hubNames.get(r.chunk.spaceId) ?? "Knowledge Hub" : spaces.get(r.chunk.spaceId)?.name ?? "",
      heading: r.chunk.headingPath, text: r.chunk.text, ocr: r.chunk.ocr,
    }));
    const model = answerModel();
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: `Passages:\n\n${formatPassages(passages)}\n\nQuestion: ${question}` }];
    progress("Writing the answer…");
    let r = await model.complete({ system: ANSWER_SYSTEM, messages, maxTokens: 1200 });
    tokens.input += r.inputTokens; tokens.output += r.outputTokens; tokens.cost += costMicros(billing.modelPrices, r.model, r.inputTokens, r.outputTokens);
    let text = r.text.trim();
    const special = (t: string) => (/^NOT_FOUND\.?$/i.test(t) ? "not_found" : /^OFF_TOPIC\.?$/i.test(t) ? "off_topic" : null);
    if (special(text)) status = special(text) as AnswerStatus;
    else {
      const conf = text.match(/\n?CONFLICT:\s*P(\d+)\s*(?:vs\.?|and|,)\s*P(\d+)\s*$/i);
      if (conf) { text = text.slice(0, conf.index).trim(); conflict = { a: picked[Number(conf[1]) - 1]?.chunk.id ?? "", b: picked[Number(conf[2]) - 1]?.chunk.id ?? "" }; }
      progress("Checking every claim has a source…");
      let check = validateCitations(text, passages.length);
      if (!check.ok) {
        // One regeneration with the specific problems, then strip anything still uncited
        messages.push({ role: "assistant", content: r.text }, { role: "user", content: `Some sentences have no valid citation: ${check.sentences.filter((s) => !s.ok).map((s) => `"${s.sentence.slice(0, 120)}"`).join("; ")}. Rewrite the answer so every factual sentence and list item ends with its passage number. Remove anything the passages do not support. Keep the same format.` });
        r = await model.complete({ system: ANSWER_SYSTEM, messages, maxTokens: 1200 });
        tokens.input += r.inputTokens; tokens.output += r.outputTokens; tokens.cost += costMicros(billing.modelPrices, r.model, r.inputTokens, r.outputTokens);
        const t2 = r.text.trim().replace(/\n?CONFLICT:\s*P\d+\s*(?:vs\.?|and|,)\s*P\d+\s*$/i, "").trim();
        if (special(t2)) { status = special(t2) as AnswerStatus; text = ""; }
        else {
          text = t2;
          check = validateCitations(text, passages.length);
          if (!check.ok) text = stripInvalid(text, check);
          check = validateCitations(text, passages.length);
          if (!check.cited.length) status = "not_found";
        }
      }
      if (status === "answered") {
        const { text: renum, order } = renumber(text);
        answer = renum;
        citations = order.map((pn, i) => {
          const c = picked[pn - 1].chunk;
          return {
            n: i + 1, chunkId: c.id, contentId: c.contentId, versionId: c.versionId, title: c.title, versionNumber: c.versionNumber, pages: c.pages,
            pageLabel: passages[pn - 1].pageLabel, spaceId: c.spaceId, spaceName: passages[pn - 1].spaceName, label: label(c), source: c.source, quote: c.text.slice(0, 2000),
          };
        });
      }
    }
  }
  if (status === "not_found") answer = NOT_FOUND_MESSAGE + (await likelyOwner(ctx, retrieved[0], spaces));
  if (status === "off_topic") answer = OFF_TOPIC_MESSAGE;

  const rec: QuestionRecord = {
    id: qref.id, userId: ctx.c.uid, question, retrievedChunkIds: retrieved.map((r) => r.chunk.id), answer, citations, status, conflict,
    topic: topic || (picked[0] ? (spaces.get(picked[0].chunk.spaceId)?.name ?? picked[0].chunk.title) : ""), feedback: null, cached: false,
    tokens: { input: tokens.input, output: tokens.output, costMicros: tokens.cost }, hiddenByUser: false, createdAt: Timestamp.now(),
  };
  await qref.set(rec);
  await cacheRef.set({ answer, citations, status, conflict, topic: rec.topic, retrievedChunkIds: rec.retrievedChunkIds, expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000) });
  await addUsage(ctx.instId, { questions: 1, notFound: status === "not_found" ? 1 : 0, inputTokens: tokens.input, outputTokens: tokens.output, costMicros: tokens.cost });
  await db.collection(`institutions/${ctx.instId}/events`).add({ type: "ask", userId: ctx.c.uid, contentId: citations[0]?.contentId ?? null, query: null, at: FieldValue.serverTimestamp() });
  if (conflict) await flagConflict(ctx, conflict, picked, question);
  return { questionId: qref.id, status, answer, citations };
}

async function flagConflict(ctx: Ctx, conflict: { a: string; b: string }, picked: Retrieved[], question: string) {
  const a = picked.find((p) => p.chunk.id === conflict.a)?.chunk, b = picked.find((p) => p.chunk.id === conflict.b)?.chunk;
  if (!a || !b) return;
  const hospital = [a, b].find((c) => c.source === "hospital");
  const space = hospital ? ((await db.doc(`institutions/${ctx.instId}/spaces/${hospital.spaceId}`).get()).data() as Space | undefined) : undefined;
  const people = (await managers(ctx.instId));
  const extra = space ? (await db.collection(`institutions/${ctx.instId}/members`).where("status", "==", "active").get()).docs.map((d) => ({ ...d.data(), userId: d.id })).filter((m) => space.editorIds.includes((m as { userId: string }).userId) && !people.some((p) => p.userId === (m as { userId: string }).userId)) : [];
  await notify(ctx.instId, "conflict", [...people, ...(extra as never[])], {
    title: "Possible conflict between documents", body: `"${a.title}" and "${b.title}" may disagree.`, path: `/app/doc/${hospital?.contentId ?? a.contentId}`,
    email: { subject: `Possible conflict: ${a.title} and ${b.title}`, lines: [`When answering a staff question, DocInsight found that "${a.title}" (v${a.versionNumber}, page ${a.pageLabels[0]}) and "${b.title}" (v${b.versionNumber}, page ${b.pageLabels[0]}) may give different instructions.`, `Question topic: ${question.slice(0, 160)}`, "Both were shown to staff, labelled, with the hospital protocol first. Please review and resolve."] },
  }, hospital?.contentId ?? null);
}

/** Ask DocInsight. Streams progress to the browser, then returns the cited answer. */
export const ask = onCall({ region: "europe-west1", secrets: [ANTHROPIC_API_KEY, RESEND_API_KEY], memory: "1GiB", timeoutSeconds: 120, maxInstances: 30, concurrency: 20 }, async (req: CallableRequest<Record<string, unknown>>, res?: CallableResponse<unknown>) => {
  try {
    const ctx = await requireMember(req, req.data.instId, { cap: "ask" });
    const question = reqStr(req.data.question, 1000, "a question");
    const progress = (s: string) => { try { if (req.acceptsStreaming) res?.sendChunk({ status: s }); } catch { /* client gone */ } };
    const out = await answerQuestion(ctx, question, progress);
    await touchActivity(ctx.instId, ctx.c.uid);
    return out;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if ((e as Error).message === "AI_NOT_CONFIGURED") throw fail.unavailable("AI answers aren't switched on yet for DocInsight. Search still works.");
    logger.error("ask failed", { err: (e as Error).message, stack: (e as Error).stack });
    throw fail.unavailable("DocInsight couldn't answer just now. Try again in a moment.");
  }
});

/** F6: one search bar across the user's spaces and the Knowledge Hub. */
export const search = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId, { cap: "search" });
  const q = reqStr(req.data.q, 300, "something to search for");
  const f = (req.data.filters ?? {}) as Record<string, unknown>;
  const source = oneOf(f.source, ["all", "hospital", "hub"] as const, "all");
  const { scope, spaces, hubNames } = await scopeFor(ctx);
  if (f.spaceId) { const sid = id(f.spaceId, "space"); scope.spaceIds = scope.spaceIds.filter((s) => s === sid); scope.hubCollectionIds = []; }
  if (source === "hospital") scope.hubCollectionIds = [];
  if (source === "hub") scope.spaceIds = [];
  const hits = await retrieve(scope, q, 40);
  // One result per document, best passage first
  const seen = new Set<string>();
  const results: Record<string, unknown>[] = [];
  for (const h of hits) {
    const c = h.chunk;
    if (seen.has(c.contentId)) continue;
    if (f.sectionId && c.sectionId !== f.sectionId) continue;
    if (f.documentType && c.documentType !== f.documentType) continue;
    seen.add(c.contentId);
    results.push({
      contentId: c.contentId, title: c.title, source: c.source, label: label(c), spaceId: c.spaceId,
      spaceName: c.source === "hub" ? hubNames.get(c.spaceId) ?? "Knowledge Hub" : spaces.get(c.spaceId)?.name ?? "",
      sectionId: c.sectionId, documentType: c.documentType, page: c.pages[0], pageLabel: c.pageLabels[0], heading: c.headingPath,
      snippet: snippet(c.text, q), versionNumber: c.versionNumber,
    });
    if (results.length >= 20) break;
  }
  // Items without searchable text (links) still match by title
  if (source !== "hub" && results.length < 20) {
    const items = (await Promise.all(scope.spaceIds.slice(0, 30).map((s) => db.collection(`institutions/${ctx.instId}/content`).where("spaceId", "==", s).where("published", "==", true).where("type", "==", "link").get()))).flatMap((x) => x.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentItem));
    const ix = buildBm25(items.map((i) => ({ id: i.id, text: `${i.title} ${i.description} ${i.tags.join(" ")}` })));
    for (const m of searchBm25(ix, q, 5)) {
      const i = items.find((x) => x.id === m.id)!;
      if (seen.has(i.id)) continue;
      results.push({ contentId: i.id, title: i.title, source: "hospital", label: "Hospital protocol", spaceId: i.spaceId, spaceName: spaces.get(i.spaceId)?.name ?? "", sectionId: i.sectionId, documentType: i.documentType, page: 1, pageLabel: "Link", heading: "", snippet: i.description || i.url, versionNumber: i.currentVersionNumber });
    }
  }
  await Promise.all([
    db.collection(`institutions/${ctx.instId}/events`).add({ type: "search", userId: ctx.c.uid, contentId: null, query: q.slice(0, 200), at: FieldValue.serverTimestamp() }),
    addUsage(ctx.instId, { searches: 1 }),
    touchActivity(ctx.instId, ctx.c.uid),
  ]);
  return { results };
}, { memory: "1GiB" });

export const rateAnswer = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId);
  const ref = db.doc(`institutions/${ctx.instId}/questions/${id(req.data.questionId, "question")}`);
  const q = (await ref.get()).data() as QuestionRecord | undefined;
  if (!q || q.userId !== ctx.c.uid) throw fail.notFound();
  const rating = oneOf(req.data.rating, ["up", "down"] as const, "up");
  await ref.update({ feedback: { ...(q.feedback ?? { reportedAt: null, note: null }), rating } });
  return { ok: true };
});

/** "Report a problem" alerts the space admin and DocInsight (PRD: within 24 hours). */
export const reportProblem = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId);
  const ref = db.doc(`institutions/${ctx.instId}/questions/${id(req.data.questionId, "question")}`);
  const q = (await ref.get()).data() as QuestionRecord | undefined;
  if (!q || q.userId !== ctx.c.uid) throw fail.notFound();
  const note = str(req.data.note, 1000);
  const rref = db.collection(`institutions/${ctx.instId}/reports`).doc();
  await rref.set({ id: rref.id, questionId: q.id, userId: ctx.c.uid, userName: ctx.member.name, question: q.question, answer: q.answer, citations: q.citations.map((c) => ({ title: c.title, versionNumber: c.versionNumber, pageLabel: c.pageLabel, contentId: c.contentId })), note, status: "open", createdAt: FieldValue.serverTimestamp() });
  await ref.update({ feedback: { rating: q.feedback?.rating ?? "down", reportedAt: FieldValue.serverTimestamp(), note } });
  const spaceIds = [...new Set(q.citations.filter((c) => c.source === "hospital").map((c) => c.spaceId))];
  const spaces = (await Promise.all(spaceIds.map((s) => db.doc(`institutions/${ctx.instId}/spaces/${s}`).get()))).map((s) => s.data() as Space | undefined).filter(Boolean) as Space[];
  const editorIds = new Set(spaces.flatMap((s) => [...s.editorIds, ...s.approverIds]));
  const members = (await db.collection(`institutions/${ctx.instId}/members`).where("status", "==", "active").get()).docs.map((d) => ({ ...d.data(), userId: d.id })) as { userId: string; role: string; email: string }[];
  const people = members.filter((m) => editorIds.has(m.userId) || m.role === "owner" || m.role === "admin");
  const lines = [`${ctx.member.name} reported a problem with an answer in ${ctx.inst.name}.`, `Question: ${q.question}`, note ? `Their note: ${note}` : "No note was added.", `Sources cited: ${q.citations.map((c) => `${c.title} v${c.versionNumber} p.${c.pageLabel}`).join("; ") || "none"}`];
  await notify(ctx.instId, "report", people as never[], { title: "Answer problem reported", body: q.question.slice(0, 120), path: "/app/admin/analytics?tab=reports", email: { subject: `Answer problem reported in ${ctx.inst.name}`, lines } });
  const { platform } = await loadConfig();
  await sendEmail({ to: platform.alertEmails, subject: `[DocInsight] Answer problem reported: ${ctx.inst.name}`, lines: [...lines, `Report id: ${rref.id}`] });
  return { ok: true };
});

/** Clears the caller's conversation history: text is erased, anonymous counts stay for analytics. */
export const clearHistory = callable(async (req) => {
  const ctx = await requireMember(req, req.data.instId);
  const snap = await db.collection(`institutions/${ctx.instId}/questions`).where("userId", "==", ctx.c.uid).where("hiddenByUser", "==", false).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => b.update(d.ref, { hiddenByUser: true, question: "", answer: "", citations: [], retrievedChunkIds: [] }));
    await b.commit();
  }
  return { cleared: snap.size };
});
