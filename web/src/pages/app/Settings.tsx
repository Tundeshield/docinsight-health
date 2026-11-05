import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { multiFactor, TotpMultiFactorGenerator, type TotpSecret } from "firebase/auth";
import QRCode from "qrcode";
import { auth, db } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { offlineDocs, removeOffline, type OfflineDoc } from "../../lib/storage";
import { pushAvailable, registerPush } from "../../lib/push";
import { Banner, Button, Check, ErrorText, Modal, PageHead, TextField, toast } from "../../components/ui";

function TwoStep() {
  const user = auth.currentUser!;
  const enrolled = multiFactor(user).enrolledFactors;
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setErr(null); setBusy(true);
    try {
      const session = await multiFactor(user).getSession();
      const s = await TotpMultiFactorGenerator.generateSecret(session);
      setSecret(s);
      setQr(await QRCode.toDataURL(s.generateQrCodeUrl(user.email ?? "DocInsight", "DocInsight Health")));
      setOpen(true);
    } catch (e) {
      const c = (e as { code?: string }).code;
      setErr(c === "auth/requires-recent-login" ? "For security, sign out and sign in again, then set up two-step verification." : c === "auth/unverified-email" ? "Verify your email address first." : "Two-step verification isn't available yet. The DocInsight team needs to switch it on.");
    } finally { setBusy(false); }
  };
  const finish = async () => {
    if (!secret) return;
    setBusy(true); setErr(null);
    try { await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()), "Authenticator app"); setOpen(false); toast("Two-step verification is on"); }
    catch { setErr("That code isn't right. Check the time on your phone and try again."); } finally { setBusy(false); }
  };
  return (
    <section className="card mb-4 p-4">
      <h2 className="h2">Two-step verification</h2>
      <p className="mt-1 text-[15px] text-ink-2">Use an authenticator app as well as your password. Required for admins on some plans.</p>
      <ErrorText error={err} />
      {enrolled.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-3"><span className="pill bg-ok-bg text-ok">On</span>
          <Button size="sm" onClick={async () => { try { await multiFactor(user).unenroll(enrolled[0]); toast("Two-step verification is off"); } catch { setErr("Sign out and in again, then try."); } }}>Turn off</Button></div>
      ) : <Button className="mt-3" busy={busy} onClick={start}>Set up</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title="Set up two-step verification" footer={<Button variant="primary" busy={busy} onClick={finish}>Turn on</Button>}>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-[15px]"><li>Open an authenticator app (Google Authenticator, Microsoft Authenticator).</li><li>Scan this code, or enter the key below.</li><li>Type the 6-digit code it shows.</li></ol>
        {qr && <img src={qr} alt="QR code for your authenticator app" className="mx-auto h-48 w-48 rounded bg-white p-2" />}
        {secret && <p className="my-3 break-all text-center font-mono text-sm">{secret.secretKey}</p>}
        <ErrorText error={err} />
        <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Modal>
    </section>
  );
}

export default function Settings() {
  const s = useSession();
  const nav = useNavigate();
  const [name, setName] = useState(s.member?.name || s.profile?.name || s.user?.displayName || "");
  const [phone, setPhone] = useState(s.profile?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState<OfflineDoc[]>([]);
  useEffect(() => { offlineDocs().then(setOffline).catch(() => undefined); }, []);
  const uid = s.user!.uid;
  const setSetting = async (k: "dataSaver" | "emailDigest" | "pushEnabled", v: boolean) => {
    if (k === "pushEnabled" && v) {
      const ok = await registerPush(uid).catch(() => false);
      if (!ok) { toast("Notifications are blocked or not available on this device."); return; }
    }
    await setDoc(doc(db, "users", uid, "private", "settings"), { ...s.settings, [k]: v }, { merge: true }).catch(() => toast("Couldn't save. Try again."));
  };
  const save = async () => { setBusy(true); try { await api("updateMyProfile", { name, phone }); toast("Saved"); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const mb = offline.reduce((a, d) => a + d.bytes, 0) / 1_048_576;

  return (
    <div className="max-w-2xl">
      <PageHead title="Settings" />
      <section className="card mb-4 p-4">
        <h2 className="h2 mb-3">Your details</h2>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <p className="mb-3 text-[15px] text-ink-2">Signed in as {s.user?.email || s.user?.phoneNumber}{s.member && <> · {s.member.role}{s.member.jobTitle ? `, ${s.member.jobTitle}` : ""}</>}</p>
        <Button busy={busy} onClick={save}>Save</Button>
      </section>
      <section className="card mb-4 p-4">
        <h2 className="h2 mb-3">On this phone</h2>
        <Check label="Data saver" help="Open documents as text first. Page images load only when you ask." checked={s.settings.dataSaver} onChange={(v) => setSetting("dataSaver", v)} />
        <Check label="Notifications" help={pushAvailable() ? "Get a notification when a document you can see changes." : "Notifications aren't available in this browser. You'll still see updates in the app and by email."} checked={s.settings.pushEnabled} disabled={!pushAvailable()} onChange={(v) => setSetting("pushEnabled", v)} />
        <Check label="Weekly email digest" help="A summary of changes every Monday." checked={s.settings.emailDigest} onChange={(v) => setSetting("emailDigest", v)} />
        <div className="mt-4 border-t border-rule pt-3">
          <p className="font-bold">Saved for offline</p>
          {offline.length === 0 ? <p className="text-[15px] text-ink-2">Nothing saved yet. Open a document and tap Save offline.</p> : (
            <>
              <p className="text-[15px] text-ink-2">{offline.length} document{offline.length === 1 ? "" : "s"}, {mb.toFixed(1)} MB</p>
              <ul className="mt-2 divide-y divide-rule">{offline.map((d) => <li key={d.key} className="flex items-center justify-between gap-2 py-2"><Link className="link" to={`/app/doc/${d.contentId}`}>{d.title}</Link><Button size="sm" variant="ghost" onClick={async () => { await removeOffline(d.contentId); setOffline(await offlineDocs()); }}>Remove</Button></li>)}</ul>
            </>
          )}
        </div>
      </section>
      {s.user?.email && <TwoStep />}
      {s.institutions.length > 1 && (
        <section className="card mb-4 p-4">
          <h2 className="h2 mb-2">Institutions</h2>
          <ul className="divide-y divide-rule">{s.institutions.map((i) => <li key={i.id} className="flex items-center justify-between py-2"><span>{i.name}</span>{i.id === s.instId ? <span className="pill bg-ok-bg text-ok">Open</span> : <Button size="sm" onClick={() => { s.switchInstitution(i.id); nav("/app"); }}>Open</Button>}</li>)}</ul>
        </section>
      )}
      <Banner>DocInsight supports, and does not replace, clinical judgement. <Link className="link" to="/legal/clinical-safety">Clinical safety</Link> · <Link className="link" to="/legal/privacy">Privacy</Link> · <Link className="link" to="/legal/terms">Terms</Link></Banner>
      <div className="flex flex-wrap gap-2">
        <Link to="/join" className="btn">Join another institution</Link>
        <Button variant="danger" onClick={async () => { await s.signOutNow(); nav("/"); }}>Sign out</Button>
      </div>
    </div>
  );
}
