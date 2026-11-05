import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { fmtDate } from "../../lib/format";
import { Empty, ErrorText, PageHead, Spinner, Stat, cx } from "../../components/ui";
import { AdminNav } from "./shared";

interface A {
  days: number; active: { daily: number; weekly: number; monthly: number; members: number };
  topSearches: { query: string; count: number }[]; topDocuments: { contentId: string; title: string; count: number }[]; topQuestions: { question: string; count: number; status: string }[];
  unanswered: { topic: string; count: number; examples: string[] }[];
  health: { overdue: { contentId: string; title: string; reviewDate: string; ownerName: string }[]; dueSoon: { contentId: string; title: string; reviewDate: string; ownerName: string }[]; awaitingApproval: { contentId: string; title: string }[]; emptySpaces: { spaceId: string; name: string }[]; noReviewDate: number };
  mustRead: { contentId: string; title: string; acknowledged: number; eligible: number; rate: number }[];
  ai: { questions: number; notFound: number; answered: number; thumbsUp: number; thumbsDown: number; monthCostMicros: number | null };
  reports: { id: string; question: string; note: string; status: string; at: string | null }[];
}

function Bars({ rows }: { rows: { label: React.ReactNode; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return <ul className="space-y-2">{rows.map((r, i) => <li key={i}><div className="flex justify-between gap-2 text-[15px]"><span className="min-w-0 truncate">{r.label}</span><b className="tabular-nums">{r.count}</b></div><div className="mt-1 h-2 rounded-full bg-soft"><div className="h-2 rounded-full bg-brand" style={{ width: `${(r.count / max) * 100}%` }} /></div></li>)}</ul>;
}

export default function Analytics() {
  const s = useSession();
  const [days, setDays] = useState(30);
  const [a, setA] = useState<A | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setA(null); api<A>("getAnalytics", { instId: s.instId, days }).then(setA).catch((e) => setErr(e.message)); }, [days, s.instId]);
  return (
    <div>
      <PageHead title="Analytics" sub="Questions are shown as topics and counts, never who asked." actions={<select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>} />
      <AdminNav />
      <ErrorText error={err} />
      {!a ? (!err && <Spinner />) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Active today" value={a.active.daily} />
            <Stat label="Active this week" value={a.active.weekly} />
            <Stat label="Active this month" value={a.active.monthly} sub={`of ${a.active.members} members`} />
            <Stat label="Questions asked" value={a.ai.questions} sub={a.ai.questions ? `${Math.round((a.ai.answered / a.ai.questions) * 100)}% answered · ${a.ai.thumbsUp}👍 ${a.ai.thumbsDown}👎` : undefined} />
          </div>
          <section className="card p-4">
            <h2 className="h2">Gaps: questions we couldn't answer</h2>
            <p className="mb-3 text-[15px] text-ink-2">Topics staff asked about that your documents don't cover. Add or update a document to fill each gap.</p>
            {a.unanswered.length === 0 ? <p className="text-ink-2">None in this period.</p> : (
              <ul className="divide-y divide-rule">{a.unanswered.map((g) => <li key={g.topic} className="py-2.5"><div className="flex justify-between"><b>{g.topic}</b><span className="pill bg-warn-bg text-warn">{g.count}</span></div><ul className="mt-1 list-disc pl-5 text-[14px] text-ink-2">{g.examples.map((e) => <li key={e}>{e}</li>)}</ul></li>)}</ul>
            )}
          </section>
          <div className="grid gap-6 md:grid-cols-2">
            <section className="card p-4"><h2 className="h2 mb-3">Top searches</h2>{a.topSearches.length ? <Bars rows={a.topSearches.map((x) => ({ label: x.query, count: x.count }))} /> : <p className="text-ink-2">No searches yet.</p>}</section>
            <section className="card p-4"><h2 className="h2 mb-3">Most opened documents</h2>{a.topDocuments.length ? <Bars rows={a.topDocuments.map((x) => ({ label: <Link className="link" to={`/app/admin/content/${x.contentId}`}>{x.title}</Link>, count: x.count }))} /> : <p className="text-ink-2">No views yet.</p>}</section>
          </div>
          {a.topQuestions.length > 0 && <section className="card p-4"><h2 className="h2 mb-3">Common questions</h2><Bars rows={a.topQuestions.map((x) => ({ label: <span className={cx(x.status === "not_found" && "text-warn")}>{x.question}</span>, count: x.count }))} /></section>}
          <section className="card p-4">
            <h2 className="h2 mb-3">Library health</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div><h3 className="font-bold">Review overdue ({a.health.overdue.length})</h3><ul className="mt-1 text-[15px]">{a.health.overdue.slice(0, 10).map((x) => <li key={x.contentId}><Link className="link" to={`/app/admin/content/${x.contentId}`}>{x.title}</Link> <span className="text-ink-2">· {fmtDate(x.reviewDate)} · {x.ownerName}</span></li>)}</ul></div>
              <div><h3 className="font-bold">Due in 30 days ({a.health.dueSoon.length})</h3><ul className="mt-1 text-[15px]">{a.health.dueSoon.slice(0, 10).map((x) => <li key={x.contentId}><Link className="link" to={`/app/admin/content/${x.contentId}`}>{x.title}</Link> <span className="text-ink-2">· {fmtDate(x.reviewDate)}</span></li>)}</ul></div>
              <div><h3 className="font-bold">Spaces with nothing live</h3><p className="text-[15px] text-ink-2">{a.health.emptySpaces.map((x) => x.name).join(", ") || "None"}</p></div>
              <div><h3 className="font-bold">Live documents with no review date</h3><p className="text-[15px] text-ink-2">{a.health.noReviewDate}</p></div>
            </div>
          </section>
          {a.mustRead.length > 0 && <section className="card p-4"><h2 className="h2 mb-3">Must-read completion</h2><Bars rows={a.mustRead.map((x) => ({ label: <Link className="link" to={`/app/admin/must-read?content=${x.contentId}`}>{x.title} ({x.acknowledged}/{x.eligible})</Link>, count: Math.round(x.rate * 100) }))} /><p className="mt-2 text-[13px] text-ink-2">Bars show % acknowledged.</p></section>}
          {s.isManager && (
            <section className="card p-4">
              <h2 className="h2 mb-2">Reported problems</h2>
              {a.reports.length === 0 ? <p className="text-ink-2">No reports.</p> : <ul className="divide-y divide-rule">{a.reports.map((r) => <li key={r.id} className="py-2.5"><b>{r.question}</b><span className="block text-[14px]">{r.note || "No note"}</span><span className="text-[13px] text-ink-2">{r.at ? fmtDate(r.at) : ""} · {r.status}</span></li>)}</ul>}
              {a.ai.monthCostMicros != null && <p className="mt-3 text-[13px] text-ink-2">AI cost this month: ${(a.ai.monthCostMicros / 1e6).toFixed(2)}</p>}
            </section>
          )}
          {a.ai.questions === 0 && a.topSearches.length === 0 && <Empty title="Not much to show yet">Numbers appear as staff search, open documents and ask questions.</Empty>}
        </div>
      )}
    </div>
  );
}
