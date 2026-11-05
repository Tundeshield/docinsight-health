import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
import { api } from "../../lib/api";
import { auth } from "../../lib/firebase";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/AppShell";
import { Banner, Button, ErrorText, SelectField, Spinner, TextField } from "../../components/ui";
import { JOB_TITLES } from "../../../../shared/src/config";
import { fmtDate } from "../../lib/format";

interface InviteInfo { institution: { name: string; colour: string; phoneLogin: boolean }; role: string; email: string | null; phone: string | null; name: string; locumExpiresAt: number | null }

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-4 py-8"><Link to="/"><Logo /></Link><div className="mt-8">{children}</div></main>;
}

export function AcceptInvite() {
  const { instId = "", token = "" } = useParams();
  const s = useSession();
  const nav = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const here = `/join/${instId}/${token}`;

  useEffect(() => {
    if (!s.ready || !s.user) return;
    api<InviteInfo>("getInvite", { instId, token }).then((i) => { setInfo(i); setName(i.name || s.user?.displayName || ""); }).catch((e) => setErr(e.message));
  }, [s.ready, s.user, instId, token]);

  if (!s.ready) return <Spinner className="justify-center" />;
  if (!s.user) {
    return (
      <Frame>
        <h1 className="h1">You've been invited to DocInsight</h1>
        <p className="mt-2 text-ink-2">Create an account or sign in with the email or phone number the invite was sent to.</p>
        <div className="mt-6 grid gap-2">
          <Link className="btn btn-primary" to={`/signup?next=${encodeURIComponent(here)}`}>Create an account</Link>
          <Link className="btn" to={`/login?next=${encodeURIComponent(here)}`}>I already have an account</Link>
        </div>
      </Frame>
    );
  }
  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      await auth.currentUser?.reload();
      await auth.currentUser?.getIdToken(true);
      const r = await api<{ instId: string }>("acceptInvite", { instId, token, name, jobTitle });
      await s.refresh();
      s.switchInstitution(r.instId);
      nav("/app", { replace: true });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const needsVerify = info?.email && !s.user.emailVerified && s.user.email?.toLowerCase() === info.email;
  return (
    <Frame>
      {!info && !err && <Spinner />}
      <ErrorText error={err} />
      {info && (
        <>
          <span className="inline-block h-4 w-4 rounded-full" style={{ background: info.institution.colour }} aria-hidden />
          <h1 className="h1 mt-2">Join {info.institution.name}</h1>
          <p className="mt-2 text-ink-2">You're invited as <b>{info.role}</b>{info.locumExpiresAt && <> until <b>{fmtDate(new Date(info.locumExpiresAt))}</b></>}.</p>
          {needsVerify && (
            <Banner tone="warn" title="Verify your email first" action={<Button size="sm" disabled={sent} onClick={async () => { await sendEmailVerification(auth.currentUser!, { url: location.href }).catch(() => undefined); setSent(true); }}>{sent ? "Sent" : "Resend link"}</Button>}>
              Open the verification link we emailed to {info.email}, then come back and press Join.
            </Banner>
          )}
          <div className="mt-6">
            <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <SelectField label="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} options={[{ value: "", label: "Choose…" }, ...JOB_TITLES.map((t) => ({ value: t, label: t }))]} />
            <Button variant="primary" className="w-full" busy={busy} onClick={accept}>Join {info.institution.name}</Button>
          </div>
        </>
      )}
    </Frame>
  );
}

export function JoinByCode() {
  const { code: fromUrl } = useParams();
  const [params] = useSearchParams();
  const s = useSession();
  const nav = useNavigate();
  const [code, setCode] = useState(fromUrl ?? params.get("code") ?? "");
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { if (s.user?.displayName) setName(s.user.displayName); }, [s.user]);
  const here = `/join?code=${encodeURIComponent(code)}`;

  if (!s.ready) return <Spinner className="justify-center" />;
  if (!s.user) {
    return (
      <Frame>
        <h1 className="h1">Join your hospital</h1>
        <p className="mt-2 text-ink-2">First create an account or sign in. Then enter the join code from your administrator or the poster on your ward.</p>
        <div className="mt-6 grid gap-2">
          <Link className="btn btn-primary" to={`/signup?next=${encodeURIComponent(here)}`}>Create an account</Link>
          <Link className="btn" to={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
        </div>
      </Frame>
    );
  }
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ instId: string; status: string; institution?: { name: string } }>("requestToJoin", { code, name, jobTitle, department });
      if (r.status === "member") { await s.refresh(); s.switchInstitution(r.instId); nav("/app"); return; }
      setDone(r.institution?.name ?? "your hospital");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (done) return <Frame><h1 className="h1">Request sent</h1><p className="mt-2 text-ink-2">An administrator at {done} needs to approve your request. We'll email you when they do.</p><Link to="/welcome" className="btn mt-6">Done</Link></Frame>;
  return (
    <Frame>
      <h1 className="h1">Join with a code</h1>
      <p className="mt-2 text-ink-2">An administrator will approve your request.</p>
      <div className="mt-6">
        <ErrorText error={err} />
        <TextField label="Join code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" placeholder="e.g. LSH-4K7Q" />
        <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} options={[{ value: "", label: "Choose…" }, ...JOB_TITLES.map((t) => ({ value: t, label: t }))]} />
        <TextField label="Department (optional)" value={department} onChange={(e) => setDepartment(e.target.value)} />
        <Button variant="primary" className="w-full" busy={busy} disabled={!code.trim()} onClick={submit}>Request to join</Button>
      </div>
    </Frame>
  );
}
