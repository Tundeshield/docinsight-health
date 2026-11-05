import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { Plus, Trash2 } from "lucide-react";
import { db } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/AppShell";
import { Banner, Button, Check, ErrorText, TextField, cx } from "../../components/ui";
import { DEFAULT_BILLING_CONFIG, DEFAULT_PLANS, SPACE_TEMPLATES } from "../../../../shared/src/config";
import { formatMoney, periodPrice } from "../../../../shared/src/billing";
import type { BillingConfig, BillingCycle, Plan, PlanId } from "../../../../shared/src/types";

const STEPS = ["Institution", "Sites", "Departments", "Admins", "Plan"] as const;
const COLOURS = ["#0E7A68", "#12302A", "#2E55D0", "#7446BF", "#B4441C", "#C2417A", "#A85A12"];

export default function Setup() {
  const s = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [billing, setBilling] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(COLOURS[0]);
  const [yourName, setYourName] = useState(s.user?.displayName ?? "");
  const [sites, setSites] = useState([{ name: "Main site", address: "" }]);
  const [templates, setTemplates] = useState<string[]>(["hospital-wide", "emergency", "nursing", "pharmacy"]);
  const [admins, setAdmins] = useState<{ name: string; email: string }[]>([]);
  const [planId, setPlanId] = useState<PlanId>("clinic");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [pkg, setPkg] = useState<"standard" | "large" | "none">("standard");
  const [contact, setContact] = useState({ name: s.user?.displayName ?? "", email: s.user?.email ?? "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getDocs(collection(db, "plans")).then((snap) => { const p = snap.docs.map((d) => d.data() as Plan).filter((x) => x.active).sort((a, b) => a.order - b.order); if (p.length) setPlans(p); }).catch(() => undefined);
    getDoc(doc(db, "config", "billing")).then((d) => { if (d.exists()) setBilling(d.data() as BillingConfig); }).catch(() => undefined);
  }, []);

  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const validate = (): string | null => {
    if (step === 0 && name.trim().length < 2) return "Enter your institution's name.";
    if (step === 1 && !sites.some((x) => x.name.trim())) return "Add at least one site.";
    if (step === 1 && plan.siteLimit != null && sites.filter((x) => x.name.trim()).length > plan.siteLimit && planId !== "group") return null;
    if (step === 2 && !templates.length) return "Choose at least one department. You can add more later.";
    if (step === 3 && admins.some((a) => a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email))) return "Check the admin email addresses.";
    if (step === 4 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return "Enter a billing email address.";
    return null;
  };
  const next = () => { const e = validate(); setErr(e); if (!e) setStep((x) => x + 1); };

  const create = async () => {
    const e = validate(); if (e) return setErr(e);
    setBusy(true); setErr(null);
    try {
      const r = await api<{ instId: string }>("createInstitution", {
        name: name.trim(), colour, country: "NG", yourName, sites: sites.filter((x) => x.name.trim()), templates,
        admins: admins.filter((a) => a.email.trim()), planId, billingCycle: cycle, setupPackageId: pkg, billingContact: contact,
      });
      await s.refresh();
      s.switchInstitution(r.instId);
      nav("/app/admin?welcome=1", { replace: true });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const multiSite = sites.filter((x) => x.name.trim()).length > 1;
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between"><Link to="/"><Logo /></Link><Link to="/app" className="text-sm font-bold text-ink-2">Cancel</Link></div>
      <ol className="mt-8 flex gap-1" aria-label="Setup steps">
        {STEPS.map((t, i) => <li key={t} className={cx("h-1.5 flex-1 rounded-full", i <= step ? "bg-brand" : "bg-rule")} aria-current={i === step ? "step" : undefined}><span className="sr-only">{t}</span></li>)}
      </ol>
      <p className="mt-3 text-sm font-bold text-ink-2">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
      <div className="mt-4">
        <ErrorText error={err} />
        {step === 0 && (
          <>
            <h1 className="h1 mb-4">Set up your institution</h1>
            <TextField label="Institution name" placeholder="e.g. Lakeside Specialist Hospital" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField label="Your name" value={yourName} onChange={(e) => setYourName(e.target.value)} help="You'll be the owner. You can hand ownership to someone else later." />
            <fieldset className="mb-4">
              <legend className="label">Colour</legend>
              <div className="flex flex-wrap gap-2">
                {COLOURS.map((c) => <button key={c} type="button" onClick={() => setColour(c)} aria-label={`Colour ${c}`} aria-pressed={colour === c} className={cx("h-11 w-11 rounded-full border-4", colour === c ? "border-ink" : "border-transparent")} style={{ background: c }} />)}
              </div>
              <span className="help">You can upload your logo after setup.</span>
            </fieldset>
          </>
        )}
        {step === 1 && (
          <>
            <h1 className="h1 mb-1">Sites</h1>
            <p className="mb-4 text-ink-2">Most institutions have one. Hospital groups can add each hospital.</p>
            {sites.map((site, i) => (
              <div key={i} className="card mb-3 p-4">
                <TextField label={`Site ${i + 1} name`} value={site.name} onChange={(e) => setSites(sites.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <TextField label="Address (optional)" value={site.address} onChange={(e) => setSites(sites.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} className="mb-1" />
                {sites.length > 1 && <Button size="sm" variant="ghost" onClick={() => setSites(sites.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" />Remove</Button>}
              </div>
            ))}
            <Button onClick={() => setSites([...sites, { name: "", address: "" }])}><Plus className="h-4 w-4" />Add a site</Button>
            {multiSite && <Banner>More than one site needs the Group plan. We'll select it for you on the last step.</Banner>}
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="h1 mb-1">Departments</h1>
            <p className="mb-4 text-ink-2">Each becomes a space with ready-made sections. Clinical spaces need a named approver before anything goes live.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SPACE_TEMPLATES.map((t) => (
                <label key={t.key} className={cx("card flex cursor-pointer items-start gap-3 p-3", templates.includes(t.key) && "border-brand")}>
                  <input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--brand))]" checked={templates.includes(t.key)} onChange={(e) => setTemplates(e.target.checked ? [...templates, t.key] : templates.filter((k) => k !== t.key))} />
                  <span><span className="font-bold">{t.name}</span><span className="block text-sm text-ink-2">{t.sections.join(", ")}{t.visibility === "restricted" && " · restricted"}</span></span>
                </label>
              ))}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h1 className="h1 mb-1">Other administrators</h1>
            <p className="mb-4 text-ink-2">Optional. Admins can upload documents and invite staff. You can invite everyone else after setup.</p>
            {admins.map((a, i) => (
              <div key={i} className="card mb-3 grid gap-x-3 p-4 sm:grid-cols-2">
                <TextField label="Name" value={a.name} onChange={(e) => setAdmins(admins.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <TextField label="Email" type="email" value={a.email} onChange={(e) => setAdmins(admins.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setAdmins(admins.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" />Remove</Button>
              </div>
            ))}
            <Button onClick={() => setAdmins([...admins, { name: "", email: "" }])}><Plus className="h-4 w-4" />Add an admin</Button>
          </>
        )}
        {step === 4 && (
          <>
            <h1 className="h1 mb-4">Plan and billing</h1>
            <div className="mb-4 grid gap-2">
              {plans.map((p) => {
                const disabled = multiSite && p.siteLimit != null && p.siteLimit < 2;
                return (
                  <label key={p.id} className={cx("card flex cursor-pointer items-start gap-3 p-4", planId === p.id && "border-2 border-brand", disabled && "opacity-50")}>
                    <input type="radio" name="plan" className="mt-1 h-5 w-5 accent-[rgb(var(--brand))]" disabled={disabled} checked={planId === p.id} onChange={() => setPlanId(p.id)} />
                    <span className="flex-1">
                      <span className="flex flex-wrap justify-between gap-2"><b>{p.name}</b><b>{p.quoted ? "From " : ""}{formatMoney(cycle === "annual" ? p.priceAnnual : p.priceMonthly, p.currency)}<span className="font-normal text-ink-2">/{cycle === "annual" ? "year" : "month"}</span></b></span>
                      <span className="block text-sm text-ink-2">{p.features.slice(0, 4).join(" · ")}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <fieldset className="mb-4">
              <legend className="label">Billing cycle</legend>
              <div className="flex gap-2">
                {(["monthly", "annual"] as const).map((c) => <button key={c} type="button" className={cx("btn flex-1", cycle === c && "btn-primary")} onClick={() => setCycle(c)}>{c === "monthly" ? "Monthly" : "Yearly (2 months free)"}</button>)}
              </div>
            </fieldset>
            <fieldset className="mb-4">
              <legend className="label">Setup and digitisation</legend>
              {billing.setupPackages.map((p) => (
                <label key={p.id} className="mb-2 flex items-start gap-3"><input type="radio" name="pkg" className="mt-1 h-5 w-5 accent-[rgb(var(--brand))]" checked={pkg === p.id} onChange={() => setPkg(p.id)} /><span><b>{p.name}, {formatMoney(p.price, p.currency)}</b><span className="block text-sm text-ink-2">{p.includes}</span></span></label>
              ))}
              <label className="flex items-start gap-3"><input type="radio" name="pkg" className="mt-1 h-5 w-5 accent-[rgb(var(--brand))]" checked={pkg === "none"} onChange={() => setPkg("none")} /><span><b>No setup package</b><span className="block text-sm text-ink-2">We'll upload our own documents.</span></span></label>
            </fieldset>
            <h2 className="h2 mb-2 mt-6">Billing contact</h2>
            <TextField label="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            <TextField label="Email for invoices" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            <TextField label="Phone" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            {!plan.quoted && (
              <div className="card mb-4 p-4 text-[15px]">
                <div className="flex justify-between"><span>{plan.name}, {cycle === "annual" ? "first year" : "first month"}</span><b>{formatMoney(periodPrice(plan, cycle), plan.currency)}</b></div>
                {pkg !== "none" && <div className="flex justify-between"><span>Setup ({pkg})</span><b>{formatMoney(billing.setupPackages.find((p) => p.id === pkg)?.price ?? 0, "NGN")}</b></div>}
                <p className="mt-2 text-sm text-ink-2">Your institution starts as <b>pending payment</b>. You can build your library and invite admins straight away. Staff invites open once the first invoice is paid by card, transfer or USSD.</p>
              </div>
            )}
            <Check label="I agree to the terms and privacy notice for my institution" checked={true} onChange={() => undefined} disabled />
          </>
        )}
      </div>
      <div className="sticky bottom-0 -mx-4 mt-6 flex justify-between gap-2 border-t border-rule bg-page px-4 py-3">
        <Button onClick={() => (step ? setStep(step - 1) : nav(-1))}>Back</Button>
        {step < STEPS.length - 1 ? <Button variant="primary" onClick={() => { if (step === 1 && multiSite) setPlanId("group"); next(); }}>Continue</Button> : <Button variant="brand" busy={busy} onClick={create}>Create institution</Button>}
      </div>
    </main>
  );
}
