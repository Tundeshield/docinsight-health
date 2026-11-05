import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { useSession } from "../../lib/session";
import { isOverdue, daysUntil } from "../../lib/format";
import { Banner, PageHead, Spinner, Stat, cx } from "../../components/ui";
import { AdminNav, useManagedContent } from "./shared";

export default function AdminHome() {
  const s = useSession();
  const [params] = useSearchParams();
  const content = useManagedContent();
  if (!content) return <><PageHead title="Manage" /><AdminNav /><Spinner /></>;
  const live = content.filter((c) => c.published && c.status !== "archived");
  const inReview = content.filter((c) => c.status === "in_review");
  const drafts = content.filter((c) => c.status === "draft");
  const overdue = live.filter((c) => isOverdue(c.reviewDate));
  const soon = live.filter((c) => { const d = daysUntil(c.reviewDate); return d != null && d >= 0 && d <= 30; });
  const approverSpaces = s.spaces.filter((sp) => sp.requiresApproval && !sp.approverIds.length);
  const paid = s.inst && !["pending_payment"].includes(s.inst.status);
  const steps = [
    { done: s.spaces.length > 0, label: "Add your departments", to: "/app/admin/spaces" },
    { done: approverSpaces.length === 0 && s.spaces.length > 0, label: "Name an approver for each clinical space", to: "/app/admin/spaces" },
    { done: content.length > 0, label: "Upload your first document", to: "/app/admin/content/new" },
    { done: live.length > 0, label: "Approve it so staff can see it", to: "/app/admin/approvals" },
    { done: !!paid, label: "Pay the first invoice", to: "/app/admin/billing" },
    { done: (s.inst?.seatsUsed ?? 0) > 2, label: "Invite your staff", to: "/app/admin/people" },
  ];
  const showSteps = s.isManager && (params.get("welcome") || steps.filter((x) => !x.done).length > 0);
  return (
    <div>
      <PageHead title="Manage" sub={s.inst?.name} actions={s.canEditSomewhere ? <Link to="/app/admin/content/new" className="btn btn-primary btn-sm">Add document</Link> : undefined} />
      <AdminNav />
      {params.get("welcome") && <Banner tone="ok" title="Your institution is ready">Work through the steps below. You can upload documents and invite admins straight away.</Banner>}
      {showSteps && (
        <section className="card mb-6 p-4">
          <h2 className="h2 mb-2">Getting started</h2>
          <ol className="divide-y divide-rule">
            {steps.map((st) => (
              <li key={st.label}><Link to={st.to} className="flex items-center gap-3 py-2.5 hover:text-brand">{st.done ? <CheckCircle2 className="h-5 w-5 text-ok" aria-label="Done" /> : <Circle className="h-5 w-5 text-ink-2" aria-label="To do" />}<span className={cx(st.done && "text-ink-2 line-through")}>{st.label}</span></Link></li>
            ))}
          </ol>
        </section>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live documents" value={live.length} />
        <Link to="/app/admin/approvals"><Stat label="Awaiting approval" value={inReview.length} /></Link>
        <Link to="/app/admin/content?status=draft"><Stat label="Drafts" value={drafts.length} /></Link>
        <Link to="/app/admin/content?status=overdue"><Stat label="Review overdue" value={overdue.length} sub={soon.length ? `${soon.length} due in 30 days` : undefined} /></Link>
      </div>
      {approverSpaces.length > 0 && s.isManager && <div className="mt-6"><Banner tone="warn" title="Spaces without an approver">{approverSpaces.map((x) => x.name).join(", ")}. Documents there can't go live until you <Link className="link" to="/app/admin/spaces">name an approver</Link>.</Banner></div>}
      {inReview.length > 0 && (
        <section className="mt-6">
          <h2 className="h2 mb-2">Waiting for approval</h2>
          <ul className="card divide-y divide-rule">{inReview.slice(0, 8).map((c) => <li key={c.id}><Link to={`/app/admin/content/${c.id}`} className="block px-4 py-3 hover:bg-soft"><b>{c.title}</b><span className="block text-[13px] text-ink-2">{s.spaces.find((x) => x.id === c.spaceId)?.name} · {c.ownerName}</span></Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
