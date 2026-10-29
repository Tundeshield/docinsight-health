// The answering agent. Streams Server-Sent Events:
//   status {text}      what the agent is doing ("Searching for …")
//   delta  {text}      answer text as it is written
//   reset  {}          discard streamed text (the agent decided to search more)
//   done   {answer, citations, warnings}
//   error  {message}
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import Anthropic from "@anthropic-ai/sdk";
import { db, adminAuth, FieldValue, monthKey } from "./admin.js";
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, CATEGORIES } from "./config.js";
import { checkAllowance } from "./plans.js";
import { loadCorpus, neighbour, overdue } from "./corpus.js";
import { search } from "./search.js";
import { RULES } from "./prompts.js";
import { passageView } from "./library.js";

const MAX_ROUNDS = 6;
const ROLES = ["nurse or midwife", "doctor", "biomedical engineer or technician", "pharmacist", "admin, front desk or billing staff", "member of staff"];
export const CITE_RE = /\[((?:s[a-z0-9]{8}\.\d+)(?:\s*[,;]\s*s[a-z0-9]{8}\.\d+)*)\]/g;

function fmtPassage(c, s, max = 1400) {
  const t = c.text.length > max ? c.text.slice(0, max) + " …" : c.text;
  return `[${c.id}] ${CATEGORIES[s.category] || "Document"}${s.area ? " (" + s.area + ")" : ""}: ${s.title} › ${c.path}${overdue(s) ? " [document past review date]" : ""}${c.ocr ? " [transcribed from a scanned page]" : ""}\n${t}`;
}

export function catalog(corpus) {
  const per = Math.max(12, Math.floor(160 / Math.max(1, corpus.ordered.length)));
  const bySrc = new Map(); for (const c of corpus.chunks) { if (!bySrc.has(c.srcId)) bySrc.set(c.srcId, []); bySrc.get(c.srcId).push(c); }
  return corpus.ordered.map(s => {
    const list = (bySrc.get(s.id) || []).sort((a, b) => +a.id.split(".")[1] - +b.id.split(".")[1]);
    const heads = []; let last = null;
    for (const c of list) { const p = c.path.replace(/,?\s*page \d+( \(scanned\))?$/i, "").trim() || "(start)"; if (p !== last) { heads.push(`${p} [${c.id}]`); last = p; } }
    const shown = heads.length > per ? heads.slice(0, per).concat([`and ${heads.length - per} more headings (use list_sections)`]) : heads;
    const review = s.reviewDate ? (overdue(s) ? ` PAST REVIEW DATE (was due ${s.reviewDate}).` : ` Next review ${s.reviewDate}.`) : "";
    return `Document ${s.id}: "${s.title}". ${CATEGORIES[s.category] || "Document"}${s.area ? ", " + s.area : ""}${s.version ? ", " + s.version : ""}.${review} ${list.length} sections.\nOutline: ${shown.join("; ")}`;
  }).join("\n\n");
}

const TOOLS = [
  { name: "search_docs", description: "Keyword search over the hospital's document library. Returns up to 6 passages with IDs, document, section and the start of the text. Use specific terms: equipment models, alarm text, error codes, ward names, in English or French. Optional category filter.",
    input_schema: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: ["any", ...Object.keys(CATEGORIES)] } }, required: ["query"] } },
  { name: "list_sections", description: "Browse a document's outline like a table of contents: section IDs in order with headings and first words. Use for broad questions or to find where a topic sits in a long manual.",
    input_schema: { type: "object", properties: { doc_id: { type: "string" }, start: { type: "number" }, count: { type: "number" } }, required: ["doc_id"] } },
  { name: "read_passage", description: "Read one passage in full by its ID. Also returns the previous and next section IDs.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }
];

function runTool(corpus, name, input, status) {
  if (name === "search_docs") {
    const q = String(input.query || "").slice(0, 200); const category = CATEGORIES[input.category] ? input.category : "any";
    status(`Searching for “${q}”`);
    const r = search(corpus.index, q, { category, limit: 6 });
    return r.length ? r.map(x => fmtPassage(x.c, x.src, 700)).join("\n\n") : "No passages matched. Try other wording or the other language.";
  }
  if (name === "list_sections") {
    const s = corpus.sources.get(String(input.doc_id || "")); if (!s) return { error: `No document with ID ${input.doc_id}` };
    status(`Browsing ${s.title}`);
    const all = corpus.chunks.filter(c => c.srcId === s.id).sort((a, b) => +a.id.split(".")[1] - +b.id.split(".")[1]);
    const start = Math.max(1, Math.floor(Number(input.start) || 1)); const count = Math.min(40, Math.max(1, Math.floor(Number(input.count) || 30)));
    const rows = all.slice(start - 1, start - 1 + count).map(c => `${c.id}: ${c.path}: ${c.text.replace(/\s+/g, " ").slice(0, 90)}`);
    return rows.length ? rows.join("\n") + (start - 1 + count < all.length ? `\n(${all.length - (start - 1 + count)} more sections)` : "") : `No sections from ${start}; the document has ${all.length}.`;
  }
  if (name === "read_passage") {
    const id = String(input.id || "").replace(/[\[\]\s]/g, ""); const c = corpus.byId.get(id);
    if (!c) return { error: `No passage with ID ${id}` };
    const s = corpus.sources.get(c.srcId); status(`Reading ${c.path}`);
    return `${fmtPassage(c, s, 4000)}\n\nPrevious section: ${neighbour(corpus, id, -1) || "none"}. Next section: ${neighbour(corpus, id, 1) || "none"}.`;
  }
  return { error: `Unknown tool ${name}` };
}

