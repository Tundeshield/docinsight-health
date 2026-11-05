import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { Download } from "lucide-react";
import { db } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { downloadFile } from "../../lib/storage";
import { fmtDate, formatMoney } from "../../lib/format";
import { Banner, Button, ConfirmButton, ErrorText, Modal, PageHead, Spinner, Stat, StatusPill, cx, toast } from "../../components/ui";
import type { BillingCycle, Invoice, Plan, PlanId, SetupPackage } from "../../../../shared/src/types";
import { AdminNav } from "./shared";

interface Lim { used: number; limit: number | null; state: "ok" | "warn" | "blocked" }
interface Summary {
  status: string; statusLabel: string; planId: PlanId; billingCycle: BillingCycle; currentPeriodEnd: string | null; pastDueSince: string | null;
  pilot: { endsAt: string; discountPct: number } | null; discountPct: number; cancelAtPeriodEnd: boolean; seats: Lim; docs: Lim; questions: Lim;
  plans: Plan[]; setupPackages: SetupPackage[]; paystackEnabled: boolean; bankTransfer: { accountName: string; bankName: string; accountNumber: string; note: string };
  openInvoices: { id: string; number: string; amount: number; currency: string; dueAt: string; method: string | null; kind: string }[]; isOwner: boolean;
}

