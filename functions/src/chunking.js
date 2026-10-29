// Splits documents into sections that keep their heading path, so answers can cite exact passages.
import { parse } from "node-html-parser";

const MAX_CHUNK = 1500, TARGET = 1100;

export function splitBody(body) {
  if (body.length <= MAX_CHUNK) return [body];
  const paras = body.split(/\n\s*\n/); const out = []; let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > TARGET && cur) { out.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
    while (cur.length > MAX_CHUNK * 1.6) { out.push(cur.slice(0, MAX_CHUNK)); cur = cur.slice(MAX_CHUNK); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function chunkMarkdown(text, docTitle) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const stack = []; const sections = []; let buf = []; let inFence = false;
  const flush = () => {
    const body = buf.join("\n").trim(); buf = [];
    if (!body) return;
    const path = stack.filter(Boolean).join(" › ") || docTitle || "Introduction";
    for (const part of splitBody(body)) sections.push({ path, text: part });
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) { flush(); const lvl = m[1].length; stack.length = lvl - 1; stack[lvl - 1] = m[2].trim(); }
    else buf.push(line);
  }
  flush();
  return sections;
}

export function htmlToMarkdown(html) {
  const root0 = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  root0.querySelectorAll("nav,footer,header,aside,svg,iframe,form,button").forEach(n => n.remove());
  const root = root0.querySelector("main") || root0.querySelector("article") || root0.querySelector("body") || root0;
  const out = [];
  const text = n => n.text.replace(/\s+/g, " ").trim();
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.text.replace(/\s+/g, " ")); return; }
    if (n.nodeType !== 1) return;
    const t = (n.tagName || "").toUpperCase();
    if (/^H[1-6]$/.test(t)) { out.push("\n\n" + "#".repeat(+t[1]) + " " + text(n) + "\n\n"); return; }
    if (t === "PRE") { out.push("\n\n```\n" + n.text.replace(/\n+$/, "") + "\n```\n\n"); return; }
    if (t === "BR") { out.push("\n"); return; }
    if (t === "LI") { out.push("\n- "); n.childNodes.forEach(walk); out.push("\n"); return; }
    if (t === "TR") { out.push("\n| " + n.querySelectorAll("th,td").map(text).join(" | ") + " |\n"); return; }
    const block = /^(P|DIV|SECTION|ARTICLE|UL|OL|TABLE|BLOCKQUOTE|DL|DT|DD|FIGURE)$/.test(t);
    if (block) out.push("\n\n"); n.childNodes.forEach(walk); if (block) out.push("\n\n");
  };
  walk(root);
  const title = (root0.querySelector("title")?.text || root0.querySelector("h1")?.text || "").trim();
  return { md: out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), title };
}

export function isPdfHeading(l, title) {
  if (l.length < 4 || l.length > 90) return false;
  if ((l.match(/\p{L}/gu) || []).length < 4) return false;
  if (/^(page|rev(ision)?|date|effective|printed|copyright|©|figure|fig\.|table|tableau)\b/i.test(l)) return false;
  if (/^(warning|warnings|caution|cautions|note|notes|attention|avertissement|continued|suite|this page intentionally left blank|intentionally left blank|blank page|end)\b/i.test(l)) return false;
  if (/\b(page|pg\.?)\s*\d+\s*(of|sur|\/)?\s*\d*$/i.test(l) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l)) return false;
  if (title && l.toLowerCase() === title.toLowerCase()) return false;
  if (/^(chapter|chapitre|section|part|partie|ata|annex|annexe|appendix)\s+[\dA-Z]+/i.test(l)) return true;
  if (/^\d+(\.\d+){0,3}\.?\s+\p{Lu}\p{L}/u.test(l) && !/[.:;]$/.test(l)) return true;
  return l === l.toUpperCase() && /\p{Lu}{3}/u.test(l) && !/[.;]$/.test(l);
}

/** Turns per-page text (from PDF extraction or OCR) into sections, carrying chapter headings across pages. */
export function pagesToSections(pages, title) {
  let lastHead = ""; const out = [];
  for (const p of pages) {
    const body = (p.text || "").trim();
    if (!body || /^\[blank page\]$/i.test(body)) continue;
    const lines = body.split("\n").slice(0, 12).map(l => l.trim());
    const md = lines.find(l => /^#{1,4}\s+\S/.test(l));
    const head = md ? md.replace(/^#+\s+/, "") : lines.map(l => l.replace(/[*_#]/g, "").trim()).find(l => isPdfHeading(l, title));
    if (head) lastHead = head.replace(/[*_]/g, "").replace(/\s+/g, " ").slice(0, 90);
    const path = (lastHead ? `${lastHead}, page ${p.n}` : `Page ${p.n}`) + (p.ocr ? " (scanned)" : "");
    for (const part of splitBody(body)) out.push({ path, text: part, ocr: !!p.ocr, page: p.n });
  }
  return out;
}
