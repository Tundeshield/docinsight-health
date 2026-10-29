import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";
import { useSession } from "../lib/session.jsx";
import { call } from "../lib/api.js";
import { TEAM_ROLES } from "../lib/constants.js";

export default function TeamPage() {
  const { org, member, user } = useSession();
  const [members, setMembers] = useState([]); const [invite, setInvite] = useState(null);
  const [role, setRole] = useState("staff"); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [copied, setCopied] = useState(false);
  const isOwner = member.role === "owner";
  useEffect(() => onSnapshot(collection(db, "orgs", org.id, "members"), (s) => setMembers(s.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => ["owner", "manager", "staff"].indexOf(a.role) - ["owner", "manager", "staff"].indexOf(b.role) || (a.name || a.email).localeCompare(b.name || b.email)))), [org.id]);
  const makeLink = async () => { setBusy(true); setMsg(null); setCopied(false); try { setInvite(await call("createInvite", { orgId: org.id, role })); } catch (e) { setMsg({ kind: "warn", text: e.message }); } setBusy(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(invite.link); setCopied(true); } catch { setMsg({ kind: "warn", text: "Couldn't copy automatically. Select the link and copy it." }); } };
  const waText = invite ? encodeURIComponent(`You're invited to ${org.name} on DocInsight Health, where you can ask questions about our protocols, equipment manuals and policies. Join here: ${invite.link}`) : "";
  const act = async (fn, data, done) => { try { await call(fn, { orgId: org.id, ...data }); setMsg({ kind: "ok", text: done }); } catch (e) { setMsg({ kind: "warn", text: e.message }); } };
  return (
    <div className="page"><div className="page-inner">
      <h2 className="title">Team</h2>
      <p className="lede">Staff can ask questions. Library managers can also add and remove documents and invite people. Only the owner can make someone a library manager.</p>
      {msg && <div className={`notice ${msg.kind}`} role="status"><span>{msg.text}</span><button className="btn ghost small" onClick={() => setMsg(null)}>Dismiss</button></div>}
      <div className="invite">
        <strong>Invite people with a link</strong>
        <p className="muted" style={{ margin: "4px 0 10px", fontSize: 15 }}>Share it in your ward or department WhatsApp group. Anyone with the link can join for 14 days.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor="irole" className="muted">Join as</label>
          <select id="irole" value={role} onChange={(e) => { setRole(e.target.value); setInvite(null); }} style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: "6px 8px", background: "var(--page)" }}>
            <option value="staff">Staff</option>{isOwner && <option value="manager">Library manager</option>}
          </select>
          <button className="btn primary small" onClick={makeLink} disabled={busy}>{busy ? "Creating…" : "Create invite link"}</button>
        </div>
        {invite && <div className="link">
          <input readOnly value={invite.link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button className="btn small" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
          <a className="btn small" href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener">Share on WhatsApp</a>
        </div>}
      </div>
      <div className="list">
        {members.map((m) => (
          <div className="row" key={m.uid}>
            <div className="main"><div className="title">{m.name || m.email}{m.uid === user.uid ? " (you)" : ""}</div><div className="meta">{[m.jobTitle, m.email, TEAM_ROLES[m.role]].filter(Boolean).join(", ")}</div></div>
            {m.role !== "owner" && m.uid !== user.uid && <div className="actions">
              {isOwner && <button className="btn small" onClick={() => act("setMemberRole", { memberUid: m.uid, role: m.role === "manager" ? "staff" : "manager" }, m.role === "manager" ? `${m.name || m.email} is now staff.` : `${m.name || m.email} is now a library manager.`)}>{m.role === "manager" ? "Make staff" : "Make library manager"}</button>}
              {(isOwner || m.role === "staff") && <button className="btn small" onClick={() => act("removeMember", { memberUid: m.uid }, `Removed ${m.name || m.email}.`)}>Remove</button>}
            </div>}
          </div>
        ))}
      </div>
    </div></div>
  );
}
