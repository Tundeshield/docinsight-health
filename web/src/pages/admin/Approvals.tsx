import { Link } from "react-router-dom";
import { useSession } from "../../lib/session";
import { ago } from "../../lib/format";
import { Empty, PageHead, Spinner } from "../../components/ui";
import { AdminNav, useManagedContent, useManagedSpaceIds } from "./shared";

export default function Approvals() {
  const s = useSession();
  const content = useManagedContent();
  const approve = new Set(useManagedSpaceIds("approve"));
  const rows = (content ?? []).filter((c) => c.status === "in_review" && (s.isManager || approve.has(c.spaceId)));
  return (
    <div>
      <PageHead title="Approvals" sub="Documents waiting for a decision. Only approved versions are used by search and Ask DocInsight." />
      <AdminNav />
      {!content ? <Spinner /> : rows.length === 0 ? <Empty title="Nothing waiting">When someone submits a document in a space you approve, it appears here and you get a notification.</Empty> : (
        <ul className="card divide-y divide-rule">
          {rows.map((c) => (
            <li key={c.id}><Link to={`/app/admin/content/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-soft"><span><b>{c.title}</b><span className="block text-[13px] text-ink-2">{s.spaces.find((x) => x.id === c.spaceId)?.name} · {c.ownerName} · {ago(c.updatedAt)}{c.published ? ` · replaces v${c.currentVersionNumber}` : " · new"}</span></span><span className="btn btn-sm">Review</span></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
