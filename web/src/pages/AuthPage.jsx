import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase.js";
import AuthSide from "../components/AuthSide.jsx";


const AUTH_ERR = {
  "auth/invalid-credential": "That email and password don't match. Check them, or reset your password.",
  "auth/email-already-in-use": "There's already an account with this email. Sign in instead.",
  "auth/weak-password": "Use a password of at least 8 characters.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes, then try again.",
  "auth/network-request-failed": "No connection. Check your internet and try again."
};

export function AuthForm({ initialMode = "signin", onDone }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [info, setInfo] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setInfo(""); setBusy(true);
    try {
      if (mode === "reset") { await sendPasswordResetEmail(auth, email); setInfo("Check your email for a link to reset your password."); }
      else if (mode === "signup") { if (pw.length < 8) throw { code: "auth/weak-password" }; await createUserWithEmailAndPassword(auth, email, pw); onDone?.(); }
      else { await signInWithEmailAndPassword(auth, email, pw); onDone?.(); }
    } catch (e2) { setErr(AUTH_ERR[e2.code] || "Couldn't sign in. Try again."); }
    setBusy(false);
  };
  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>{mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in"}</h2>
      <p className="sub">{mode === "signup" ? "Use your work email. You'll register your hospital or join your team next." : mode === "reset" ? "We'll email you a link to choose a new password." : "Welcome back."}</p>
      <div className="field"><label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {mode !== "reset" && <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required value={pw} onChange={(e) => setPw(e.target.value)} />{mode === "signup" && <small>At least 8 characters.</small>}</div>}
      {err && <p className="error" role="alert">{err}</p>}
      {info && <p className="notice ok" role="status">{info}</p>}
      <button className="btn primary" style={{ width: "100%" }} disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
      <p className="switch">
        {mode === "signin" && <>New here? <button type="button" className="linkbtn" onClick={() => setMode("signup")}>Create an account</button> <br /><button type="button" className="linkbtn" onClick={() => setMode("reset")}>Forgot your password?</button></>}
        {mode !== "signin" && <>Already have an account? <button type="button" className="linkbtn" onClick={() => setMode("signin")}>Sign in</button></>}
      </p>
    </form>
  );
}

export default function AuthPage({ mode = "signin" }) {
  return (
    <div className="auth">
      <AuthSide heading="Your hospital's documents, answered in seconds." text="Protocols, equipment manuals, policies and system guides in one place. Staff ask in plain English or French and get the steps from your own documents, with every point linked to its source." />
      <main className="auth-main"><AuthForm key={mode} initialMode={mode} /></main>
    </div>
  );
}
