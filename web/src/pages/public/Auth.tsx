import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  createUserWithEmailAndPassword, isSignInWithEmailLink, RecaptchaVerifier, sendEmailVerification, sendPasswordResetEmail,
  sendSignInLinkToEmail, signInWithEmailAndPassword, signInWithEmailLink, signInWithPhoneNumber, updateProfile, type ConfirmationResult,
} from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/AppShell";
import { Banner, Button, ErrorText, Tabs, TextField } from "../../components/ui";

const LS_EMAIL = "di.linkEmail";
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/app");

export function authMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "That email and password don't match. Check them, or use a sign-in link instead.",
    "auth/wrong-password": "That email and password don't match.",
    "auth/user-not-found": "There's no account with that email. Create one first.",
    "auth/email-already-in-use": "There's already an account with this email. Sign in instead.",
    "auth/weak-password": "Use at least 8 characters for your password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your internet and try again.",
    "auth/invalid-phone-number": "Enter your phone number with the country code, like +234 803 000 0000.",
    "auth/invalid-verification-code": "That code isn't right. Check the SMS and try again.",
    "auth/code-expired": "That code has expired. Send a new one.",
    "auth/operation-not-allowed": "This sign-in method isn't switched on yet. Use email and password.",
    "auth/invalid-action-code": "This sign-in link has expired or was already used. Send a new one.",
    "auth/multi-factor-auth-required": "This account uses two-step verification. Sign in with your password on the device where you set it up.",
  };
  return map[code] ?? "Something went wrong. Try again in a moment.";
}

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link to="/"><Logo /></Link>
      <h1 className="h1 mt-8">{title}</h1>
      {sub && <p className="mt-1 text-ink-2">{sub}</p>}
      <div className="mt-6">{children}</div>
    </main>
  );
}

/** Normalise a Nigerian number typed as 080… into +234… */
export function normPhone(p: string): string {
  const d = p.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("0") && d.length === 11) return "+234" + d.slice(1);
  if (d.startsWith("234")) return "+" + d;
  return d;
}

export function Login() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const nav = useNavigate();
  const s = useSession();
  const [mode, setMode] = useState<"password" | "link" | "phone">("password");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const confirm = useRef<ConfirmationResult | null>(null);
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => { if (s.ready && s.user) nav(next, { replace: true }); }, [s.ready, s.user, next, nav]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); setInfo(null); try { await fn(); } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); } };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "password") run(async () => { await signInWithEmailAndPassword(auth, email.trim(), password); });
    if (mode === "link") run(async () => {
      await sendSignInLinkToEmail(auth, email.trim(), { url: `${location.origin}/login/finish?next=${encodeURIComponent(next)}`, handleCodeInApp: true });
      try { localStorage.setItem(LS_EMAIL, email.trim()); } catch { /* ignore */ }
      setInfo(`We've sent a sign-in link to ${email.trim()}. Open it on this device. It works once and expires in an hour.`);
    });
    if (mode === "phone") run(async () => {
      if (!codeSent) {
        const verifier = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
        confirm.current = await signInWithPhoneNumber(auth, normPhone(phone), verifier);
        setCodeSent(true);
        setInfo("We've sent a 6-digit code by SMS.");
      } else {
        await confirm.current!.confirm(code.trim());
      }
    });
  };

  return (
    <Shell title="Sign in" sub="Use the email or phone number your hospital invited.">
      <Tabs value={mode} onChange={(m) => { setMode(m); setErr(null); setInfo(null); }} tabs={[{ value: "password", label: "Password" }, { value: "link", label: "Email link" }, { value: "phone", label: "Phone" }]} />
      <form onSubmit={submit} noValidate>
        <ErrorText error={err} />
        {info && <Banner tone="ok">{info}</Banner>}
        {mode !== "phone" && <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        {mode === "password" && <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        {mode === "phone" && !codeSent && <TextField label="Phone number" type="tel" autoComplete="tel" inputMode="tel" placeholder="0803 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} help="Phone sign-in works when your hospital has switched it on." />}
        {mode === "phone" && codeSent && <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}
        <Button variant="primary" className="w-full" busy={busy} type="submit">
          {mode === "password" ? "Sign in" : mode === "link" ? "Email me a sign-in link" : codeSent ? "Confirm code" : "Send code"}
        </Button>
        <div id="recaptcha" />
      </form>
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-[15px]">
        <Link to={`/signup?next=${encodeURIComponent(next)}`} className="link">Create an account</Link>
        {mode === "password" && <button className="link" onClick={() => run(async () => { if (!email.trim()) throw { code: "auth/invalid-email" }; await sendPasswordResetEmail(auth, email.trim()); setInfo("If there's an account for that email, we've sent a reset link."); })}>Forgot password?</button>}
      </div>
    </Shell>
  );
}

export function LoginFinish() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const nav = useNavigate();
  const [email, setEmail] = useState(() => { try { return localStorage.getItem(LS_EMAIL) ?? ""; } catch { return ""; } });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = isSignInWithEmailLink(auth, location.href);
  const tried = useRef(false);

  const finish = async (addr: string) => {
    setBusy(true); setErr(null);
    try {
      await signInWithEmailLink(auth, addr.trim(), location.href);
      try { localStorage.removeItem(LS_EMAIL); } catch { /* ignore */ }
      nav(next, { replace: true });
    } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (valid && email && !tried.current) { tried.current = true; finish(email); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!valid) return <Shell title="Link not valid"><p className="text-ink-2">This sign-in link isn't valid. <Link className="link" to="/login">Send a new one</Link>.</p></Shell>;
  return (
    <Shell title="Finish signing in" sub="Confirm the email address the link was sent to.">
      <ErrorText error={err} />
      <form onSubmit={(e) => { e.preventDefault(); finish(email); }}>
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button variant="primary" className="w-full" busy={busy} type="submit">Sign in</Button>
      </form>
    </Shell>
  );
}

export function Signup() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setErr("Enter your full name.");
    if (password.length < 8) return setErr("Use at least 8 characters for your password.");
    setBusy(true); setErr(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await sendEmailVerification(cred.user, { url: `${location.origin}${next}` }).catch(() => undefined);
      await cred.user.getIdToken(true);
      nav(next, { replace: true });
    } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Shell title="Create your account" sub="Use your work email if you have one.">
      <form onSubmit={submit} noValidate>
        <ErrorText error={err} />
        <TextField label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} help="At least 8 characters." />
        <p className="mb-4 text-sm text-ink-2">By creating an account you agree to the <Link className="link" to="/legal/terms">terms</Link> and <Link className="link" to="/legal/privacy">privacy notice</Link>.</p>
        <Button variant="primary" className="w-full" busy={busy} type="submit">Create account</Button>
      </form>
      <p className="mt-6 text-[15px]">Already have an account? <Link className="link" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></p>
    </Shell>
  );
}