function Meter({ label, l, unit }: { label: string; l: Lim; unit: string }) {
  const pct = l.limit ? Math.min(100, (l.used / l.limit) * 100) : 0;
  return (
    <div className="card px-4 py-3">
      <div className="flex justify-between text-sm"><span className="text-ink-2">{label}</span>{l.state !== "ok" && <span className={cx("pill", l.state === "blocked" ? "bg-warn-bg text-warn" : "bg-soft text-ink")}>{l.state === "blocked" ? "Limit reached" : "Nearly full"}</span>}</div>
      <div className="text-xl font-bold tabular-nums">{l.used.toLocaleString()}<span className="text-base font-normal text-ink-2"> / {l.limit == null ? "unlimited" : l.limit.toLocaleString()} {unit}</span></div>
      {l.limit != null && <div className="mt-2 h-2 rounded-full bg-soft"><div className={cx("h-2 rounded-full", l.state === "blocked" ? "bg-warn" : "bg-brand")} style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

export default function Billing() {
  const s = useSession();
  const [params] = useSearchParams();
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bank, setBank] = useState<{ number: string; amount: number } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planId, setPlanId] = useState<PlanId>("clinic");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [blocks, setBlocks] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const invoices = useQuery<Invoice>(s.isOwner ? query(collection(db, "institutions", s.instId!, "invoices"), orderBy("issuedAt", "desc"), limit(30)) : null, `invs:${s.instId}:${s.isOwner}`);
  const load = () => api<Summary>("getBillingSummary", { instId: s.instId }).then((r) => { setSum(r); setPlanId(r.planId); setCycle(r.billingCycle); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [s.instId, s.inst?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (k: string, fn: () => Promise<unknown>) => { setBusy(k); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  if (!sum) return <><PageHead title="Billing" /><AdminNav /><ErrorText error={err} />{!err && <Spinner />}</>;
  const plan = sum.plans.find((p) => p.id === sum.planId);
  const pay = (invoiceId: string) => run(`pay:${invoiceId}`, async () => { const r = await api<{ url: string }>("startPaystackPayment", { instId: s.instId, invoiceId, recurring: true }); location.href = r.url; });
  const transfer = (invoiceId: string) => run(`bank:${invoiceId}`, async () => { const r = await api<{ number: string; amount: number }>("chooseBankTransfer", { instId: s.instId, invoiceId }); setBank(r); });

  return (
    <div>
      <PageHead title="Billing" sub={<>Status: <StatusPill status={sum.status} /></>} />
      <AdminNav />
      <ErrorText error={err} />
      {params.get("paid") && <Banner tone="ok" title="Thank you">We're confirming your payment with Paystack. This page updates automatically, usually within a minute.</Banner>}
      {sum.status === "pending_payment" && <Banner title="Pay the first invoice to open staff invites">Until then you can set up spaces, upload documents and invite admins.</Banner>}
      {sum.status === "past_due" && <Banner tone="warn" title="Payment is overdue">If it isn't received within 15 days of the due date, DocInsight becomes read-only. After 45 days, staff lose access. Nothing is deleted.</Banner>}
      {(sum.status === "restricted" || sum.status === "suspended") && <Banner tone="warn" title={sum.status === "restricted" ? "Read-only" : "Suspended"}>Pay the open invoice to restore full access straight away.</Banner>}
      {sum.cancelAtPeriodEnd && <Banner tone="warn" title="Cancelling">Your subscription ends on {fmtDate(sum.currentPeriodEnd)}. Data is kept for 90 days after that.</Banner>}
      {sum.pilot && <Banner tone="ok" title="Pilot">{sum.pilot.discountPct}% off until {fmtDate(sum.pilot.endsAt)}.</Banner>}

      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Plan" value={plan?.name ?? sum.planId} sub={`${sum.billingCycle === "annual" ? "Yearly" : "Monthly"}${plan && !plan.quoted ? `, ${formatMoney(sum.billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly, plan.currency)}` : ""}${sum.discountPct ? `, ${sum.discountPct}% discount` : ""}`} />
        <Stat label="Paid until" value={sum.currentPeriodEnd ? fmtDate(sum.currentPeriodEnd) : "Not yet paid"} />
        <Stat label="Open invoices" value={sum.openInvoices.length} />
      </div>
      <h2 className="h2 mb-3 mt-6">Usage</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <Meter label="Staff seats" l={sum.seats} unit="seats" />
        <Meter label="Documents" l={sum.docs} unit="docs" />
        <Meter label="AI questions this month" l={sum.questions} unit="" />
      </div>
      {sum.questions.state === "blocked" && <p className="mt-2 text-[14px] text-warn">Ask DocInsight is paused until next month or an upgrade. Search still works.</p>}

      {sum.openInvoices.length > 0 && (
        <section className="mt-6">
          <h2 className="h2 mb-3">To pay</h2>
          <ul className="grid gap-3">
            {sum.openInvoices.map((i) => (
              <li key={i.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span><b>{i.number}</b> · {formatMoney(i.amount, i.currency)}<span className="block text-[14px] text-ink-2">Due {fmtDate(i.dueAt)}{i.method === "bank_transfer" ? " · bank transfer chosen" : ""}</span></span>
                {sum.isOwner ? (
                  <span className="flex flex-wrap gap-2">
                    {sum.paystackEnabled && <Button variant="brand" busy={busy === `pay:${i.id}`} onClick={() => pay(i.id)}>Pay by card, transfer or USSD</Button>}
                    <Button busy={busy === `bank:${i.id}`} onClick={() => transfer(i.id)}>Pay by bank transfer</Button>
                  </span>
                ) : <span className="text-[14px] text-ink-2">The owner pays invoices.</span>}
              </li>
            ))}
          </ul>
          {!sum.paystackEnabled && <p className="mt-2 text-[14px] text-ink-2">Online payment is coming soon. Pay by bank transfer and the DocInsight team will confirm it.</p>}
        </section>
      )}

      {sum.isOwner && (
        <section className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => setPlanOpen(true)}>Change plan</Button>
          {plan?.seatLimit != null && <span className="flex items-center gap-2"><select className="input w-auto" value={blocks} onChange={(e) => setBlocks(Number(e.target.value))} aria-label="Seat blocks">{[1, 2, 3, 5, 10].map((b) => <option key={b} value={b}>{b * 10} seats</option>)}</select><Button busy={busy === "seats"} onClick={() => run("seats", async () => { await api("buySeats", { instId: s.instId, blocks }); toast("Invoice created for extra seats"); load(); })}>Add seats{plan ? ` (${formatMoney(plan.extraSeatBlockPrice * blocks, plan.currency)}/month)` : ""}</Button></span>}
          {sum.cancelAtPeriodEnd
            ? <Button onClick={() => run("undo", async () => { await api("cancelSubscription", { instId: s.instId, undo: true }); load(); toast("Cancellation withdrawn"); })}>Keep my subscription</Button>
            : sum.currentPeriodEnd && <ConfirmButton title="Cancel subscription?" confirmLabel="Cancel at period end" confirm={`Access continues until ${fmtDate(sum.currentPeriodEnd)}. After that staff lose access and your data is kept for 90 days so you can export it.`} onConfirm={async () => { await api("cancelSubscription", { instId: s.instId }); load(); }}>Cancel subscription</ConfirmButton>}
        </section>
      )}

      {s.isOwner && (
        <section className="mt-6">
          <h2 className="h2 mb-3">Invoices and receipts</h2>
          {!invoices.data ? <Spinner /> : invoices.data.length === 0 ? <p className="text-ink-2">No invoices yet.</p> : (
            <ul className="card divide-y divide-rule">
              {invoices.data.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span><b>{i.number}</b> <StatusPill status={i.status} /><span className="block text-[13px] text-ink-2">{i.lines.map((l) => l.description).join("; ")} · {formatMoney(i.amount, i.currency)} · {fmtDate(i.issuedAt)}</span></span>
                  <span className="flex gap-1">
                    {i.pdfRef && <Button size="sm" variant="ghost" onClick={() => downloadFile(i.pdfRef!, `${i.number}.pdf`).catch(() => toast("Couldn't download"))}><Download className="h-4 w-4" />Invoice</Button>}
                    {i.receiptRef && <Button size="sm" variant="ghost" onClick={() => downloadFile(i.receiptRef!, `${i.number}-receipt.pdf`).catch(() => toast("Couldn't download"))}><Download className="h-4 w-4" />Receipt</Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="mt-6">
        <h2 className="h2 mb-2">Export your data</h2>
        <p className="mb-3 text-[15px] text-ink-2">A list of every document, with links to download the originals. Always available, even if the subscription lapses.</p>
        <Button busy={busy === "export"} onClick={() => run("export", async () => { const r = await api<{ indexPath: string; files: { title: string; path: string }[] }>("exportContentIndex", { instId: s.instId }); await downloadFile(r.indexPath, "content-index.csv"); toast(`Index downloaded. ${r.files.length} original files available.`); })}><Download className="h-4 w-4" />Download content index</Button>
      </section>

      <Modal open={bank !== null} onClose={() => setBank(null)} title="Pay by bank transfer">
        {bank && <div className="space-y-2 text-[16px]">
          <p>Transfer <b>{formatMoney(bank.amount, "NGN")}</b> to:</p>
          <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-4"><dt className="text-ink-2">Account name</dt><dd className="font-bold">{sum.bankTransfer.accountName}</dd><dt className="text-ink-2">Bank</dt><dd className="font-bold">{sum.bankTransfer.bankName}</dd><dt className="text-ink-2">Account number</dt><dd className="font-mono font-bold">{sum.bankTransfer.accountNumber}</dd><dt className="text-ink-2">Reference</dt><dd className="font-mono font-bold">{bank.number}</dd></dl>
          <p className="text-[14px] text-ink-2">{sum.bankTransfer.note || "Use the invoice number as the reference. We'll confirm within one working day and email a receipt."}</p>
        </div>}
      </Modal>
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title="Change plan" footer={<Button variant="primary" busy={busy === "plan"} onClick={() => run("plan", async () => { const r = await api<{ message: string }>("changePlan", { instId: s.instId, planId, billingCycle: cycle }); toast(r.message); setPlanOpen(false); load(); })}>Confirm</Button>}>
        <div className="grid gap-2">
          {sum.plans.map((p) => (
            <label key={p.id} className={cx("card flex cursor-pointer items-start gap-3 p-3", planId === p.id && "border-2 border-brand")}>
              <input type="radio" name="plan" className="mt-1 h-5 w-5" checked={planId === p.id} onChange={() => setPlanId(p.id)} />
              <span><b>{p.name}</b> {p.quoted ? "(quoted)" : `· ${formatMoney(cycle === "annual" ? p.priceAnnual : p.priceMonthly, p.currency)}/${cycle === "annual" ? "year" : "month"}`}<span className="block text-sm text-ink-2">{p.features.slice(0, 4).join(" · ")}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">{(["monthly", "annual"] as const).map((c) => <button key={c} className={cx("btn flex-1", cycle === c && "btn-primary")} onClick={() => setCycle(c)}>{c === "monthly" ? "Monthly" : "Yearly"}</button>)}</div>
      </Modal>
    </div>
  );
}
