import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useDoc, useQuery } from "../../lib/hooks";
import { fmtDate, fmtDateTime, formatMoney, ago } from "../../lib/format";
import { Banner, Button, Check, ConfirmButton, Empty, ErrorText, Modal, PageHead, SelectField, Spinner, Stat, StatusPill, TextArea, TextField, cx, toast } from "../../components/ui";
import { DOCUMENT_TYPES, SPACE_TEMPLATES } from "../../../../shared/src/config";
import type { BillingConfig, ContentItem, ContentVersion, DigitisationJob, HubCollection, Plan } from "../../../../shared/src/types";
import { ACCEPT, mimeOf, uploadFile } from "../admin/upload";
import { PageChecker } from "../admin/ContentEditor";

const naira = (kobo: number) => Math.round(kobo / 100);

function PNav() {
  const links = [["", "Institutions"], ["digitisation", "Digitisation"], ["hub", "Knowledge Hub"], ["config", "Prices and payment"], ["health", "Health"]];
  return (
    <nav aria-label="Platform" className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-rule px-4 md:mx-0 md:px-0">
      {links.map(([to, l]) => <NavLink key={to} to={`/app/platform${to ? "/" + to : ""}`} end={!to} className={({ isActive }) => cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[15px] font-bold", isActive ? "border-brand text-ink" : "border-transparent text-ink-2 hover:text-ink")}>{l}</NavLink>)}
    </nav>
  );
}

interface Row { id: string; name: string; planName: string; billingCycle: string; status: string; seats: number; seatLimit: number | null; questionsThisMonth: number; costMicrosThisMonth: number; ocrPagesThisMonth: number; mrr: number; discountPct: number; pilot: boolean; currentPeriodEnd: string | null; lastActivityAt: string | null; openInvoices: { id: string; number: string; amount: number; method: string | null; dueAt: string }[] }

function NewInstitution({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", ownerEmail: "", planId: "clinic", billingCycle: "monthly", setupPackageId: "standard", pilot: true, discountPct: 0, templates: ["hospital-wide", "emergency", "nursing", "pharmacy"] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setErr(null);
    try { const r = await api<{ instId: string }>("platformCreateInstitution", { ...f, billingContact: { email: f.ownerEmail } }); toast("Created. The owner has been invited."); onClose(); nav(`/app/platform/i/${r.instId}`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New institution (sales-led)" footer={<Button variant="primary" busy={busy} onClick={create}>Create and invite owner</Button>}>
      <ErrorText error={err} />
      <TextField label="Institution name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <TextField label="Owner's email" type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} help="They get an invite to take ownership." />
      <div className="grid gap-x-3 sm:grid-cols-3">
        <SelectField label="Plan" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })} options={[{ value: "clinic", label: "Clinic" }, { value: "hospital", label: "Hospital" }, { value: "group", label: "Group" }]} />
        <SelectField label="Cycle" value={f.billingCycle} onChange={(e) => setF({ ...f, billingCycle: e.target.value })} options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Yearly" }]} />
        <SelectField label="Setup" value={f.setupPackageId} onChange={(e) => setF({ ...f, setupPackageId: e.target.value })} options={[{ value: "standard", label: "Standard" }, { value: "large", label: "Large" }, { value: "none", label: "None" }]} />
      </div>
      <Check label="60-day pilot at half price" checked={f.pilot} onChange={(v) => setF({ ...f, pilot: v })} />
      <TextField label="Extra discount %" type="number" min={0} max={100} value={f.discountPct} onChange={(e) => setF({ ...f, discountPct: Number(e.target.value) })} />
      <fieldset><legend className="label">Spaces</legend><div className="flex flex-wrap gap-1.5">{SPACE_TEMPLATES.map((t) => <button key={t.key} type="button" aria-pressed={f.templates.includes(t.key)} className={`chip ${f.templates.includes(t.key) ? "border-ink bg-ink text-page" : ""}`} onClick={() => setF({ ...f, templates: f.templates.includes(t.key) ? f.templates.filter((x) => x !== t.key) : [...f.templates, t.key] })}>{t.name}</button>)}</div></fieldset>
    </Modal>
  );
}

function Institutions() {
  const [d, setD] = useState<{ rows: Row[]; totals: { mrr: number; institutions: number; active: number; pending: number; costMicros: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => { api<typeof d>("platformListInstitutions").then(setD).catch((e) => setErr(e.message)); }, []);
  return (
    <div>
      <PageHead title="Platform" sub="DocInsight team only." actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>New institution</Button>} />
      <PNav />
      <ErrorText error={err} />
      {!d ? (!err && <Spinner />) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Monthly recurring revenue" value={formatMoney(d.totals.mrr, "NGN")} />
            <Stat label="Institutions" value={d.totals.institutions} sub={`${d.totals.active} paying · ${d.totals.pending} pending`} />
            <Stat label="AI cost this month" value={`$${(d.totals.costMicros / 1e6).toFixed(2)}`} />
            <Stat label="Unpaid invoices" value={d.rows.reduce((a, r) => a + r.openInvoices.length, 0)} />
          </div>
          <input className="input my-4 max-w-sm" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter institutions" />
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-[14px]">
              <thead className="bg-soft text-left"><tr><th className="p-3">Institution</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Seats</th><th className="p-3">Questions</th><th className="p-3">AI cost</th><th className="p-3">MRR</th><th className="p-3">Last active</th></tr></thead>
              <tbody>
                {d.rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())).map((r) => (
                  <tr key={r.id} className="border-t border-rule hover:bg-soft">
                    <td className="p-3"><Link className="link" to={`/app/platform/i/${r.id}`}>{r.name}</Link>{r.pilot && <span className="pill ml-1 bg-soft text-ink-2">pilot</span>}{r.openInvoices.length > 0 && <span className="pill ml-1 bg-warn-bg text-warn">{r.openInvoices.length} unpaid</span>}</td>
                    <td className="p-3">{r.planName} · {r.billingCycle}</td>
                    <td className="p-3"><StatusPill status={r.status} /></td>
                    <td className="p-3 tabular-nums">{r.seats}/{r.seatLimit ?? "∞"}</td>
                    <td className="p-3 tabular-nums">{r.questionsThisMonth}</td>
                    <td className="p-3 tabular-nums">${(r.costMicrosThisMonth / 1e6).toFixed(2)}</td>
                    <td className="p-3 tabular-nums">{formatMoney(r.mrr, "NGN")}</td>
                    <td className="p-3">{r.lastActivityAt ? ago(r.lastActivityAt) : "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <NewInstitution open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

interface Support {
  institution: { id: string; name: string; status: string; planId: string; billingCycle: string; joinCode: string; emailDomains: string[]; billingContact: { name: string; email: string; phone: string }; discountPct: number; extraSeats: number; pilot: { endsAt: string } | null; setupPackageId: string | null; currentPeriodEnd: string | null };
  spaces: { id: string; name: string; visibility: string; archived: boolean; requiresApproval: boolean; approvers: string[]; sections: string[]; documents: number }[];
  members: { total: number; active: number; roles: Record<string, number> };
  content: { total: number; published: number; inReview: number; drafts: number };
  invoices: { id: string; number: string; amount: number; status: string; method: string | null; kind: string; issuedAt: string; paidAt: string | null }[];
}

function InstitutionDetail() {
  const { instId = "" } = useParams();
  const [d, setD] = useState<Support | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmInv, setConfirmInv] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [issue, setIssue] = useState(false);
  const [line, setLine] = useState({ description: "", quantity: 1, unitAmount: 0, extendsPeriod: false, kind: "mixed" });
  const [bill, setBill] = useState<{ status: string; planId: string; billingCycle: string; discountPct: number; extraSeats: number } | null>(null);
  const load = () => api<Support>("platformSupportView", { instId }).then((r) => { setD(r); setBill({ status: r.institution.status, planId: r.institution.planId, billingCycle: r.institution.billingCycle, discountPct: r.institution.discountPct, extraSeats: r.institution.extraSeats }); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [instId]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>, ok: string) => { setErr(null); try { await fn(); toast(ok); load(); } catch (e) { setErr((e as Error).message); } };
  if (!d) return <><PageHead title="Institution" back={{ to: "/app/platform", label: "Platform" }} /><ErrorText error={err} />{!err && <Spinner />}</>;
  const i = d.institution;
  return (
    <div>
      <PageHead title={i.name} sub={<><StatusPill status={i.status} /> · {i.planId}, {i.billingCycle} · join code {i.joinCode}</>} back={{ to: "/app/platform", label: "Platform" }} />
      <ErrorText error={err} />
      <Banner>Support view: setup and billing only. Staff questions and conversations are never shown here.</Banner>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active members" value={d.members.active} sub={Object.entries(d.members.roles).map(([k, v]) => `${v} ${k}`).join(", ")} />
        <Stat label="Documents" value={d.content.total} sub={`${d.content.published} live · ${d.content.inReview} in review · ${d.content.drafts} drafts`} />
        <Stat label="Paid until" value={i.currentPeriodEnd ? fmtDate(i.currentPeriodEnd) : "Not paid"} />
        <Stat label="Billing contact" value={<span className="text-base">{i.billingContact?.name || "—"}</span>} sub={`${i.billingContact?.email ?? ""} ${i.billingContact?.phone ?? ""}`} />
      </div>
      <section className="card mt-5 p-4">
        <h2 className="h2 mb-2">Invoices</h2>
        {d.invoices.length === 0 ? <p className="text-ink-2">None.</p> : (
          <ul className="divide-y divide-rule">
            {d.invoices.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><b>{v.number}</b> <StatusPill status={v.status} /> {formatMoney(v.amount, "NGN")} · {v.kind}{v.method ? ` · ${v.method}` : ""} · {fmtDate(v.issuedAt)}{v.paidAt ? ` · paid ${fmtDate(v.paidAt)}` : ""}</span>
                {v.status === "open" && <span className="flex gap-2"><Button size="sm" variant="primary" onClick={() => { setConfirmInv(v.id); setRef(""); }}>Confirm payment</Button><ConfirmButton title="Void invoice?" confirmLabel="Void" confirm="It will no longer be payable." onConfirm={() => run(() => api("platformVoidInvoice", { instId, invoiceId: v.id }), "Voided")}>Void</ConfirmButton></span>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setIssue(true)}>Issue invoice</Button>
          {i.pilot && <Button size="sm" onClick={() => run(() => api("platformConvertPilot", { instId }), "Pilot converted. Invoice issued.")}>End pilot and invoice full price</Button>}
        </div>
      </section>
      {bill && (
        <section className="card mt-5 p-4">
          <h2 className="h2 mb-3">Plan and status</h2>
          <div className="grid gap-x-3 sm:grid-cols-3">
            <SelectField label="Status" value={bill.status} onChange={(e) => setBill({ ...bill, status: e.target.value })} options={["pending_payment", "active", "past_due", "restricted", "suspended", "cancelled"].map((x) => ({ value: x, label: x.replace("_", " ") }))} help="Normally set by payments and the daily billing check." />
            <SelectField label="Plan" value={bill.planId} onChange={(e) => setBill({ ...bill, planId: e.target.value })} options={[{ value: "clinic", label: "Clinic" }, { value: "hospital", label: "Hospital" }, { value: "group", label: "Group" }]} />
            <SelectField label="Cycle" value={bill.billingCycle} onChange={(e) => setBill({ ...bill, billingCycle: e.target.value })} options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Yearly" }]} />
            <TextField label="Discount %" type="number" value={bill.discountPct} onChange={(e) => setBill({ ...bill, discountPct: Number(e.target.value) })} />
            <TextField label="Extra seats" type="number" step={10} value={bill.extraSeats} onChange={(e) => setBill({ ...bill, extraSeats: Number(e.target.value) })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => run(() => api("platformUpdateBilling", { instId, ...bill }), "Saved")}>Save</Button>
            <Button onClick={() => run(() => api("platformUpdateBilling", { instId, pilot: !i.pilot }), i.pilot ? "Pilot removed" : "Pilot started")}>{i.pilot ? `Remove pilot (ends ${fmtDate(i.pilot.endsAt)})` : "Start 60-day pilot"}</Button>
          </div>
        </section>
      )}
      <section className="card mt-5 p-4">
        <h2 className="h2 mb-2">Spaces</h2>
        <ul className="divide-y divide-rule">{d.spaces.map((sp) => <li key={sp.id} className="py-2"><b>{sp.name}</b>{sp.archived && " (archived)"} <span className="text-[13px] text-ink-2">· {sp.visibility} · {sp.documents} docs · {sp.requiresApproval ? `approvers: ${sp.approvers.join(", ") || "none"}` : "no approval"} · {sp.sections.join(", ")}</span></li>)}</ul>
      </section>
      <Modal open={!!confirmInv} onClose={() => setConfirmInv(null)} title="Confirm bank transfer" footer={<Button variant="primary" onClick={() => { const id = confirmInv; setConfirmInv(null); run(() => api("platformConfirmPayment", { instId, invoiceId: id, reference: ref }), "Payment confirmed. Receipt sent."); }}>Confirm received</Button>}>
        <p className="mb-3 text-[15px]">Only confirm once the money is in the account. This extends access and emails a receipt.</p>
        <TextField label="Bank reference" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Modal>
      <Modal open={issue} onClose={() => setIssue(false)} title="Issue invoice" footer={<Button variant="primary" onClick={() => { setIssue(false); run(() => api("platformIssueInvoice", { instId, kind: line.kind, extendsPeriod: line.extendsPeriod, lines: [{ description: line.description, quantity: line.quantity, unitAmount: line.unitAmount * 100 }] }), "Invoice issued and emailed"); }}>Issue</Button>}>
        <TextField label="Description" value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} placeholder="e.g. Extra digitisation: 120 pages" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Quantity" type="number" min={1} value={line.quantity} onChange={(e) => setLine({ ...line, quantity: Number(e.target.value) })} />
          <TextField label="Unit price (₦)" type="number" min={0} value={line.unitAmount} onChange={(e) => setLine({ ...line, unitAmount: Number(e.target.value) })} />
        </div>
        <SelectField label="Kind" value={line.kind} onChange={(e) => setLine({ ...line, kind: e.target.value })} options={["subscription", "setup", "seats", "pages", "mixed"].map((x) => ({ value: x, label: x }))} />
        <Check label="Paying this extends the subscription by one period" checked={line.extendsPeriod} onChange={(v) => setLine({ ...line, extendsPeriod: v })} />
      </Modal>
    </div>
  );
}

function Digitisation() {
  const [status, setStatus] = useState("open");
  const jobs = useQuery<DigitisationJob>(query(collection(db, "digitisationJobs"), orderBy("updatedAt", "desc"), limit(200)), "jobs");
  const rows = (jobs.data ?? []).filter((j) => (status === "open" ? !["published"].includes(j.status) : j.status === status));
  return (
    <div>
      <PageHead title="Digitisation queue" sub="Scanned documents across all hospitals and the hub." />
      <PNav />
      <select className="input mb-4 w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="open">Not yet published</option>{["received", "ocr", "checking", "ready", "published", "failed"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
      {!jobs.data ? <Spinner /> : rows.length === 0 ? <Empty title="Queue is clear" /> : (
        <ul className="card divide-y divide-rule">
          {rows.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span><b>{j.title}</b> <span className={cx("pill", j.status === "failed" ? "bg-warn-bg text-warn" : j.status === "checking" ? "bg-soft text-ink" : "bg-ok-bg text-ok")}>{j.status}</span>
                <span className="block text-[13px] text-ink-2">{j.institutionName} · {j.pagesReceived} pages · {j.pagesOcrd} scanned · {j.pagesChecked}/{j.lowConfidencePages.length} hard pages checked · {j.assignee ?? "unassigned"} · {fmtDateTime(j.updatedAt)}</span></span>
              <span className="flex gap-2">
                {j.institutionId === "hub" && j.contentId && <Link className="btn btn-sm" to={`/app/platform/hub/doc/${j.contentId}`}>Open</Link>}
                <Button size="sm" variant="ghost" onClick={() => { const a = prompt("Assign to", j.assignee ?? ""); if (a !== null) api("platformUpdateJob", { jobId: j.id, assignee: a }).then(() => toast("Assigned")).catch((e) => toast(e.message)); }}>Assign</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HubHome() {
  const cols = useQuery<HubCollection>(query(collection(db, "hubCollections")), "pcols");
  const [sel, setSel] = useState<string>("");
  const items = useQuery<ContentItem>(sel ? query(collection(db, "hubContent"), where("spaceId", "==", sel)) : null, `phub:${sel}`);
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [upOpen, setUpOpen] = useState(false);
  const list = (cols.data ?? []).sort((a, b) => a.order - b.order);
  useEffect(() => { if (!sel && list[0]) setSel(list[0].id); }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHead title="Knowledge Hub" sub="National content for every paying hospital. Check usage rights before publishing." actions={<Button size="sm" onClick={() => setEdit({ name: "", description: "" })}>New collection</Button>} />
      <PNav />
      {!cols.data ? <Spinner /> : list.length === 0 ? <Empty title="No collections" action={<Button onClick={() => setEdit({ name: "", description: "" })}>New collection</Button>} /> : (
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <ul className="card h-fit divide-y divide-rule">{list.map((c) => <li key={c.id}><button className={cx("w-full px-3 py-2.5 text-left", sel === c.id && "bg-soft font-bold")} onClick={() => setSel(c.id)}>{c.name}{c.archived && " (archived)"}</button></li>)}</ul>
          <div>
            {sel && (() => { const c = list.find((x) => x.id === sel)!; return (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="h2">{c.name}</h2><p className="text-[14px] text-ink-2">{c.description}</p></div>
                <div className="flex gap-2"><Button size="sm" onClick={() => setEdit({ id: c.id, name: c.name, description: c.description })}>Edit</Button><Button size="sm" variant="primary" onClick={() => setUpOpen(true)}>Add document</Button></div></div>
            ); })()}
            {!items.data ? <Spinner /> : items.data.length === 0 ? <Empty title="Empty collection" /> : (
              <ul className="card divide-y divide-rule">{items.data.map((c) => <li key={c.id}><Link to={`/app/platform/hub/doc/${c.id}`} className="block px-4 py-3 hover:bg-soft"><b>{c.title}</b> <StatusPill status={c.status} /><span className="block text-[13px] text-ink-2">{c.sourceName} · {c.publicationDate}</span></Link></li>)}</ul>
            )}
          </div>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit collection" : "New collection"} footer={<Button variant="primary" onClick={() => api("hubSaveCollection", { collectionId: edit?.id, name: edit?.name, description: edit?.description }).then(() => { toast("Saved"); setEdit(null); }).catch((e) => toast(e.message))}>Save</Button>}>
        {edit && <><TextField label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /><TextArea label="Description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></>}
      </Modal>
      {upOpen && <HubUpload collectionId={sel} onClose={() => setUpOpen(false)} />}
    </div>
  );
}

function HubUpload({ collectionId, onClose }: { collectionId: string; onClose: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState({ title: "", sourceName: "", publicationDate: "", originalUrl: "", documentType: "guideline", description: "" });
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!file) return setErr("Choose a file.");
    setErr(null); setProgress("Saving…");
    try {
      const r = await api<{ contentId: string; versionId: string; uploadPath: string }>("hubCreateContent", { collectionId, ...f, file: { name: file.name, size: file.size, mime: mimeOf(file) } });
      await uploadFile(r.uploadPath, file, (p) => setProgress(`Uploading ${p}%`));
      await api("hubProcessVersion", { contentId: r.contentId, versionId: r.versionId });
      onClose(); nav(`/app/platform/hub/doc/${r.contentId}`);
    } catch (e) { setErr((e as Error).message); setProgress(null); }
  };
  return (
    <Modal open onClose={onClose} title="Add hub document" footer={<Button variant="primary" busy={!!progress} onClick={go}>{progress ?? "Upload"}</Button>}>
      <ErrorText error={err} />
      <input type="file" accept={ACCEPT} className="mb-4 block text-[15px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="File" />
      <TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <TextField label="Source (publisher)" placeholder="Federal Ministry of Health" value={f.sourceName} onChange={(e) => setF({ ...f, sourceName: e.target.value })} />
      <div className="grid grid-cols-2 gap-3"><TextField label="Publication date" type="date" value={f.publicationDate} onChange={(e) => setF({ ...f, publicationDate: e.target.value })} /><SelectField label="Type" value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value })} options={DOCUMENT_TYPES.map((d) => ({ value: d.id, label: d.label }))} /></div>
      <TextField label="Original link" type="url" value={f.originalUrl} onChange={(e) => setF({ ...f, originalUrl: e.target.value })} />
      <TextArea label="Description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
    </Modal>
  );
}

function HubDoc() {
  const { contentId = "" } = useParams();
  const { data: c } = useDoc<ContentItem>(doc(db, "hubContent", contentId));
  const versions = useQuery<ContentVersion>(query(collection(db, "hubContent", contentId, "versions"), orderBy("number", "desc")), `hv:${contentId}`);
  const [rights, setRights] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const v = versions.data?.[0];
  if (!c || !versions.data) return <Spinner />;
  const unchecked = v ? v.lowConfidencePages.filter((n) => !v.checkedPages.includes(n)) : [];
  return (
    <div>
      <PageHead title={c.title} sub={`${c.sourceName} · ${c.publicationDate}`} back={{ to: "/app/platform/hub", label: "Knowledge Hub" }} actions={c.published ? <Link className="btn btn-sm" to={`/app/hub/doc/${c.id}`}>View live</Link> : undefined} />
      <ErrorText error={err} />
      <div className="mb-4 flex gap-2"><StatusPill status={c.status} />{v && <StatusPill status={v.status} />}</div>
      {v && (v.status === "processing" || v.status === "uploading") && <Banner>Processing{v.processedPages ? `: ${v.processedPages} pages done` : "…"}</Banner>}
      {v?.processingError && <Banner tone="warn" title="Processing failed">{v.processingError} <button className="link" onClick={() => api("hubProcessVersion", { contentId, versionId: v.id }).catch((e) => setErr(e.message))}>Try again</button></Banner>}
      {v && unchecked.length > 0 && v.status === "draft" && <PageChecker hub instId="hub" content={c} version={v} onDone={() => toast("All pages checked")} />}
      {v && v.status === "draft" && !v.processingError && unchecked.length === 0 && (
        <section className="card mb-4 p-4">
          <h2 className="h2 mb-2">Publish to every hospital</h2>
          <Check label="I've checked we have the right to share this document with every subscribing hospital" checked={rights} onChange={setRights} />
          <Button variant="brand" disabled={!rights} onClick={() => api("hubPublish", { contentId, versionId: v.id, confirmRights: rights }).then(() => toast("Publishing")).catch((e) => setErr(e.message))}>Publish</Button>
        </section>
      )}
      {c.published && <ConfirmButton title="Archive?" confirmLabel="Archive" confirm="Hospitals will stop seeing it, and AI answers stop using it." onConfirm={() => api("hubArchive", { contentId, archived: true })}>Archive</ConfirmButton>}
      {c.status === "archived" && c.currentVersionId && <Button size="sm" onClick={() => api("hubArchive", { contentId, archived: false }).then(() => toast("Restored"))}>Restore</Button>}
    </div>
  );
}

function Config() {
  const plans = useQuery<Plan>(query(collection(db, "plans")), "plans");
  const [billing, setBilling] = useState<BillingConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getDoc(doc(db, "config", "billing")).then((d) => setBilling(d.data() as BillingConfig)).catch((e) => setErr(e.message)); }, []);
  return (
    <div>
      <PageHead title="Prices and payment" sub="Changes apply to new invoices. Amounts in naira." />
      <PNav />
      <ErrorText error={err} />
      <div className="grid gap-4 md:grid-cols-3">
        {(plans.data ?? []).sort((a, b) => a.order - b.order).map((p) => <PlanCard key={p.id} p={p} />)}
      </div>
      {billing && <BillingCard b={billing} />}
    </div>
  );
}

function PlanCard({ p }: { p: Plan }) {
  const [f, setF] = useState({ priceMonthly: naira(p.priceMonthly), priceAnnual: naira(p.priceAnnual), seatLimit: p.seatLimit ?? "", docLimit: p.docLimit ?? "", aiQuestionLimit: p.aiQuestionLimit ?? "", extraSeatBlockPrice: naira(p.extraSeatBlockPrice), paystackPlanCodeMonthly: p.paystackPlanCodeMonthly ?? "", paystackPlanCodeAnnual: p.paystackPlanCodeAnnual ?? "" });
  const num = (v: number | string) => (v === "" ? null : Number(v));
  return (
    <section className="card p-4">
      <h2 className="h2 mb-2">{p.name}</h2>
      <TextField label="Monthly ₦" type="number" value={f.priceMonthly} onChange={(e) => setF({ ...f, priceMonthly: Number(e.target.value) })} />
      <TextField label="Yearly ₦" type="number" value={f.priceAnnual} onChange={(e) => setF({ ...f, priceAnnual: Number(e.target.value) })} />
      <TextField label="Seats (blank = unlimited)" type="number" value={f.seatLimit} onChange={(e) => setF({ ...f, seatLimit: e.target.value })} />
      <TextField label="Documents" type="number" value={f.docLimit} onChange={(e) => setF({ ...f, docLimit: e.target.value })} />
      <TextField label="AI questions / month" type="number" value={f.aiQuestionLimit} onChange={(e) => setF({ ...f, aiQuestionLimit: e.target.value })} />
      <TextField label="10 extra seats ₦/month" type="number" value={f.extraSeatBlockPrice} onChange={(e) => setF({ ...f, extraSeatBlockPrice: Number(e.target.value) })} />
      <TextField label="Paystack plan code (monthly)" value={f.paystackPlanCodeMonthly} onChange={(e) => setF({ ...f, paystackPlanCodeMonthly: e.target.value })} />
      <TextField label="Paystack plan code (yearly)" value={f.paystackPlanCodeAnnual} onChange={(e) => setF({ ...f, paystackPlanCodeAnnual: e.target.value })} />
      <Button onClick={() => api("platformUpdatePlan", { planId: p.id, fields: { priceMonthly: f.priceMonthly * 100, priceAnnual: f.priceAnnual * 100, seatLimit: num(f.seatLimit), docLimit: num(f.docLimit), aiQuestionLimit: num(f.aiQuestionLimit), extraSeatBlockPrice: f.extraSeatBlockPrice * 100, paystackPlanCodeMonthly: f.paystackPlanCodeMonthly, paystackPlanCodeAnnual: f.paystackPlanCodeAnnual } }).then(() => toast("Saved")).catch((e) => toast(e.message))}>Save {p.name}</Button>
    </section>
  );
}

function BillingCard({ b }: { b: BillingConfig }) {
  const [f, setF] = useState({ paystackEnabled: b.paystackEnabled, bankTransfer: b.bankTransfer, supportEmail: b.supportEmail, companyAddress: b.companyAddress, vatPct: b.vatPct, extraPagePrice: naira(b.extraPagePrice) });
  return (
    <section className="card mt-5 max-w-2xl p-4">
      <h2 className="h2 mb-3">Payment settings</h2>
      <Check label="Online payment with Paystack" help="Needs the Paystack secret key to be set on the server. Until then, hospitals pay by bank transfer." checked={f.paystackEnabled} onChange={(v) => setF({ ...f, paystackEnabled: v })} />
      <div className="grid gap-x-3 sm:grid-cols-2">
        <TextField label="Account name" value={f.bankTransfer.accountName} onChange={(e) => setF({ ...f, bankTransfer: { ...f.bankTransfer, accountName: e.target.value } })} />
        <TextField label="Bank" value={f.bankTransfer.bankName} onChange={(e) => setF({ ...f, bankTransfer: { ...f.bankTransfer, bankName: e.target.value } })} />
        <TextField label="Account number" value={f.bankTransfer.accountNumber} onChange={(e) => setF({ ...f, bankTransfer: { ...f.bankTransfer, accountNumber: e.target.value } })} />
        <TextField label="VAT %" type="number" value={f.vatPct} onChange={(e) => setF({ ...f, vatPct: Number(e.target.value) })} />
        <TextField label="Extra digitisation page ₦" type="number" value={f.extraPagePrice} onChange={(e) => setF({ ...f, extraPagePrice: Number(e.target.value) })} />
        <TextField label="Support email" type="email" value={f.supportEmail} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} />
      </div>
      <TextArea label="Note on invoices" rows={2} value={f.bankTransfer.note} onChange={(e) => setF({ ...f, bankTransfer: { ...f.bankTransfer, note: e.target.value } })} />
      <TextArea label="Company address" rows={2} value={f.companyAddress} onChange={(e) => setF({ ...f, companyAddress: e.target.value })} />
      <Button variant="primary" onClick={() => api("platformUpdateBillingConfig", { fields: { ...f, extraPagePrice: f.extraPagePrice * 100 } }).then(() => toast("Saved")).catch((e) => toast(e.message))}>Save</Button>
    </section>
  );
}

function Health() {
  const [h, setH] = useState<{ ok: boolean; at: string; ingestion: { processing: number; stuck: string[]; failedLast24h: { id: string; title: string; institution: string }[]; pagesAwaitingCheck: number }; configured: Record<string, boolean>; hubCorpusVersion: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { setH(null); api<typeof h>("platformHealth").then(setH).catch((e) => setErr(e.message)); };
  useEffect(load, []);
  const names: Record<string, string> = { anthropic: "AI answers (Anthropic key)", documentAi: "OCR (Document AI processor)", email: "Email (Resend key)", paystack: "Paystack (secret key)" };
  return (
    <div>
      <PageHead title="Health" actions={<Button size="sm" onClick={load}>Refresh</Button>} />
      <PNav />
      <ErrorText error={err} />
      {!h ? (!err && <Spinner />) : (
        <>
          <Banner tone={h.ok ? "ok" : "warn"} title={h.ok ? "All good" : "Needs attention"}>Checked {fmtDateTime(h.at)}.</Banner>
          <div className="grid gap-3 md:grid-cols-2">
            <section className="card p-4"><h2 className="h2 mb-2">Configuration</h2><ul>{Object.entries(h.configured).map(([k, v]) => <li key={k} className="flex justify-between py-1"><span>{names[k] ?? k}</span><span className={cx("pill", v ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn")}>{v ? "Set" : "Missing"}</span></li>)}</ul></section>
            <section className="card p-4"><h2 className="h2 mb-2">Processing</h2><p>{h.ingestion.processing} processing now · {h.ingestion.stuck.length} stuck over 30 min · {h.ingestion.pagesAwaitingCheck} awaiting page checks</p>{h.ingestion.failedLast24h.length > 0 && <ul className="mt-2 text-[14px] text-warn">{h.ingestion.failedLast24h.map((f) => <li key={f.id}>{f.institution}: {f.title}</li>)}</ul>}<p className="mt-2 text-[13px] text-ink-2">Hub corpus version {h.hubCorpusVersion}</p></section>
          </div>
        </>
      )}
    </div>
  );
}

export default function Platform() {
  const s = useSession();
  if (!s.platformAdmin) return null;
  return (
    <Routes>
      <Route index element={<Institutions />} />
      <Route path="i/:instId" element={<InstitutionDetail />} />
      <Route path="digitisation" element={<Digitisation />} />
      <Route path="hub" element={<HubHome />} />
      <Route path="hub/doc/:contentId" element={<HubDoc />} />
      <Route path="config" element={<Config />} />
      <Route path="health" element={<Health />} />
    </Routes>
  );
}
