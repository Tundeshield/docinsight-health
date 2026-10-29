// Renders an answer with numbered references beside each paragraph.
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { CATS, catOf, fmtDate } from "../lib/constants.js";

const CITE_RE = /\[((?:s[a-z0-9]{8}\.\d+)(?:\s*[,;]\s*s[a-z0-9]{8}\.\d+)*)\]/g;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** citations: id → passage view from the server (absent while streaming). */
export function buildBlocks(md, citations) {
  const order = [];
  const withSups = md.replace(CITE_RE, (_, ids) => ids.split(/\s*[,;]\s*/).map((id) => {
    if (citations && !citations[id]) return "";
    if (!order.includes(id)) order.push(id);
    const cat = citations ? catOf(citations[id].source) : "protocol";
    return `<sup class="c cat-${cat}" data-id="${id}">${order.indexOf(id) + 1}</sup>`;
  }).join(""));
  const html = DOMPurify.sanitize(marked.parse(withSups), { ADD_ATTR: ["data-id"] });
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const blocks = []; let pending = "";
  for (const el of [...tmp.children]) {
    const ids = [...new Set([...el.querySelectorAll("sup.c")].map((s) => s.dataset.id))];
    if (/^H[1-6]$/.test(el.tagName) && !ids.length) { pending += el.outerHTML; continue; }
    blocks.push({ html: pending + el.outerHTML, ids }); pending = "";
  }
  if (pending) blocks.push({ html: pending, ids: [] });
  return { blocks, order };
}

export default function AnswerView({ text, citations, final, onOpen, meta }) {
  const { blocks, order } = useMemo(() => buildBlocks(text, final ? citations : null), [text, citations, final]);
  const clickBody = (e) => { const id = e.target.closest?.("sup.c")?.dataset.id; if (id && final) onOpen(id); };
  const cited = final ? order.map((id) => citations[id]).filter(Boolean) : [];
  const sources = [...new Map(cited.map((c) => [c.source.id, c.source])).values()];
  const cats = [...new Set(sources.map(catOf))];
  const overdue = sources.filter((s) => s.overdue);
  const scanned = cited.filter((c) => c.ocr).length;
  return (
    <div className="answer">
      {blocks.map((b, i) => (
        <div className="arow" key={i}>
          <div className="ablock" onClick={clickBody} dangerouslySetInnerHTML={{ __html: b.html }} />
          <div className="notes">
            {final && b.ids.map((id) => { const c = citations[id]; if (!c) return null; const tail = c.path.split(" › ").slice(-1)[0];
              return <button key={id} className={`note cat-${catOf(c.source)}`} onClick={() => onOpen(id)}><span className="n">{order.indexOf(id) + 1}</span><span><span className="t">{c.source.title}</span><span className="p">{tail === c.source.title ? c.source.area || CATS[catOf(c.source)].one : tail}</span></span></button>; })}
          </div>
        </div>
      ))}
      {final && <>
        <div className="answer-foot">
          {cited.length ? <><span>{cited.length} source section{cited.length > 1 ? "s" : ""}</span><span className="legend">{cats.map((c) => <span key={c} className={`cat-${c}`}><span className="swatch" />{CATS[c].label}</span>)}</span></> : <span>No sections cited. Treat this answer with caution.</span>}
        </div>
        {overdue.length > 0 && <p className="warnline">{overdue.length === 1 ? `“${overdue[0].title}” is past its review date (${fmtDate(overdue[0].reviewDate)}). Check it's still current before relying on it.` : `${overdue.length} cited documents are past their review date. Check they're still current before relying on them.`}</p>}
        {scanned > 0 && <p className="warnline">{scanned === cited.length ? "This answer comes" : "Part of this answer comes"} from scanned pages read by machine. Check doses, numbers and steps against the original page before acting.</p>}
        {meta?.dropped > 0 && <p className="warnline">{meta.dropped} reference{meta.dropped > 1 ? "s" : ""} pointed to a section that doesn't exist and {meta.dropped > 1 ? "were" : "was"} removed.</p>}
        {meta?.truncated && <p className="warnline">This answer was cut short. Ask about one part at a time.</p>}
        <p className="caution">A reference aid, not clinical advice. Check the cited section before acting; professional judgement and local escalation always apply.</p>
      </>}
    </div>
  );
}
export { esc };
