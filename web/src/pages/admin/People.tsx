import { useEffect, useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import Papa from "papaparse";
import QRCode from "qrcode";
import { Copy, Download, MessageCircle, UserPlus } from "lucide-react";
import { db } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { ago, fmtDate } from "../../lib/format";
import { Banner, Button, ConfirmButton, Empty, ErrorText, Modal, PageHead, SelectField, Spinner, StatusPill, Tabs, TextField, toast } from "../../components/ui";
import { JOB_TITLES } from "../../../../shared/src/config";
import type { Invite, JoinRequest, Member, MemberRole } from "../../../../shared/src/types";
import { AdminNav, ROLE_LABEL, useMembers } from "./shared";
import { normPhone } from "../public/Auth";

type InviteRow = { name: string; email: string; phone: string; role: MemberRole; jobTitle: string; department: string; locumExpiresAt: string; spaceIds: string[] };
type InviteOut = { token: string; link: string; email: string | null; phone: string | null; emailed: boolean };
const blank = (): InviteRow => ({ name: "", email: "", phone: "", role: "staff", jobTitle: "", department: "", locumExpiresAt: "", spaceIds: [] });

function roleOptions(isOwner: boolean) {
  return (["staff", "editor", "approver", "locum", "admin", ...(isOwner ? ["owner"] : [])] as MemberRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));
}

