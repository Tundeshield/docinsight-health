// Test checkout, used until a payment provider is chosen. No payment details are collected.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { call } from "../lib/api.js";

export default function Checkout() {
  const { checkoutId } = useParams(); const nav = useNavigate();
  const [c, setC] = useState(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(""); const [failed, setFailed] = useState(false);
  useEffect(() => { call("getDummyCheckout", { checkoutId }).then(setC).catch((e) => setErr(e.message)); }, [checkoutId]);
  const finish = async (outcome) => {
    setBusy(outcome); setErr("");
    try { await call("completeDummyCheckout", { checkoutId, outcome }); if (outcome === "success") nav("/app?welcome=1", { replace: true }); else { setFailed(true); setBusy(""); } }
    catch (e) { setErr(e.message); setBusy(""); }
  };
  return (
    <div className="paywall">
      <header className="pw-head"><a href="/" className="brand"><span className="cross" aria-hidden="true" />DocInsight Health</a></header>
      <main className="pw-main" style={{ maxWidth: 520 }}>
        <div className="checkout">
          <span className="pill warn">Test checkout</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 6px" }}>{c ? `${c.planName} plan` : "Checkout"}</h1>
          {c && <p className="lede" style={{ margin: "0 0 18px" }}>{c.priceLabel} for {c.orgName}</p>}
          <p className="muted">DocInsight isn't connected to a payment provider yet, so no money is taken and no card details are needed. Choose an outcome to see how the product behaves.</p>
          {failed && <p className="notice warn"><span>The test payment failed, so the plan wasn't activated. Go back to plans to try again.</span></p>}
          {err && <p className="error" role="alert">{err}</p>}
          {c && c.status === "open" && !c.expired && !failed && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <button className="btn primary" onClick={() => finish("success")} disabled={!!busy}>{busy === "success" ? "Activating…" : "Simulate successful payment"}</button>
            <button className="btn" onClick={() => finish("fail")} disabled={!!busy}>Simulate failed payment</button>
          </div>}
          {c && (c.status !== "open" || c.expired) && !failed && <p className="error">This checkout has {c.expired ? "expired" : "already been used"}.</p>}
          <p style={{ marginTop: 22 }}><button className="linkbtn" onClick={() => nav("/app")}>Back to plans</button></p>
        </div>
      </main>
    </div>
  );
}
