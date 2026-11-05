// Text cleaning, structure detection, chunking and keyword search (PRD section 7).
// Pure functions: tested in shared/test and used by Cloud Functions; the tokenizer is
// also used by the web app for offline search over saved documents.

export interface PageInput {
  n: number;
  label: string;
  text: string;
  ocr?: boolean;
}

// ---------------- Cleaning ----------------

const norm = (l: string) => l.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const PAGE_NUMBER = /^(?:page\s*)?[-–]?\s*\d{1,4}\s*(?:of\s*\d{1,4})?\s*[-–]?$|^\d{1,4}\s*\/\s*\d{1,4}$/i;

/** Removes running headers/footers (lines repeated at the top or bottom of most pages) and page numbers. */
export function cleanPages<T extends PageInput>(pages: T[]): T[] {
  const edgeCounts = new Map<string, number>();
  const edges = (lines: string[]) => [...lines.slice(0, 3), ...lines.slice(-3)];
  const split = pages.map((p) => p.text.split("\n").map((l) => l.trimEnd()));
  if (pages.length >= 3) {
    for (const lines of split) {
      const seen = new Set<string>();
      for (const l of edges(lines.filter((x) => x.trim()))) {
        const k = norm(l);
        if (k.length < 3 || seen.has(k)) continue;
        seen.add(k);
        edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
      }
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  return pages.map((p, i) => {
    const lines = split[i];
    const nonEmpty = lines.map((l, idx) => ({ l, idx })).filter((x) => x.l.trim());
    const edgeIdx = new Set([...nonEmpty.slice(0, 3), ...nonEmpty.slice(-3)].map((x) => x.idx));
    const kept = lines.filter((l, idx) => {
      const t = l.trim();
      if (!t) return true;
      if (PAGE_NUMBER.test(t)) return false;
      if (edgeIdx.has(idx) && (edgeCounts.get(norm(t)) ?? 0) >= threshold) return false;
      return true;
    });
    return { ...p, text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
  });
}

// ---------------- Structure ----------------

export type Block =
  | { kind: "heading"; level: number; text: string; page: number }
  | { kind: "paragraph"; text: string; page: number }
  | { kind: "list"; items: string[]; page: number; endPage: number }
  | { kind: "table"; rows: string[]; page: number; endPage: number };

const LIST_ITEM = /^\s*(?:\d{1,3}[.)]|[a-z][.)]|\([a-z0-9]{1,3}\)|[-*•▪●◦–])\s+\S/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

export function headingLevel(line: string, docTitle = ""): number {
  const l = line.trim();
  const md = l.match(/^(#{1,6})\s+\S/);
  if (md) return md[1].length;
  if (l.length < 4 || l.length > 90) return 0;
  if ((l.match(/\p{L}/gu) || []).length < 4) return 0;
  if (/[.;,]$/.test(l)) return 0;
  if (/^(page|rev(ision)?|date|effective|printed|copyright|©|figure|fig\.|table|tableau|signed|approved by|prepared by)\b/i.test(l)) return 0;
  if (/^(warning|warnings|caution|cautions|note|notes|attention|avertissement|continued|suite|blank page|end)\b/i.test(l)) return 0;
  if (docTitle && l.toLowerCase() === docTitle.toLowerCase()) return 0;
  if (/^(chapter|chapitre|part|partie|annex|annexe|appendix|section)\s+[\dA-Z]+/i.test(l)) return 1;
  const num = l.match(/^(\d+(?:\.\d+){0,3})\.?\s+\p{Lu}/u);
  if (num && !LIST_ITEM.test(l.replace(/^\d+\.\d/, "x"))) return Math.min(4, num[1].split(".").length + 1);
  if (num && num[1].includes(".")) return Math.min(4, num[1].split(".").length + 1);
  if (l === l.toUpperCase() && /\p{Lu}{3}/u.test(l)) return 2;
  return 0;
}

/** Turns pages of text into structural blocks, keeping list items and table rows together. */
export function parseBlocks(pages: PageInput[], docTitle = ""): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let paraPage = 0;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ").replace(/\s+/g, " ").trim(), page: paraPage });
    para = [];
  };
  for (const p of pages) {
    const lines = p.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line) { flushPara(); continue; }
      if (TABLE_ROW.test(line)) {
        flushPara();
        const last = blocks[blocks.length - 1];
        if (last && last.kind === "table") { last.rows.push(line); last.endPage = p.n; }
        else blocks.push({ kind: "table", rows: [line], page: p.n, endPage: p.n });
        continue;
      }
      if (LIST_ITEM.test(line)) {
        // A numbered line that looks like a heading ("2. Indications") stays a heading if short and Title Case with no verb-ish punctuation
        const lvl = headingLevel(line, docTitle);
        const looksHeading = lvl > 0 && /^\d+\.?\s+[A-Z][^.]{0,48}$/.test(line) && !/^\d+[.)]\s+[A-Z][a-z]+\s+[a-z]/.test(line) && line.split(/\s+/).length <= 6;
        if (!looksHeading) {
          flushPara();
          const last = blocks[blocks.length - 1];
          if (last && last.kind === "list" && (last.endPage === p.n || last.endPage === p.n - 1)) { last.items.push(line); last.endPage = p.n; }
          else blocks.push({ kind: "list", items: [line], page: p.n, endPage: p.n });
          continue;
        }
      }
      const prev = blocks[blocks.length - 1];
      // Continuation of a list item: indented line, or lowercase start right after an item
      if (!para.length && prev && prev.kind === "list" && (/^\s{2,}/.test(raw) || /^[a-z(]/.test(line))) {
        prev.items[prev.items.length - 1] += " " + line;
        prev.endPage = p.n;
        continue;
      }
      const lvl = headingLevel(line, docTitle);
      if (lvl > 0) {
        flushPara();
        blocks.push({ kind: "heading", level: lvl, text: line.replace(/^#+\s+/, "").replace(/\*\*/g, "").trim(), page: p.n });
        continue;
      }
      if (!para.length) paraPage = p.n;
      para.push(line);
    }
    flushPara(); // paragraphs don't run across pages: keeps page citations exact
  }
  flushPara();
  return blocks;
}

// ---------------- Chunking ----------------

export interface ChunkDraft {
  headingPath: string;
  text: string;
  pages: [number, number];
  wordCount: number;
}

const words = (s: string) => (s.match(/\S+/g) || []).length;

function blockText(b: Block): string {
  switch (b.kind) {
    case "heading": return `${"#".repeat(Math.min(b.level + 1, 6))} ${b.text}`;
    case "paragraph": return b.text;
    case "list": return b.items.join("\n");
    case "table": return b.rows.join("\n");
  }
}
const blockStart = (b: Block) => b.page;
const blockEnd = (b: Block) => ("endPage" in b ? b.endPage : b.page);

/** Splits a list or table that alone exceeds the hard limit at item/row boundaries (never inside one). */
function splitBig(b: Block, max: number): Block[] {
  if (b.kind === "list") {
    const parts: Block[] = []; let cur: string[] = [];
    for (const it of b.items) {
      if (cur.length && words([...cur, it].join(" ")) > max) { parts.push({ ...b, items: cur }); cur = []; }
      cur.push(it);
    }
    if (cur.length) parts.push({ ...b, items: cur });
    return parts;
  }
  if (b.kind === "table") {
    const header = b.rows.slice(0, b.rows[1] && /^\|[\s:|-]+\|$/.test(b.rows[1]) ? 2 : 1);
    const body = b.rows.slice(header.length);
    const parts: Block[] = []; let cur: string[] = [];
    for (const r of body) {
      if (cur.length && words([...header, ...cur, r].join(" ")) > max) { parts.push({ ...b, rows: [...header, ...cur] }); cur = []; }
      cur.push(r);
    }
    if (cur.length || !parts.length) parts.push({ ...b, rows: [...header, ...cur] });
    return parts;
  }
  return [b];
}

/**
 * Chunks by section and heading: about 400–800 words with a small overlap.
 * A numbered list or a table row is never split across chunks.
 */
export function chunkBlocks(blocks: Block[], opts: { min?: number; max?: number; hardMax?: number; overlapWords?: number } = {}): ChunkDraft[] {
  const min = opts.min ?? 400, max = opts.max ?? 800, hardMax = opts.hardMax ?? 1500, overlapWords = opts.overlapWords ?? 50;
  const chunks: ChunkDraft[] = [];
  const path: string[] = [];
  let cur: Block[] = [];
  let curPath = "";
  let curWords = 0;
  let overlap = "";

  const emit = () => {
    const content = cur.filter((b) => b.kind !== "heading");
    if (!content.length) { cur = []; curWords = 0; return; }
    const text = [overlap, ...cur.map(blockText)].filter(Boolean).join("\n\n").trim();
    chunks.push({ headingPath: curPath, text, pages: [Math.min(...cur.map(blockStart)), Math.max(...cur.map(blockEnd))], wordCount: words(text) });
    // Overlap: carry the tail of the last paragraph only (never a list or table)
    const lastPara = [...cur].reverse().find((b) => b.kind === "paragraph");
    overlap = lastPara && lastPara.kind === "paragraph" ? lastPara.text.split(/\s+/).slice(-overlapWords).join(" ") : "";
    if (overlap) overlap = "… " + overlap;
    cur = []; curWords = 0;
  };

  for (const b0 of blocks) {
    const pieces = (b0.kind === "list" || b0.kind === "table") && words(blockText(b0)) > hardMax ? splitBig(b0, max) : [b0];
    for (const b of pieces) {
      if (b.kind === "heading") {
        // A new top-level section closes the current chunk once it has a reasonable size
        if (curWords >= min || (b.level <= 2 && curWords >= min / 2)) emit();
        path.length = Math.min(path.length, b.level - 1);
        path[b.level - 1] = b.text;
        if (!cur.length) curPath = path.filter(Boolean).join(" › ");
        cur.push(b);
        continue;
      }
      const w = words(blockText(b));
      if (curWords > 0 && curWords + w > max && curWords >= min / 2) emit();
      if (!cur.length || cur.every((x) => x.kind === "heading")) curPath = path.filter(Boolean).join(" › ");
      cur.push(b);
      curWords += w;
      if (curWords >= max) emit();
    }
  }
  emit();
  // Merge a tiny trailing chunk into the previous one when they share a section
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1], prev = chunks[chunks.length - 2];
    if (last.wordCount < 80 && last.headingPath === prev.headingPath && prev.wordCount + last.wordCount <= hardMax) {
      prev.text += "\n\n" + last.text.replace(/^… [^\n]*\n\n/, "");
      prev.pages = [prev.pages[0], last.pages[1]];
      prev.wordCount = words(prev.text);
      chunks.pop();
    }
  }
  return chunks;
}

