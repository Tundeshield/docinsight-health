import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase.js";
import { call } from "../lib/api.js";
import { ORG_TYPES } from "../lib/constants.js";
import AuthSide from "../components/AuthSide.jsx";

export default function Onboarding() {
  const [f, setF] = useState({ name: "", type: "private_hospital", city: "Lagos", phone: "", yourName: "", jobTitle: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await call("createOrganization", f); } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <div className="auth">
      <AuthSide heading="Register your hospital." text="You'll be the owner. Next, add your documents and invite your team with a link you can share on WhatsApp. Early hospitals use DocInsight free during the pilot." />
      <main className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <h2>About your organisation</h2>
          <p className="sub">If your hospital already uses DocInsight, ask a library manager for an invite link instead.</p>
          <div className="field"><label htmlFor="name">Organisation name</label><input id="name" required value={f.name} onChange={set("name")} placeholder="e.g. Riverside Specialist Hospital" /></div>
          <div className="two">
            <div className="field"><label htmlFor="type">Type</label><select id="type" value={f.type} onChange={set("type")}>{ORG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="field"><label htmlFor="city">City</label><input id="city" value={f.city} onChange={set("city")} /></div>
          </div>
          <div className="two">
            <div className="field"><label htmlFor="yourName">Your name</label><input id="yourName" required value={f.yourName} onChange={set("yourName")} /></div>
            <div className="field"><label htmlFor="jobTitle">Your job title</label><input id="jobTitle" value={f.jobTitle} onChange={set("jobTitle")} placeholder="e.g. Head of Nursing" /></div>
          </div>
          <div className="field"><label htmlFor="phone">Phone number</label><input id="phone" type="tel" value={f.phone} onChange={set("phone")} placeholder="+234" /><small>So Avelon can help you set up. We don't share it.</small></div>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn primary" style={{ width: "100%" }} disabled={busy}>{busy ? "Registering…" : "Register organisation"}</button>
          <p className="switch">Signed in as {auth.currentUser?.email}. <button type="button" className="linkbtn" onClick={() => signOut(auth)}>Use another account</button></p>
        </form>
      </main>
    </div>
  );
}
