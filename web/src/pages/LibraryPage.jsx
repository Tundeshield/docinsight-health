import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase.js";
import { useSession } from "../lib/session.jsx";
import { call } from "../lib/api.js";
import { CATS, catOf, fmtDate, isOverdue } from "../lib/constants.js";
import AddDocuments from "../components/AddDocuments.jsx";

function statusOf(s) {
  switch (s.status) {
    case "ready": return null;
    case "uploading": return { text: "Upload didn't finish. Remove it and add it again.", warn: true };
    case "queued": case "processing": return { text: "Processing…" };
    case "reading_scans": return { text: `Reading scanned pages: ${s.ocrDone || 0} of ${s.scannedPages}`, progress: (s.ocrDone || 0) / Math.max(1, s.scannedPages) };
    case "failed": return { text: s.error || "Couldn't be processed", warn: true };
    default: return { text: s.status };
  }
}

function ArmedButton({ label, armedLabel, onConfirm }) {
  const [armed, setArmed] = useState(false); const [busy, setBusy] = useState(false); const t = useRef();
  useEffect(() => () => clearTimeout(t.current), []);
  return <button className={`btn small${armed ? " armed" : ""}`} disabled={busy} onClick={async () => {
    if (!armed) { setArmed(true); t.current = setTimeout(() => setArmed(false), 4000); return; }
    setBusy(true); try { await onConfirm(); } finally { setBusy(false); setArmed(false); }
  }}>{busy ? "Removing…" : armed ? armedLabel : label}</button>;
}

export default function LibraryPage() {
  const { org, isManager } = useSession();
  const [sources, setSources] = useState(null); const [adding, setAdding] = useState(false); const [notice, setNotice] = useState(null);
  useEffect(() => onSnapshot(query(collection(db, "orgs", org.id, "sources"), orderBy("createdAt", "desc")), (s) => setSources(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setSources([])), [org.id]);
  const remove = async (s) => { try { await call("removeSource", { orgId: org.id, srcId: s.id }); setNotice({ kind: "ok", text: `Removed “${s.title}”.` }); } catch (e) { setNotice({ kind: "warn", text: e.message }); } };
  const resume = async (s) => { try { const r = await call("resumeSource", { orgId: org.id, srcId: s.id }); setNotice({ kind: "ok", text: r.resumed === false ? "It's still working. Check back in a few minutes." : `Restarted “${s.title}”.` }); } catch (e) { setNotice({ kind: "warn", text: e.message }); } };
  const ready = (sources || []).filter((s) => s.status === "ready");
  const stuck = (s) => ["reading_scans", "queued", "processing"].includes(s.status) && Date.now() - (s.updatedAt?.toMillis?.() || Date.now()) > 20 * 60000;
  return (
    <div className="page"><div className="page-inner">
      <div className="toolbar">
        <div><h2 className="title">Library</h2><p className="lede" style={{ margin: 0 }}>{sources == null ? "Loading…" : `${ready.length} document${ready.length === 1 ? "" : "s"} ready to answer questions.`}</p></div>
        {isManager && <button className="btn primary" onClick={() => setAdding(true)}>Add document</button>}
      </div>
      {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span><button className="btn ghost small" onClick={() => setNotice(null)}>Dismiss</button></div>}
      {sources && sources.length === 0 && <div className="list" style={{ padding: 22 }}><p style={{ margin: 0 }} className="muted">{isManager ? "No documents yet. Add protocols, SOPs, equipment manuals, policies or system guides. Scanned copies and phone photos work too." : "No documents yet. Your library managers add them."}</p></div>}
      {sources && sources.length > 0 && <div className="list">
        {Object.keys(CATS).map((cat) => { const items = sources.filter((s) => catOf(s) === cat); if (!items.length) return null; return (
          <div className={`list-group cat-${cat}`} key={cat}>
            <h3><span className="swatch" />{CATS[cat].label}</h3>
            {items.map((s) => { const st = statusOf(s); const meta = [s.area, s.version, s.status === "ready" && `${s.sections} sections`, s.scannedRead ? `${s.scannedRead} scanned pages read` : null].filter(Boolean).join(", ");
              return (<div className="row" key={s.id}>
                <div className="main">
                  <div className="title">{s.title} {s.status === "ready" && isOverdue(s.reviewDate) && <span className="pill warn">Review overdue</span>}</div>
                  <div className="meta">{meta}{s.reviewDate && !isOverdue(s.reviewDate) ? `. Next review ${fmtDate(s.reviewDate)}` : ""}</div>
                  {st && <div className="meta" style={st.warn ? { color: "var(--warn)", fontWeight: 700 } : null}>{st.text}</div>}
                  {st?.progress != null && <div className="bar" style={{ maxWidth: 320 }}><span style={{ width: `${Math.max(3, st.progress * 100)}%` }} /></div>}
                  {s.status === "ready" && s.note && <div className="meta" style={{ color: "var(--warn)" }}>{s.note}.</div>}
                </div>
                {isManager && <div className="actions">
                  {stuck(s) && <button className="btn small" onClick={() => resume(s)}>Restart</button>}
                  <ArmedButton label="Remove" armedLabel="Confirm" onConfirm={() => remove(s)} />
                </div>}
              </div>); })}
          </div>); })}
      </div>}
      {adding && <AddDocuments orgId={org.id} onClose={() => setAdding(false)} onAdded={(t) => setNotice({ kind: "ok", text: `Uploaded “${t}”. It's being processed and will be ready to answer questions shortly.` })} />}
    </div></div>
  );
}
