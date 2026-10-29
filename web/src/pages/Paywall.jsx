// Shown when the hospital's plan isn't active. Managers choose a plan; staff are told who to ask.
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase.js";
import { useSession } from "../lib/session.jsx";
import { call } from "../lib/api.js";
import PlanCards from "../components/PlanCards.jsx";

export default function Paywall() {
  const { org, isManager } = useSession();
  const [data, setData] = useState(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  useEffect(() => { if (isManager) call("getBillingOverview", { orgId: org.id }).then(setData).catch((e) => setErr(e.message)); }, [isManager, org.id]);
  const lapsed = ["cancelled", "past_due", "non-renewing", "active"].includes(org.billing?.status);
  const choose = async (plan) => { setBusy(plan); setErr(""); try { const { url } = await call("startCheckout", { orgId: org.id, plan }); if (url.startsWith("/")) window.location.assign(url); else window.location.href = url; } catch (e) { setErr(e.message); setBusy(""); } };
  return (
    <div className="paywall">
      <header className="pw-head">
        <a href="/" className="brand"><span className="cross" aria-hidden="true" />DocInsight Health</a>
        <span className="muted">{auth.currentUser?.email} · <button className="linkbtn" onClick={() => signOut(auth)}>Sign out</button></span>
      </header>
      <main className="pw-main">
        <h1>{lapsed ? `${org.name}'s plan has ended.` : `Choose a plan for ${org.name}.`}</h1>
        {isManager ? <>
          <p className="lede">{lapsed ? "Renew to give your staff access again. Your documents and settings are kept." : "Every plan includes unlimited staff, every document type, scanned-document reading, and answers in English and French."}</p>
          {data?.provider === "dummy" && <p className="notice warn"><span><strong>Test mode.</strong> Checkout doesn't take real payments yet. You'll be able to activate any plan to try the full product.</span></p>}
          {err && <p className="error" role="alert">{err}</p>}
          {data ? <PlanCards plans={data.plans} busy={busy} onChoose={choose} /> : !err && <p className="muted">Loading plans…</p>}
          <p className="muted" style={{ fontSize: 14, marginTop: 18 }}>Running a pilot with Avelon? Ask your Avelon contact to switch on free access for your hospital.</p>
        </> : <p className="lede">Your hospital doesn't have an active DocInsight plan. Ask your library manager or the person who registered your hospital to choose one, then reload this page.</p>}
      </main>
    </div>
  );
}
