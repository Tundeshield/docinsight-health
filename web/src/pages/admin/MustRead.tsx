import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { downloadFile } from "../../lib/storage";
import { Button, Empty, ErrorText, PageHead, Spinner, toast } from "../../components/ui";
import { AdminNav, useManagedContent } from "./shared";

type Row = { name: string; jobTitle: string; department: string; at: string };

export default function MustRead() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const content = useManagedContent();
  const items = (content ?? []).filter((c) => c.mustRead && c.published);
  const selected = params.get("content") ?? items[0]?.id ?? "";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    setRows(null); setErr(null);
    api<{ rows: Row[] }>("exportAcknowledgements", { instId: s.instId, contentId: selected, format: "json" }).then((r) => setRows(r.rows)).catch((e) => setErr(e.message));
  }, [selected, s.instId]);
  const exp = async (format: "csv" | "pdf") => {
    setBusy(format);
    try { const r = await api<{ path: string }>("exportAcknowledgements", { instId: s.instId, contentId: selected, format }); await downloadFile(r.path, `acknowledgements.${format}`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  const done = (rows ?? []).filter((r) => r.at !== "Not yet").length;
  return (
    <div>
      <PageHead title="Must read" sub="Who has read and acknowledged each must-read document. Export for accreditation." />
      <AdminNav />
      {!content ? <Spinner /> : items.length === 0 ? <Empty title="No must-read documents">Open a live document and choose Mark as must read.</Empty> : (
        <>
          <select className="input mb-4 max-w-xl" value={selected} onChange={(e) => setParams({ content: e.target.value })} aria-label="Document">
            {items.map((c) => <option key={c.id} value={c.id}>{c.title} (v{c.currentVersionNumber})</option>)}
          </select>
          <ErrorText error={err} />
          {!rows ? <Spinner /> : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg"><b>{done}</b> of {rows.length} acknowledged ({rows.length ? Math.round((done / rows.length) * 100) : 0}%)</p>
                <div className="flex gap-2">
                  <Button size="sm" busy={busy === "remind"} onClick={async () => { setBusy("remind"); try { const r = await api<{ reminded: number }>("remindMustRead", { instId: s.instId, contentId: selected }); toast(`Reminded ${r.reminded} people`); } catch (e) { toast((e as Error).message); } finally { setBusy(null); } }}>Remind the rest</Button>
                  <Button size="sm" busy={busy === "csv"} onClick={() => exp("csv")}><Download className="h-4 w-4" />CSV</Button>
                  <Button size="sm" busy={busy === "pdf"} onClick={() => exp("pdf")}><Download className="h-4 w-4" />PDF</Button>
                </div>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead className="bg-soft text-left"><tr><th className="p-3">Name</th><th className="p-3">Job title</th><th className="p-3">Department</th><th className="p-3">Acknowledged (UTC)</th></tr></thead>
                  <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-rule"><td className="p-3 font-bold">{r.name}</td><td className="p-3">{r.jobTitle}</td><td className="p-3">{r.department}</td><td className={`p-3 ${r.at === "Not yet" ? "font-bold text-warn" : ""}`}>{r.at}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
