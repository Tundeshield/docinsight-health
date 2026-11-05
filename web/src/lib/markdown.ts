import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

export function mdToHtml(md: string): string {
  return DOMPurify.sanitize(marked.parse(md ?? "", { async: false }) as string, { USE_PROFILES: { html: true } });
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}%.,'"/-]+/gu, " ");

/**
 * Highlights the cited passage inside rendered text. The quote may differ slightly from the
 * page (markdown, line breaks), so it matches on normalised text and tries shorter openings.
 * Returns the first highlighted element, or null.
 */
export function highlightQuote(root: HTMLElement, quote: string): HTMLElement | null {
  if (!quote.trim()) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = "";
  const map: { node: Text; offset: number }[] = []; // map[i] = position in original nodes for normalised char i
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    nodes.push(t);
    const src = t.data;
    for (let i = 0; i < src.length; i++) {
      const c = norm(src[i]);
      // collapse runs of spaces
      if (c === " " && full.endsWith(" ")) continue;
      full += c;
      map.push({ node: t, offset: i });
    }
    if (!full.endsWith(" ")) { full += " "; map.push({ node: t, offset: src.length }); }
  }
  const q = norm(quote).replace(/\s+/g, " ").trim();
  const tries = [q, q.slice(0, 160), q.slice(0, 80), q.slice(0, 40)].map((x) => x.trim()).filter((x) => x.length >= 12);
  let start = -1, len = 0;
  for (const t of tries) { const i = full.indexOf(t); if (i >= 0) { start = i; len = t.length; break; } }
  if (start < 0) return null;
  const end = Math.min(start + len, map.length - 1);
  // Wrap each text node segment in the range
  let first: HTMLElement | null = null;
  const segs = new Map<Text, [number, number]>();
  for (let i = start; i < end; i++) {
    const { node, offset } = map[i];
    const cur = segs.get(node);
    segs.set(node, cur ? [cur[0], Math.max(cur[1], offset + 1)] : [offset, offset + 1]);
  }
  for (const [node, [a, b]] of segs) {
    if (b <= a || !node.parentNode) continue;
    const r = document.createRange();
    r.setStart(node, a); r.setEnd(node, Math.min(b, node.data.length));
    const mark = document.createElement("mark");
    try { r.surroundContents(mark); if (!first) first = mark; } catch { /* partial overlap: skip */ }
  }
  return first;
}