function RestrictedSpaces({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const s = useSession();
  const restricted = s.spaces.filter((x) => x.visibility === "restricted");
  if (!restricted.length) return null;
  return (
    <fieldset className="mb-4">
      <legend className="label">Restricted spaces</legend>
      <div className="flex flex-wrap gap-1.5">
        {restricted.map((sp) => <button key={sp.id} type="button" aria-pressed={value.includes(sp.id)} className={`chip ${value.includes(sp.id) ? "border-ink bg-ink text-page" : ""}`} onClick={() => onChange(value.includes(sp.id) ? value.filter((x) => x !== sp.id) : [...value, sp.id])}>{sp.name}</button>)}
      </div>
      <span className="help">Everyone sees open spaces. Add people to restricted spaces here, or by job title in the space settings.</span>
    </fieldset>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const [mode, setMode] = useState<"one" | "csv">("one");
  const [row, setRow] = useState<InviteRow>(blank());
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<InviteOut[] | null>(null);
  const staffBlocked = !s.caps.inviteStaff;
  const parseCsv = (f: File) => Papa.parse<Record<string, string>>(f, {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"),
    complete: (r) => setRows(r.data.map((d) => ({ name: d.name ?? d.full_name ?? "", email: (d.email ?? "").trim(), phone: (d.phone ?? d.phone_number ?? "").trim(), role: (["staff", "editor", "approver", "locum", "admin"].includes((d.role ?? "").toLowerCase()) ? d.role.toLowerCase() : "staff") as MemberRole, jobTitle: d.job_title ?? d.title ?? "", department: d.department ?? "", locumExpiresAt: d.locum_until ?? d.expires ?? "", spaceIds: [] })).filter((x) => x.email || x.phone)),
  });
  const send = async () => {
    const list = mode === "one" ? [row] : rows;
    if (!list.length || list.some((r) => !r.email && !r.phone && mode === "csv")) return setErr("Each person needs an email or a phone number.");
    setBusy(true); setErr(null);
    try {
      const r = await api<{ invites: InviteOut[] }>("createInvites", { instId: s.instId, invites: list.map((x) => ({ ...x, phone: x.phone ? normPhone(x.phone) : "", locumExpiresAt: x.locumExpiresAt || null })) });
      setOut(r.invites); toast(`${r.invites.length} invite${r.invites.length === 1 ? "" : "s"} created`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const close = () => { setOut(null); setRow(blank()); setRows([]); setErr(null); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Invite people" wide footer={out ? <Button variant="primary" onClick={close}>Done</Button> : <><Button onClick={close}>Cancel</Button><Button variant="primary" busy={busy} onClick={send}>Send invite{mode === "csv" && rows.length > 1 ? `s (${rows.length})` : ""}</Button></>}>
      {out ? (
        <div>
          <p className="mb-3 text-[15px]">Invites expire in 30 days. Emails are sent automatically. For phone numbers, share the link by WhatsApp or SMS.</p>
          <ul className="divide-y divide-rule">
            {out.map((o) => (
              <li key={o.token} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{o.email || o.phone} {o.emailed ? <span className="pill bg-ok-bg text-ok">Emailed</span> : o.email ? <span className="pill bg-warn-bg text-warn">Email not sent</span> : null}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(o.link); toast("Link copied"); }}><Copy className="h-4 w-4" />Copy link</Button>
                  {o.phone && <a className="btn btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/${o.phone.replace("+", "")}?text=${encodeURIComponent(`You're invited to ${s.inst?.name} on DocInsight: ${o.link}`)}`}><MessageCircle className="h-4 w-4" />WhatsApp</a>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {staffBlocked && <Banner tone="warn">{s.inst?.status === "pending_payment" ? "Staff invites open once your first invoice is paid. You can invite admins now." : "New invites are paused until the subscription is paid."}</Banner>}
          <Tabs value={mode} onChange={setMode} tabs={[{ value: "one", label: "One person" }, { value: "csv", label: "Upload a list (CSV)" }]} />
          <ErrorText error={err} />
          {mode === "one" ? (
            <div className="grid gap-x-3 sm:grid-cols-2">
              <TextField label="Name" value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} />
              <SelectField label="Role" value={row.role} onChange={(e) => setRow({ ...row, role: e.target.value as MemberRole })} options={roleOptions(s.isOwner)} />
              <TextField label="Email" type="email" value={row.email} onChange={(e) => setRow({ ...row, email: e.target.value })} />
              <TextField label="or phone" type="tel" placeholder="0803 000 0000" value={row.phone} onChange={(e) => setRow({ ...row, phone: e.target.value })} />
              <SelectField label="Job title" value={row.jobTitle} onChange={(e) => setRow({ ...row, jobTitle: e.target.value })} options={[{ value: "", label: "Choose…" }, ...JOB_TITLES.map((t) => ({ value: t, label: t }))]} />
              <TextField label="Department" value={row.department} onChange={(e) => setRow({ ...row, department: e.target.value })} />
              {(row.role === "locum" || row.locumExpiresAt) && <TextField label="Access ends" type="date" value={row.locumExpiresAt} onChange={(e) => setRow({ ...row, locumExpiresAt: e.target.value })} help="Locums and guests are signed out automatically." />}
              <div className="sm:col-span-2"><RestrictedSpaces value={row.spaceIds} onChange={(v) => setRow({ ...row, spaceIds: v })} /></div>
            </div>
          ) : (
            <div>
              <p className="mb-2 text-[15px]">Columns: <code>name, email, phone, role, job_title, department, locum_until</code>. Role is staff, editor, approver, locum or admin.</p>
              <Button size="sm" variant="ghost" className="mb-3" onClick={() => { const blob = new Blob(["name,email,phone,role,job_title,department,locum_until\nAda Obi,ada@example.com,,staff,Nurse,Ward 3,\nTunde Bello,,08030000000,locum,Doctor,A&E,2026-12-31\n"], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "docinsight-invites.csv"; a.click(); }}><Download className="h-4 w-4" />Download a template</Button>
              <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && parseCsv(e.target.files[0])} className="mb-3 block w-full text-[15px]" aria-label="CSV file" />
              {rows.length > 0 && <div className="max-h-64 overflow-auto rounded-lg border border-rule"><table className="w-full text-sm"><thead className="bg-soft"><tr><th className="p-2 text-left">Name</th><th className="p-2 text-left">Email / phone</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Title</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-t border-rule"><td className="p-2">{r.name}</td><td className="p-2">{r.email || r.phone}</td><td className="p-2">{r.role}</td><td className="p-2">{r.jobTitle}</td></tr>)}</tbody></table></div>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function EditMember({ m, onClose }: { m: Member; onClose: () => void }) {
  const s = useSession();
  const [f, setF] = useState({ role: m.role, jobTitle: m.jobTitle, department: m.department, spaceIds: m.spaceIds, expiresAt: m.expiresAt ? new Date(m.expiresAt.toMillis()).toISOString().slice(0, 10) : "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api("updateMember", { instId: s.instId, userId: m.userId, ...f, expiresAt: f.expiresAt || null, transferOwnership: f.role === "owner" && m.role !== "owner" }); toast("Saved"); onClose(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const self = m.userId === s.user?.uid;
  return (
    <Modal open onClose={onClose} title={m.name || m.email} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      <ErrorText error={err} />
      <p className="mb-3 text-[15px] text-ink-2">{m.email}{m.phone ? ` · ${m.phone}` : ""} · joined {fmtDate(m.joinedAt)}</p>
      {!self && m.role !== "owner" && <SelectField label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as MemberRole })} options={roleOptions(s.isOwner)} help={f.role === "owner" ? "You'll become an admin. This hands over billing and ownership." : undefined} />}
      <SelectField label="Job title" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} options={[{ value: "", label: "None" }, ...JOB_TITLES.map((t) => ({ value: t, label: t }))]} />
      <TextField label="Department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
      <TextField label="Access ends (locums and guests)" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
      <RestrictedSpaces value={f.spaceIds} onChange={(v) => setF({ ...f, spaceIds: v })} />
      {!self && m.role !== "owner" && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
          <ConfirmButton title="Sign out everywhere?" confirmLabel="Sign out" confirm={`${m.name || m.email} will be signed out on every device straight away. They can sign in again unless you also deactivate them.`} onConfirm={() => api("forceSignOut", { instId: s.instId, userId: m.userId }).then(() => toast("Signed out"))}>Sign out everywhere</ConfirmButton>
          {m.status === "active"
            ? <ConfirmButton variant="danger" title="Deactivate?" confirmLabel="Deactivate" confirm="They lose access immediately and their seat is freed. Their name stays in the change log." onConfirm={() => api("removeMember", { instId: s.instId, userId: m.userId }).then(() => { toast("Deactivated"); onClose(); })}>Deactivate</ConfirmButton>
            : <Button size="sm" onClick={() => api("removeMember", { instId: s.instId, userId: m.userId, reactivate: true }).then(() => { toast("Reactivated"); onClose(); }).catch((e) => setErr(e.message))}>Reactivate</Button>}
        </div>
      )}
    </Modal>
  );
}

function JoinCode() {
  const s = useSession();
  const [qr, setQr] = useState<string | null>(null);
  const code = s.inst?.joinCode ?? "";
  const link = `${location.origin}/j/${code}`;
  useEffect(() => { if (code) QRCode.toDataURL(link, { margin: 1, width: 480 }).then(setQr).catch(() => undefined); }, [link, code]);
  const poster = () => {
    const w = window.open("", "_blank");
    if (!w || !qr) return;
    w.document.write(`<!doctype html><title>Join ${s.inst?.name}</title><body style="font-family:Arial;text-align:center;padding:40px"><h1 style="font-size:40px">${s.inst?.name}</h1><p style="font-size:24px">Scan to get our protocols on your phone</p><img src="${qr}" style="width:360px"><p style="font-size:22px">or go to <b>${location.host}/join</b> and enter code</p><p style="font-size:56px;letter-spacing:6px;font-weight:bold">${code}</p><p style="color:#666">An administrator will approve your request.</p><script>setTimeout(()=>print(),300)</script></body>`);
    w.document.close();
  };
  return (
    <section className="card p-4">
      <h2 className="h2">Join code and QR poster</h2>
      <p className="mt-1 text-[15px] text-ink-2">Staff scan the QR code or enter the code, and an admin approves each request. Put the poster in staff rooms.</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {qr && <img src={qr} alt={`QR code to join ${s.inst?.name}`} className="h-36 w-36 rounded bg-white p-1" />}
        <div>
          <p className="font-mono text-3xl font-bold tracking-widest">{code}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={poster}>Print poster</Button>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(link); toast("Link copied"); }}><Copy className="h-4 w-4" />Copy link</Button>
            <ConfirmButton title="Make a new code?" confirmLabel="New code" confirm="The old code and posters stop working." onConfirm={() => api("regenerateJoinCode", { instId: s.instId }).then(() => toast("New code made"))}>New code</ConfirmButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function Requests() {
  const s = useSession();
  const reqs = useQuery<JoinRequest>(query(collection(db, "institutions", s.instId!, "joinRequests"), where("status", "==", "pending")), `jr:${s.instId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (r: JoinRequest, approve: boolean) => {
    setBusy(r.userId);
    try { await api("decideJoinRequest", { instId: s.instId, userId: r.userId, approve, role: "staff", jobTitle: r.jobTitle, department: r.department }); toast(approve ? "Approved" : "Declined"); }
    catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  if (!reqs.data) return <Spinner />;
  if (!reqs.data.length) return <Empty title="No requests">People who use your join code appear here for approval.</Empty>;
  return (
    <ul className="card divide-y divide-rule">
      {reqs.data.map((r) => (
        <li key={r.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span><b>{r.name}</b><span className="block text-[13px] text-ink-2">{r.email || r.phone} · {r.jobTitle || "no job title"}{r.department ? ` · ${r.department}` : ""} · {ago(r.createdAt)}</span></span>
          <span className="flex gap-2"><Button size="sm" variant="primary" busy={busy === r.userId} onClick={() => decide(r, true)}>Approve</Button><Button size="sm" onClick={() => decide(r, false)}>Decline</Button></span>
        </li>
      ))}
    </ul>
  );
}

export default function People() {
  const s = useSession();
  const members = useMembers();
  const invites = useQuery<Invite>(query(collection(db, "institutions", s.instId!, "invites"), where("status", "==", "pending")), `inv:${s.instId}`);
  const [tab, setTab] = useState<"members" | "invites" | "requests" | "code">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const list = useMemo(() => (members.data ?? []).filter((m) => (showInactive || m.status === "active") && (!q || `${m.name} ${m.email} ${m.phone} ${m.jobTitle} ${m.department}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)), [members.data, q, showInactive]);
  const active = (members.data ?? []).filter((m) => m.status === "active").length;
  const pendingInv = (invites.data ?? []).filter((i) => i.expiresAt?.toMillis?.() > Date.now());
  return (
    <div>
      <PageHead title="People" sub={`${active} active${s.inst ? "" : ""}`} actions={<Button size="sm" variant="primary" onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" />Invite</Button>} />
      <AdminNav />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "members", label: "Members" }, { value: "invites", label: `Invites${pendingInv.length ? ` (${pendingInv.length})` : ""}` }, { value: "requests", label: "Join requests" }, { value: "code", label: "Join code" }]} />
      {tab === "members" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3"><input className="input max-w-sm" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" /><label className="flex items-center gap-2 text-[15px]"><input type="checkbox" className="h-5 w-5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show deactivated</label></div>
          {!members.data ? <Spinner /> : (
            <ul className="card divide-y divide-rule">
              {list.map((m) => (
                <li key={m.userId}>
                  <button className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-soft" onClick={() => setEditing(m)}>
                    <span className="min-w-0"><b>{m.name || m.email || m.phone}</b> <span className="pill bg-soft text-ink-2">{ROLE_LABEL[m.role]}</span>{m.status !== "active" && <> <StatusPill status="deactivated" /></>}
                      <span className="block text-[13px] text-ink-2">{[m.jobTitle, m.department, m.email || m.phone].filter(Boolean).join(" · ")}{m.expiresAt ? ` · until ${fmtDate(m.expiresAt)}` : ""}</span></span>
                    <span className="text-[13px] text-ink-2">{m.lastActiveAt ? `Active ${ago(m.lastActiveAt)}` : "Not active yet"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {tab === "invites" && (!invites.data ? <Spinner /> : pendingInv.length === 0 ? <Empty title="No pending invites" /> : (
        <ul className="card divide-y divide-rule">
          {pendingInv.map((i) => (
            <li key={i.token} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span><b>{i.name || i.email || i.phone}</b> <span className="pill bg-soft text-ink-2">{ROLE_LABEL[i.role]}</span><span className="block text-[13px] text-ink-2">{i.email || i.phone} · sent {ago(i.createdAt)} · expires {fmtDate(i.expiresAt)}</span></span>
              <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/join/${s.instId}/${i.token}`); toast("Link copied"); }}><Copy className="h-4 w-4" />Link</Button><Button size="sm" variant="ghost" onClick={() => api("revokeInvite", { instId: s.instId, token: i.token }).then(() => toast("Invite cancelled"))}>Cancel</Button></span>
            </li>
          ))}
        </ul>
      ))}
      {tab === "requests" && <Requests />}
      {tab === "code" && <JoinCode />}
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      {editing && <EditMember m={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
