import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { useSession } from "../lib/session.jsx";
import { askStream } from "../lib/api.js";
import { ROLES } from "../lib/constants.js";
import AnswerView from "../components/AnswerView.jsx";
import PassageDrawer from "../components/PassageDrawer.jsx";

const PII_RE = /\b(mrn|hospital\s*(no|number)|patient\s*(id|number|name)|numéro\s*(de\s*)?(dossier|patient)|dob|date of birth)\b|\b\d{6,}\b|\b(mr|mrs|ms|miss|mme|mlle|madame|monsieur)\.?\s+\p{Lu}\p{Ll}+/iu;
const HINT = "Answers come only from your hospital's documents, with every point linked to its source. Don't enter patient names or record numbers.";
const STARTERS = ["What topics do our documents cover?", "Which documents are past their review date?", "Summarise the newest document for a new member of staff"];

export default function AskPage() {
  const { org, isManager } = useSession();
  const [turns, setTurns] = useState([]); // {q, status, trail, text, final, citations, meta, error}
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  const [role, setRole] = useState(() => { try { return localStorage.getItem("dih-role") || "nurse or midwife"; } catch { return "nurse or midwife"; } });
  const [hint, setHint] = useState({ text: HINT, warn: false }); const [piiAck, setPiiAck] = useState("");
  const [ready, setReady] = useState(null); const [drawer, setDrawer] = useState(null);
  const ctl = useRef(null); const thread = useRef(null); const ta = useRef(null);

  useEffect(() => onSnapshot(query(collection(db, "orgs", org.id, "sources"), where("status", "==", "ready")), (s) => setReady(s.size), () => setReady(0)), [org.id]);
  useEffect(() => { try { localStorage.setItem("dih-role", role); } catch {} }, [role]);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [turns]);
  const patch = (i, f) => setTurns((t) => t.map((x, j) => (j === i ? { ...x, ...(typeof f === "function" ? f(x) : f) } : x)));

  const ask = async (text) => {
    const question = (text ?? q).trim(); if (!question || busy) return;
    if (PII_RE.test(question) && piiAck !== question) { setPiiAck(question); setHint({ text: "This looks like it may include patient details. Remove names and record numbers, or press Ask again to send it as it is.", warn: true }); return; }
    setHint({ text: HINT, warn: false }); setQ(""); setBusy(true);
    const history = turns.filter((t) => t.final).slice(-3).flatMap((t) => [{ role: "user", content: `Question: ${t.q}` }, { role: "assistant", content: t.text }]);
    const i = turns.length;
    setTurns((t) => [...t, { q: question, status: "Searching your documents…", trail: [], text: "", final: false }]);
    ctl.current = new AbortController();
    try {
      await askStream({ orgId: org.id, question, role, history, signal: ctl.current.signal }, {
        onStatus: (s) => patch(i, (x) => ({ status: s, trail: [...x.trail, s] })),
        onDelta: (d) => patch(i, (x) => ({ text: x.text + d, status: null })),
        onReset: () => patch(i, { text: "" }),
        onDone: (d) => patch(i, { text: d.answer, citations: d.citations, final: true, status: null, meta: { dropped: d.dropped, truncated: d.truncated } })
      });
    } catch (e) {
      patch(i, { status: null, error: e.name === "AbortError" ? "Stopped." : e.message });
    }
    setBusy(false); ctl.current = null;
  };

  return (
    <div className="ask">
      <div className="thread" ref={thread}><div className="thread-inner">
        {!turns.length && (
          <div className="empty">
            {ready === 0 ? <>
              <h2>{isManager ? "Add your first documents." : "Your library is empty."}</h2>
              <p>{isManager ? "Upload protocols, SOPs, equipment manuals, policies or system guides. Scanned copies and phone photos of pages work too." : "Your library managers haven't added documents yet. Ask them to add your hospital's protocols and manuals."}</p>
              {isManager && <Link className="btn primary" to="/app/library">Add documents</Link>}
            </> : <>
              <h2>What do you need to know?</h2>
              <p>Ask the way you'd ask an experienced colleague. You get the steps from your own documents, with each point linked to the exact section.</p>
              <div className="chips">{STARTERS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
            </>}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i}>
            <h2 className="q">{t.q}</h2>
            {t.status && <div className="status"><span className="pulse" /><span>{t.status}</span></div>}
            {!t.final && t.trail.length > 0 && !t.text && <div className="trail">{t.trail.slice(-4).map((x, k) => <div key={k}>{x}</div>)}</div>}
            {t.text && <AnswerView text={t.text} citations={t.citations} final={t.final} meta={t.meta} onOpen={(id) => setDrawer(t.citations[id])} />}
            {t.error && <p className="error">{t.error}</p>}
          </div>
        ))}
      </div></div>
      <div className="composer">
        <div className="composer-top">
          <label htmlFor="role">I'm a</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {turns.length > 0 && !busy && <button className="btn ghost small" style={{ marginLeft: "auto" }} onClick={() => setTurns([])}>New chat</button>}
        </div>
        <div className="composer-inner">
          <textarea ref={ta} rows={1} value={q} placeholder="Ask about a protocol, a machine, a policy…" aria-label="Your question"
            onChange={(e) => { setQ(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px"; if (hint.warn && e.target.value.trim() !== piiAck) setHint({ text: HINT, warn: false }); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} />
          {busy ? <button className="btn" onClick={() => ctl.current?.abort()}>Stop</button> : <button className="btn primary" onClick={() => ask()} disabled={ready === 0}>Ask</button>}
        </div>
        <p className={`hint${hint.warn ? " warn" : ""}`}>{hint.text}</p>
      </div>
      {drawer && <PassageDrawer orgId={org.id} initial={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
