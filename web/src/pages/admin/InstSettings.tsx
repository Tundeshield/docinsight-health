import { useState } from "react";
import { ref, uploadBytes } from "firebase/storage";
import { storage } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Button, Check, ErrorText, PageHead, TextField, toast } from "../../components/ui";
import { AdminNav } from "./shared";

export default function InstSettings() {
  const s = useSession();
  const inst = s.inst!;
  const [name, setName] = useState(inst.name);
  const [colour, setColour] = useState(inst.colour);
  const [domains, setDomains] = useState((inst.emailDomains ?? []).join(", "));
  const [st, setSt] = useState(inst.settings);
  const [bc, setBc] = useState(inst.billingContact);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api("updateInstitution", { instId: s.instId, name, colour, emailDomains: domains.split(",").map((x) => x.trim()).filter(Boolean), settings: st, ...(s.isOwner && { billingContact: bc }) }); toast("Saved"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const uploadLogo = async (f: File) => {
    try {
      const path = `inst/${s.instId}/branding/logo-${Date.now()}.${(f.name.split(".").pop() || "png").toLowerCase()}`;
      await uploadBytes(ref(storage, path), f, { contentType: f.type });
      await api("updateInstitution", { instId: s.instId, logoRef: path });
      toast("Logo updated");
    } catch (e) { setErr((e as Error).message || "Couldn't upload the logo. Use a PNG, JPG or SVG under 2 MB."); }
  };
  return (
    <div className="max-w-2xl">
      <PageHead title="Institution settings" />
      <AdminNav />
      <ErrorText error={err} />
      <section className="card mb-4 p-4">
        <h2 className="h2 mb-3">Branding</h2>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Colour" type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="[&_input]:h-11 [&_input]:w-24 [&_input]:p-1" />
        <label className="label" htmlFor="logo">Logo</label>
        <input id="logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="mb-2 block text-[15px]" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
      </section>
      <section className="card mb-4 p-4">
        <h2 className="h2 mb-3">Joining</h2>
        <TextField label="Work email domains" placeholder="lakesidehospital.ng" value={domains} onChange={(e) => setDomains(e.target.value)} help="People who verify an email on these domains join automatically as staff. Public domains like gmail.com aren't allowed." />
        <Check label="Allow phone number sign-in" help="Staff without work email can sign in with an SMS code." checked={st.phoneLogin} onChange={(v) => setSt({ ...st, phoneLogin: v })} />
      </section>
      <section className="card mb-4 p-4">
        <h2 className="h2 mb-3">Staff experience</h2>
        <Check label="Data saver by default" help="Documents open as text first on new phones." checked={st.dataSaverDefault} onChange={(v) => setSt({ ...st, dataSaverDefault: v })} />
        <Check label="Weekly email digest" checked={st.emailDigest} onChange={(v) => setSt({ ...st, emailDigest: v })} />
      </section>
      <section className="card mb-4 p-4">
        <h2 className="h2 mb-3">Privacy and security</h2>
        <Check label="Individual question logs" disabled={!s.isOwner} help="Off by default. When on, admins can see who asked which question. You must tell staff before switching this on. Owner only." checked={st.questionLogOptIn} onChange={(v) => setSt({ ...st, questionLogOptIn: v })} />
        <Check label="Require two-step verification for admins" disabled={!s.isOwner || inst.planId === "group"} help={inst.planId === "group" ? "Always on for the Group plan." : "Owners and admins must set up an authenticator app. Owner only."} checked={st.requireAdmin2fa || inst.planId === "group"} onChange={(v) => setSt({ ...st, requireAdmin2fa: v })} />
      </section>
      {s.isOwner && (
        <section className="card mb-4 p-4">
          <h2 className="h2 mb-3">Billing contact</h2>
          <TextField label="Name" value={bc.name} onChange={(e) => setBc({ ...bc, name: e.target.value })} />
          <TextField label="Email" type="email" value={bc.email} onChange={(e) => setBc({ ...bc, email: e.target.value })} />
          <TextField label="Phone" type="tel" value={bc.phone} onChange={(e) => setBc({ ...bc, phone: e.target.value })} />
        </section>
      )}
      <Button variant="primary" busy={busy} onClick={save}>Save settings</Button>
    </div>
  );
}
