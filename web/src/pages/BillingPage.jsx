import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../lib/session.jsx";
import { call } from "../lib/api.js";
import PlanCards from "../components/PlanCards.jsx";

const STATUS = { active: "Active", "non-renewing": "Cancelled. Access continues until the end of the period", past_due: "Payment failed. Update your payment to keep access", cancelled: "Cancelled", none: "No plan yet" };
const day = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default function BillingPage() {
  const { org } = useSession();
  const [data, setData] = useState(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(""); const [armed, setArmed] = useState(false);
  const [params] = useSearchParams();
  const load = () => call("getBillingOverview", { orgId: org.id }).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [org.id, org.plan, org.billing?.status]);
  const go = (url) => (url.startsWith("/") ? window.location.assign(url) : (window.location.href = url));
  const checkout = async (plan) => { setBusy(plan); setErr(""); try { go((await call("startCheckout", { orgId: org.id, plan })).url); } catch (e) { setErr(e.message); setBusy(""); } };
  const manage = async () => {
    setErr("");
    if (data.billing.subscriptionCode) { setBusy("manage"); try { go((await call("manageSubscription", { orgId: org.id })).url); } catch (e) { setErr(e.message); setBusy(""); } return; }
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
    setBusy("manage"); try { await call("cancelDummySubscription", { orgId: org.id }); } catch (e) { setErr(e.message); } setBusy(""); setArmed(false);
  };
  if (!data) return <div className="page"><div className="page-inner">{err ? <p className="error">{err}</p> : <p className="muted">Loading…</p>}</div></div>;
  const u = data.usage, l = data.limits || {}, b = data.billing;
  const canCancel = b.status === "active";
  const manageBtn = b.subscriptionCode
    ? <button className="btn" onClick={manage} disabled={!!busy}>{busy === "manage" ? "Opening…" : "Manage payment"}</button>
    : canCancel ? <button className={`btn${armed ? " armed" : ""}`} onClick={manage} disabled={!!busy}>{busy === "manage" ? "Cancelling…" : armed ? "Confirm cancel" : "Cancel plan"}</button>
    : <span className="pill">Current plan</span>;
  return (
    <div className="page"><div className="page-inner">
      <h2 className="title">{data.billingActive ? "Billing" : "Plan & usage"}</h2>
      {!data.billingActive ? (
        <p className="lede">{org.name} has free access as a pilot hospital. Fair-use limits below keep the service fast for everyone; contact Avelon if you need more.</p>
      ) : (
        <p className="lede">Current plan: <strong>{org.plan}</strong>. {STATUS[b.status] || b.status}{b.currentPeriodEnd ? `${b.status === "active" ? ". Renews" : ""} ${b.status === "active" ? "on" : "on"} ${day(b.currentPeriodEnd)}` : ""}.</p>
      )}
      {data.billingActive && data.provider === "dummy" && <p className="notice warn"><span><strong>Test mode.</strong> Payments are simulated until a payment provider is connected.</span></p>}
      {params.get("paid") && <div className="notice ok"><span>Thanks. Your payment is being confirmed and your plan will update in a moment.</span></div>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="stat">
        <div><strong>{u.questions.toLocaleString()}</strong>questions this month{l.questions != null ? ` of ${l.questions.toLocaleString()}` : ""}</div>
        <div><strong>{u.ocrPages.toLocaleString()}</strong>scanned pages read{l.ocrPages != null ? ` of ${l.ocrPages.toLocaleString()}` : ""}</div>
      </div>
      {data.billingActive && data.plans && <PlanCards plans={data.plans} current={data.paid ? data.plan : null} busy={busy} onChoose={checkout} onManage={manageBtn} />}
    </div></div>
  );
}