export const ask = onRequest({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: "1GiB", concurrency: 40, cors: true }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Use POST"); return; }
  let uid;
  try { uid = (await adminAuth.verifyIdToken(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""))).uid; }
  catch { res.status(401).json({ message: "Sign in again to continue." }); return; }

  const { orgId, question: rawQ, role: rawRole, history: rawHistory } = req.body || {};
  const question = typeof rawQ === "string" ? rawQ.trim().slice(0, 2000) : "";
  if (!question || typeof orgId !== "string") { res.status(400).json({ message: "Type a question." }); return; }
  const role = ROLES.includes(rawRole) ? rawRole : "member of staff";
  const history = (Array.isArray(rawHistory) ? rawHistory : []).slice(-6)
    .filter(t => t && ["user", "assistant"].includes(t.role) && typeof t.content === "string")
    .map(t => ({ role: t.role, content: t.content.slice(0, 6000) }));
  if (history.length && history[0].role !== "user") history.shift();

  const [orgSnap, memSnap] = await Promise.all([db.doc(`orgs/${orgId}`).get(), db.doc(`orgs/${orgId}/members/${uid}`).get()]);
  if (!orgSnap.exists || !memSnap.exists) { res.status(403).json({ message: "You're not a member of this organisation." }); return; }
  const org = { id: orgId, ...orgSnap.data() };
  try { await checkAllowance(org, "questions", 1); }
  catch (e) { res.status(402).json({ message: e.message, reason: e.details?.reason }); return; }

  res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  let closed = false; let current = null;
  req.on("close", () => { closed = true; try { current?.abort(); } catch {} });

  try {
    const corpus = await loadCorpus(orgId, org.corpusVersion || 0);
    if (!corpus.chunks.length) { send("error", { message: "No documents are ready yet. A library manager needs to add documents first." }); res.end(); return; }

    let initial = search(corpus.index, question, { limit: 6 });
    const searched = initial.length > 0;
    if (!searched) { const recent = corpus.ordered[corpus.ordered.length - 1]; initial = corpus.chunks.filter(c => c.srcId === recent.id).slice(0, 3).map(c => ({ c, src: recent })); }
    const userTurn = `Question: ${question}\n\n${searched ? "Initial search results (may be incomplete)" : "Keyword search found nothing for this question (it may be in another language or use different terms), so here are the opening passages of the most recently added document"}:\n\n${initial.map(r => fmtPassage(r.c, r.src)).join("\n\n")}`;

    const system = [{ type: "text", text: RULES(role, new Date().toISOString().slice(0, 10), catalog(corpus)), cache_control: { type: "ephemeral" } }];
    const messages = [...history, { role: "user", content: userTurn }];
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const usage = { input: 0, output: 0, cacheRead: 0 };
    let final = "", truncated = false, rounds = 0;

    for (let round = 0; round < MAX_ROUNDS && !closed; round++) {
      rounds++;
      current = client.messages.stream({ model: CLAUDE_MODEL.value(), max_tokens: 3000, system, tools: TOOLS, tool_choice: round === MAX_ROUNDS - 1 ? { type: "none" } : { type: "auto" }, messages });
      current.on("text", (t) => { if (!closed) send("delta", { text: t }); });
      const msg = await current.finalMessage();
      usage.input += msg.usage?.input_tokens || 0; usage.output += msg.usage?.output_tokens || 0; usage.cacheRead += msg.usage?.cache_read_input_tokens || 0;
      if (msg.stop_reason === "tool_use") {
        send("reset", {});
        messages.push({ role: "assistant", content: msg.content });
        const results = msg.content.filter(b => b.type === "tool_use").map(b => {
          const out = runTool(corpus, b.name, b.input || {}, (text) => send("status", { text }));
          return typeof out === "string" ? { type: "tool_result", tool_use_id: b.id, content: out } : { type: "tool_result", tool_use_id: b.id, content: out.error, is_error: true };
        });
        messages.push({ role: "user", content: results });
        continue;
      }
      final = msg.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
      truncated = msg.stop_reason === "max_tokens";
      break;
    }
    if (closed) return;

    const citations = {}; let dropped = 0;
    for (const m of final.matchAll(CITE_RE)) for (const id of m[1].split(/\s*[,;]\s*/)) {
      const c = corpus.byId.get(id);
      if (c) citations[id] = passageView(c, corpus.sources.get(c.srcId)); else dropped++;
    }
    send("done", { answer: final, citations, dropped, truncated });
    res.end();

    const cited = [...new Set(Object.values(citations).map(c => c.source.id))];
    await Promise.all([
      db.collection(`orgs/${orgId}/questions`).add({ uid, role, question, citedSources: cited, citedPassages: Object.keys(citations), rounds, tokens: usage, createdAt: FieldValue.serverTimestamp() }),
      db.doc(`orgs/${orgId}/usage/${monthKey()}`).set({ questions: FieldValue.increment(1), inputTokens: FieldValue.increment(usage.input), outputTokens: FieldValue.increment(usage.output), cacheReadTokens: FieldValue.increment(usage.cacheRead) }, { merge: true })
    ]);
  } catch (e) {
    logger.error("ask failed", { orgId, err: e.message, status: e.status });
    const message = e?.status === 429 ? "DocInsight is busy right now. Ask again in a minute." : "Something went wrong while answering. Ask again in a moment.";
    if (!closed) { send("error", { message }); res.end(); }
  }
});
