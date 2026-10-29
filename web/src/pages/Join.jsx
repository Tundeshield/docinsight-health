import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../lib/session.jsx";
import { call } from "../lib/api.js";
import { TEAM_ROLES } from "../lib/constants.js";
import AuthSide from "../components/AuthSide.jsx";
import { AuthForm } from "./AuthPage.jsx";

export default function Join() {
  const { orgId, token } = useParams();
  const { user } = useSession();
  const nav = useNavigate();
  const [invite, setInvite] = useState(null); const [err, setErr] = useState("");
  const [name, setName] = useState(""); const [jobTitle, setJobTitle] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) call("getInvite", { orgId, token }).then(setInvite).catch((e) => setErr(e.message)); }, [user, orgId, token]);
  const accept = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await call("acceptInvite", { orgId, token, name, jobTitle }); nav("/app", { replace: true }); }
    catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <div className="auth">
      <AuthSide heading="You've been invited to DocInsight Health." text="Ask questions about your hospital's protocols, equipment and policies, and get answers taken from your own documents." />
      <main className="auth-main">
        {!user ? (
          <div className="auth-card"><p className="sub" style={{ marginBottom: 12 }}>Create an account or sign in to accept the invite.</p><AuthForm initialMode="signup" /></div>
        ) : err && !invite ? (
          <div className="auth-card"><h2>This invite can't be used</h2><p className="error">{err}</p><button className="btn" onClick={() => nav("/app")}>Go to DocInsight</button></div>
        ) : !invite ? <p className="muted">Checking your invite…</p> : (
          <form className="auth-card" onSubmit={accept}>
            <h2>Join {invite.orgName}</h2>
            <p className="sub">You'll join as {TEAM_ROLES[invite.role].toLowerCase()}.</p>
            <div className="field"><label htmlFor="jn">Your name</label><input id="jn" required value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="jt">Your job title</label><input id="jt" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Staff nurse, Ward 4" /></div>
            {err && <p className="error" role="alert">{err}</p>}
            <button className="btn primary" style={{ width: "100%" }} disabled={busy}>{busy ? "Joining…" : `Join ${invite.orgName}`}</button>
          </form>
        )}
      </main>
    </div>
  );
}
