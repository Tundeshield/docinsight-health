import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { BellRing, BookCheck, FileSearch, MessageCircleQuestion, ShieldCheck, WifiOff } from "lucide-react";
import { db } from "../../lib/firebase";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/AppShell";
import { DEFAULT_PLANS, DEFAULT_BILLING_CONFIG } from "../../../../shared/src/config";
import { formatMoney } from "../../../../shared/src/billing";
import type { Plan } from "../../../../shared/src/types";

const FEATURES = [
  { icon: FileSearch, title: "Every protocol in one place", body: "Upload PDFs, Word files and scanned pages. Scans are read automatically, and each page is checked before it goes live." },
  { icon: MessageCircleQuestion, title: "Ask, and see the source", body: "Ask a question in plain English. The answer quotes your own approved documents, and every line links to the page it came from." },
  { icon: BookCheck, title: "Approved before anyone relies on it", body: "Clinical documents need a named approver. Old versions stop being used the moment a new one is approved." },
  { icon: BellRing, title: "Changes reach the people who need them", body: "Staff are told when a protocol changes. Mark it must-read and see who has acknowledged it, ready for accreditation." },
  { icon: WifiOff, title: "Works on a weak connection", body: "Built for 3G and shared Android phones. Save key documents to open with no network at all." },
  { icon: ShieldCheck, title: "Your hospital's data stays yours", body: "Each hospital is kept separate. Staff only see the departments they belong to. Every change is logged." },
];

export default function Landing() {
  const s = useSession();
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  useEffect(() => {
    getDocs(collection(db, "plans")).then((snap) => {
      const p = snap.docs.map((d) => d.data() as Plan).filter((x) => x.active).sort((a, b) => a.order - b.order);
      if (p.length) setPlans(p);
    }).catch(() => undefined);
  }, []);
  const setup = DEFAULT_BILLING_CONFIG.setupPackages;
  return (
    <div className="min-h-screen bg-page">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
        <Link to="/"><Logo /></Link>
        <nav className="flex items-center gap-2">
          <a href="#pricing" className="btn btn-ghost btn-sm hidden sm:inline-flex">Pricing</a>
          {s.user ? <Link to="/app" className="btn btn-primary btn-sm">Open DocInsight</Link> : <><Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link><Link to="/signup" className="btn btn-primary btn-sm">Get started</Link></>}
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-14 pt-8 md:pt-16">
        <p className="mb-3 font-bold text-brand">For hospitals and clinics in Nigeria</p>
        <h1 className="max-w-3xl text-[34px] font-bold leading-[1.1] tracking-tight md:text-6xl">The right protocol, on the ward, in seconds.</h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-2 md:text-xl">DocInsight Health turns your hospital's protocols, SOPs and equipment manuals into one searchable library. Staff ask a question and get an answer quoted from your approved documents, with the page to check.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={s.user ? "/setup" : "/signup?next=/setup"} className="btn btn-brand">Set up your hospital</Link>
          <Link to="/join" className="btn">I have a join code</Link>
        </div>
        <div className="card mt-10 max-w-3xl p-4 md:p-6" aria-label="Example answer">
          <p className="text-sm font-bold text-ink-2">A nurse asks</p>
          <p className="mt-1 text-lg font-bold">What's the first-line dose for eclampsia in our protocol?</p>
          <div className="mt-4 rounded-xl bg-soft p-4">
            <p className="text-[15px]">Give the loading dose by IV over 15 to 20 minutes, then start the maintenance infusion <sup className="font-bold text-brand">[1]</sup>. Check reflexes and urine output every hour <sup className="font-bold text-brand">[1]</sup>.</p>
            <p className="mt-3 text-sm"><span className="pill bg-ok-bg text-ok">Hospital protocol</span> <span className="font-bold">[1] Management of severe pre-eclampsia, v3, page 4</span></p>
          </div>
          <p className="mt-3 text-[13px] text-ink-2">Example only. Answers come from your own approved documents. DocInsight supports, and does not replace, clinical judgement.</p>
        </div>
      </section>

      <section className="border-y border-rule bg-surface">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <f.icon className="h-7 w-7 text-brand" aria-hidden />
              <h2 className="mt-3 text-lg font-bold">{f.title}</h2>
              <p className="mt-1 text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="h1">Pricing</h2>
        <p className="mt-2 max-w-2xl text-ink-2">Priced per institution, in naira. Pay yearly and get 12 months for the price of 10. Pay by card, bank transfer or USSD, or by invoice.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className={`card flex flex-col p-5 ${p.id === "hospital" ? "border-2 border-brand" : ""}`}>
              <h3 className="text-xl font-bold">{p.name}</h3>
              <p className="mt-1 text-ink-2">{p.description}</p>
              <p className="mt-4"><span className="text-3xl font-bold">{p.quoted ? "From " : ""}{formatMoney(p.priceMonthly, p.currency)}</span><span className="text-ink-2"> / month</span></p>
              <ul className="mt-4 flex-1 space-y-2 text-[15px]">{p.features.map((f) => <li key={f} className="flex gap-2"><span className="text-brand" aria-hidden>✓</span>{f}</li>)}</ul>
              <Link to={s.user ? "/setup" : "/signup?next=/setup"} className={`btn mt-6 ${p.id === "hospital" ? "btn-brand" : ""}`}>{p.quoted ? "Talk to us" : "Choose " + p.name}</Link>
            </div>
          ))}
        </div>
        <div className="card mt-6 p-5">
          <h3 className="text-lg font-bold">One-off setup and digitisation</h3>
          <p className="mt-1 text-ink-2">We scan, read and organise your existing paper documents, and train your staff.</p>
          <ul className="mt-3 grid gap-2 text-[15px] sm:grid-cols-2">
            {setup.map((p) => <li key={p.id}><b>{p.name}: {formatMoney(p.price, p.currency)}</b><span className="block text-ink-2">{p.includes}</span></li>)}
          </ul>
          <p className="mt-3 text-sm text-ink-2">Early hospitals can join a 60-day pilot at half price.</p>
        </div>
      </section>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-2">
          <span>© {new Date().getFullYear()} Avelon Health Technologies Limited, RC 8342636. Lagos, Nigeria.</span>
          <span className="flex gap-4"><Link to="/legal/privacy" className="hover:text-ink">Privacy</Link><Link to="/legal/terms" className="hover:text-ink">Terms</Link><Link to="/legal/clinical-safety" className="hover:text-ink">Clinical safety</Link></span>
        </div>
      </footer>
    </div>
  );
}