export function chunkPages(pages: PageInput[], docTitle = "", opts?: Parameters<typeof chunkBlocks>[1]): ChunkDraft[] {
  return chunkBlocks(parseBlocks(cleanPages(pages), docTitle), opts);
}

/** Splits long in-app pages (markdown) into page-like parts at H2 headings, so citations point somewhere useful. */
export function markdownToPages(md: string, maxWords = 700): PageInput[] {
  const parts: string[] = [];
  let cur: string[] = [];
  for (const line of md.split("\n")) {
    if (/^##\s/.test(line) && cur.join(" ").trim() && words(cur.join(" ")) > 150) { parts.push(cur.join("\n")); cur = []; }
    cur.push(line);
    if (words(cur.join(" ")) > maxWords * 1.5 && line.trim() === "") { parts.push(cur.join("\n")); cur = []; }
  }
  if (cur.join("").trim()) parts.push(cur.join("\n"));
  return parts.map((text, i) => ({ n: i + 1, label: `Section ${i + 1}`, text: text.trim() }));
}

// ---------------- Keyword search (BM25) ----------------

const STOP = new Set(("a an and are as at be but by can do does for from has have how i if in into is it its of on or our so that the their then there these this to was we what when where which who why will with you your use using used should must may " +
  "le la les de des du un une et en pour dans que qui est sur au aux avec par ce cette ces comment quoi quel quelle quels quelles je il elle nous vous ils on ne pas plus se sa son ses leur leurs ou mais donc").split(" "));

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed")) return w.slice(0, -2);
  if (w.length > 3 && /[sx]$/.test(w) && !w.endsWith("ss") && !w.endsWith("is") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/** British/American and common clinical synonyms so keyword search meets semantic search halfway. */
const VARIANTS: Record<string, string> = {
  haemorrhage: "hemorrhage", haemoglobin: "hemoglobin", anaemia: "anemia", oedema: "edema", oesophag: "esophag",
  paediatric: "pediatric", gynaecolog: "gynecolog", anaesthe: "anesthe", haemat: "hemat", diarrhoea: "diarrhea",
  foetal: "fetal", caesarean: "cesarean", ischaemi: "ischemi", leukaemi: "leukemi", orthopaed: "orthoped",
};

export function tokenize(str: string): string[] {
  const out: string[] = [];
  const raw = String(str).normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[A-Za-z0-9_]+(?:-[A-Za-z0-9]+)*/g) || [];
  for (const w0 of raw) {
    for (const w of w0.includes("-") ? [w0.replace(/-/g, ""), ...w0.split("-")] : [w0]) {
      let l = w.toLowerCase();
      for (const [uk, us] of Object.entries(VARIANTS)) if (l.startsWith(uk)) { l = us + l.slice(uk.length); break; }
      if ((l.length > 1 || /\d/.test(l)) && !STOP.has(l)) out.push(stem(l));
    }
  }
  return out;
}

export interface Bm25Doc { id: string; text: string }
export interface Bm25Index {
  docs: { id: string; tf: Map<string, number>; len: number }[];
  df: Map<string, number>;
  avg: number;
}

export function buildBm25(docs: Bm25Doc[]): Bm25Index {
  const df = new Map<string, number>(); let total = 0;
  const out = docs.map((d) => {
    const toks = tokenize(d.text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    total += toks.length;
    return { id: d.id, tf, len: toks.length };
  });
  return { docs: out, df, avg: out.length ? total / out.length : 1 };
}

export function searchBm25(ix: Bm25Index, query: string, limit = 20, filter?: (id: string) => boolean): { id: string; score: number }[] {
  const qt = [...new Set(tokenize(query))];
  if (!qt.length || !ix.docs.length) return [];
  const N = ix.docs.length, k1 = 1.2, b = 0.75;
  const res: { id: string; score: number }[] = [];
  for (const d of ix.docs) {
    if (filter && !filter(d.id)) continue;
    let s = 0;
    for (const t of qt) {
      const f = d.tf.get(t); if (!f) continue;
      const n = ix.df.get(t) ?? 0;
      s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / ix.avg));
    }
    if (s > 0) res.push({ id: d.id, score: s });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Reciprocal rank fusion of several ranked id lists. */
export function rrf(lists: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/** A snippet around the best-matching part of a text, for search results. */
export function snippet(text: string, query: string, size = 220): string {
  const qt = new Set(tokenize(query));
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  let best = 0, bestScore = -1;
  sentences.forEach((s, i) => {
    const score = tokenize(s).filter((t) => qt.has(t)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  let out = sentences[best] ?? "";
  for (let i = best + 1; out.length < size && i < sentences.length; i++) out += " " + sentences[i];
  return out.length > size ? out.slice(0, size).replace(/\s+\S*$/, "") + "…" : out;
}

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
