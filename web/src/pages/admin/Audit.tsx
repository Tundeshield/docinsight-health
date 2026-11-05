import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { downloadFile } from "../../lib/storage";
import { fmtDateTime } from "../../lib/format";
import { Button, Empty, ErrorText, PageHead, Spinner, TextField, toast } from "../../components/ui";
import { AdminNav } from "./shared";
import type { AuditEntry } from "../../../../shared/src/types";

const LABEL: Record<string, string> = {
  signin: "Signed in", "institution.create": "Created institution", "institution.update": "Changed institution settings", "institution.status": "Billing status changed",
  "site.create": "Added site", "site.update": "Changed site", "space.create": "Created space", "space.update": "Changed space", "space.archive": "Archived space",
  "section.create": "Added section", "section.update": "Changed section", "section.archive": "Archived section",
  "member.invite": "Invited", "member.join": "Joined", "member.update": "Changed member", "member.remove": "Deactivated member", "member.signout": "Forced sign-out",
  "content.create": "Created document", "content.update": "Changed document", "content.archive": "Archived/restored document", "content.must_read": "Must read changed",
  "version.upload": "Uploaded version", "version.submit": "Submitted for approval", "version.approve": "Approved", "version.reject": "Rejected", "version.changes_requested": "Requested changes", "version.publish": "Published", "version.pages_corrected": "Checked scanned pages",
  acknowledge: "Acknowledged", "billing.plan": "Changed plan", "billing.invoice": "Invoice", "billing.payment": "Payment", "billing.discount": "Discount", "billing.pilot": "Pilot", "settings.update": "Changed settings", export: "Exported",
};

export default function Audit() {
  const s = useSession();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entries, setEntries] = useState<(AuditEntry & { at: string })[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = () => { setEntries(null); setErr(null); api<{ entries: (AuditEntry & { at: string })[] }>("exportAuditLog", { instId: s.instId, format: "json", from: from || undefined, to: to || undefined }).then((r) => setEntries(r.entries)).catch((e) => setErr(e.message)); };
  useEffect(load, [s.instId]); // eslint-disable-line react-hooks/exhaustive-deps
  const exp = async (format: "csv" | "pdf") => { setBusy(format); try { const r = await api<{ path: string }>("exportAuditLog", { instId: s.instId, format, from: from || undefined, to: to || undefined }); await downloadFile(r.path, `audit-log.${format}`); } catch (e) { toast((e as Error).message); } finally { setBusy(null); } };
  return (
    <div>
      <PageHead title="Change log" sub="Every upload, approval, permission change and sign-in. Kept for at least 3 years and can't be edited." />
      <AdminNav />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mb-0" />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mb-0" />
        <Button onClick={load}>Show</Button>
        <Button busy={busy === "csv"} onClick={() => exp("csv")}><Download className="h-4 w-4" />CSV</Button>
        <Button busy={busy === "pdf"} onClick={() => exp("pdf")}><Download className="h-4 w-4" />PDF</Button>
      </div>
      <ErrorText error={err} />
      {!entries ? (!err && <Spinner />) : entries.length === 0 ? <Empty title="No entries" /> : (
        <>
          <p className="mb-2 text-sm text-ink-2">Latest {entries.length}. Export for the full log.</p>
          <ul className="card divide-y divide-rule">
            {entries.map((e, i) => (
              <li key={i}>
                <button className="flex w-full flex-wrap justify-between gap-2 px-4 py-2.5 text-left hover:bg-soft" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <span><b>{e.actorName}</b> · {LABEL[e.action] ?? e.action}{e.target?.title ? `: ${e.target.title}` : ""}</span>
                  <span className="text-[13px] text-ink-2">{fmtDateTime(e.at)}</span>
                </button>
                {open === i && (e.before || e.after) && <pre className="mx-4 mb-3 overflow-x-auto rounded-lg bg-soft p-3 text-[12px]">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
