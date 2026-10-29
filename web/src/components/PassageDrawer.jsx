import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase.js";
import { call } from "../lib/api.js";
import { CATS, catOf, fmtDate } from "../lib/constants.js";

export default function PassageDrawer({ orgId, initial, onClose }) {
  const [p, setP] = useState(initial); const [nav, setNav] = useState({ prev: null, next: null }); const [err, setErr] = useState("");
  const [origUrl, setOrigUrl] = useState(null);
  const load = async (id) => { setErr(""); try { const r = await call("getPassage", { orgId, id }); setP(r.passage); setNav({ prev: r.prev, next: r.next }); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(initial.id); }, [initial.id]);
  useEffect(() => {
    setOrigUrl(null);
    const f = p.source.fileNames?.[0]; if (!f || p.source.kind === "photos") return;
    getDownloadURL(ref(storage, `orgs/${orgId}/uploads/${p.source.id}/${f}`)).then(setOrigUrl).catch(() => {});
  }, [p.source.id]);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const s = p.source; const cat = catOf(s);
  const pageLink = origUrl && p.page ? `${origUrl}#page=${p.page}` : origUrl;
  return (<>
    <div className="scrim" onClick={onClose} />
    <aside className={`drawer cat-${cat}`} aria-label="Source section">
      <div className="drawer-head">
        <div className="kind">{CATS[cat].one}{s.area ? `, ${s.area}` : ""}</div>
        <h4>{s.title}</h4>
        <div className="crumb">{p.path}</div>
        <div className="meta">{[s.version, s.reviewDate && (s.overdue ? null : `Next review ${fmtDate(s.reviewDate)}`)].filter(Boolean).join(". ")}{s.overdue && <span className="pill warn">Review was due {fmtDate(s.reviewDate)}</span>}</div>
      </div>
      <div className="drawer-body">
        {p.ocr && <p className="pill warn" style={{ marginTop: 0 }}>Transcribed from a scanned page. Check numbers against the original.</p>}
        {err && <p className="error">{err}</p>}
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(p.text)) }} />
      </div>
      <div className="drawer-foot">
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" disabled={!nav.prev} onClick={() => load(nav.prev)}>Previous section</button>
          <button className="btn" disabled={!nav.next} onClick={() => load(nav.next)}>Next section</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {pageLink && <a className="btn" href={pageLink} target="_blank" rel="noopener">{p.page ? `Open original, page ${p.page}` : "Open original"}</a>}
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </aside>
  </>);
}
