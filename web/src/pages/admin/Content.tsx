import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../lib/session";
import { fmtDate, isOverdue } from "../../lib/format";
import { Empty, PageHead, Spinner, StatusPill } from "../../components/ui";
import { AdminNav, useManagedContent } from "./shared";
import { TypeIcon, docTypeLabel } from "../app/common";

export default function Content() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const space = params.get("space") ?? "";
  const [q, setQ] = useState("");
  const content = useManagedContent();
  const rows = useMemo(() => (content ?? []).filter((c) => {
    if (space && c.spaceId !== space) return false;
    if (q && !c.title.toLowerCase().includes(q.toLowerCase())) return false;
    switch (status) {
      case "active": return c.status !== "archived";
      case "live": return c.published && c.status !== "archived";
      case "draft": return c.status === "draft";
      case "in_review": return c.status === "in_review";
      case "overdue": return c.published && isOverdue(c.reviewDate);
      case "archived": return c.status === "archived";
      default: return true;
    }
  }).sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0)), [content, status, space, q]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const spaceName = (id: string) => s.spaces.find((x) => x.id === id)?.name ?? "";

  return (
    <div>
      <PageHead title="Documents" actions={s.canEditSomewhere ? <Link to={`/app/admin/content/new${space ? `?space=${space}` : ""}`} className="btn btn-primary btn-sm">Add document</Link> : undefined} />
      <AdminNav />
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <input className="input" placeholder="Filter by title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter by title" />
        <select className="input" value={status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="active">All except archived</option><option value="live">Live</option><option value="draft">Drafts</option><option value="in_review">In review</option><option value="overdue">Review overdue</option><option value="archived">Archived</option>
        </select>
        <select className="input" value={space} onChange={(e) => set("space", e.target.value)} aria-label="Space">
          <option value="">All spaces</option>{s.spaces.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      {!content ? <Spinner /> : rows.length === 0 ? <Empty title="No documents" action={s.canEditSomewhere ? <Link to="/app/admin/content/new" className="btn">Add document</Link> : undefined}>Nothing matches these filters.</Empty> : (
        <ul className="card divide-y divide-rule">
          {rows.map((c) => (
            <li key={c.id}>
              <Link to={`/app/admin/content/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-soft">
                <span className="mt-0.5 text-ink-2"><TypeIcon type={c.type} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><b>{c.title}</b><StatusPill status={c.status === "approved" ? "approved" : c.status} />{c.published && c.status !== "approved" && c.status !== "archived" && <span className="pill bg-ok-bg text-ok">v{c.currentVersionNumber} live</span>}{c.mustRead && <span className="pill bg-warn-bg text-warn">Must read</span>}</span>
                  <span className="block text-[13px] text-ink-2">{spaceName(c.spaceId)} · {docTypeLabel(c.documentType)} · {c.ownerName}{c.reviewDate ? ` · review ${fmtDate(c.reviewDate)}` : " · no review date"}</span>
                </span>
                {c.published && isOverdue(c.reviewDate) && <StatusPill status="overdue" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
