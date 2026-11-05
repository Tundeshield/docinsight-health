import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { Flag, History, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { db } from "../../lib/firebase";
import { api, ask, type AskResult } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { mdToHtml } from "../../lib/markdown";
import { ago } from "../../lib/format";
import { Banner, Button, ConfirmButton, ErrorText, Modal, PageHead, TextArea, cx, toast } from "../../components/ui";
import { ANSWER_FOOTER, NOT_FOUND_MESSAGE, OFF_TOPIC_MESSAGE } from "../../../../shared/src/config";
import type { Citation, QuestionRecord } from "../../../../shared/src/types";

type Shown = AskResult & { question: string; rating?: "up" | "down" | null };

function citeHref(c: Citation) {
  return `${c.source === "hub" ? "/app/hub/doc" : "/app/doc"}/${c.contentId}?page=${c.pages[0]}&q=${encodeURIComponent(c.quote.slice(0, 240))}`;
}

function Answer({ r, instId, onRated }: { r: Shown; instId: string; onRated: (v: "up" | "down") => void }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const html = useMemo(() => mdToHtml(r.answer).replace(/\[(\d{1,2})\]/g, (_m, n) => `<a href="#cite-${n}" class="cite font-bold text-brand no-underline" aria-label="Source ${n}"><sup>[${n}]</sup></a>`), [r.answer]);
  const rate = async (v: "up" | "down") => { if (!r.questionId) return; onRated(v); api("rateAnswer", { instId, questionId: r.questionId, rating: v }).catch(() => undefined); };
  const report = async () => {
    setBusy(true);
    try { await api("reportProblem", { instId, questionId: r.questionId, note }); setReportOpen(false); setNote(""); toast("Reported. Your administrator and the DocInsight team will look at it."); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const special = r.status === "not_found" ? NOT_FOUND_MESSAGE : r.status === "off_topic" ? OFF_TOPIC_MESSAGE : null;
  return (
    <article className="card p-4 md:p-5" aria-live="polite">
      <p className="mb-3 font-bold">{r.question}</p>
      {r.status === "blocked" ? (
        <Banner tone="warn" title="Question not sent">{r.message ?? "Remove patient details and ask again."}</Banner>
      ) : special ? (
        <div>
          <p className="text-[17px]">{special}</p>
          {r.status === "not_found" && <p className="mt-2 text-ink-2">Try <Link to={`/app/search?q=${encodeURIComponent(r.question)}`} className="link">searching</Link> with different words, or ask the document owner. Your administrator sees topics that couldn't be answered, so gaps get filled.</p>}
        </div>
      ) : (
        <>
          <div className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />
          {r.citations.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-2">Sources</h3>
              <ol className="grid gap-2">
                {r.citations.map((c) => (
                  <li key={c.n} id={`cite-${c.n}`} className="scroll-mt-24">
                    <Link to={citeHref(c)} className="block rounded-lg border border-rule p-3 hover:border-ink-2">
                      <span className="flex flex-wrap items-center gap-1.5 text-[15px]">
                        <b className="text-brand">[{c.n}]</b>
                        <span className={cx("pill", c.source === "hub" ? "bg-soft text-hub" : "bg-ok-bg text-ok")}>{c.label}</span>
                        <b>{c.title}</b>
                      </span>
                      <span className="mt-0.5 block text-[13px] text-ink-2">{c.spaceName}{c.versionNumber ? ` · v${c.versionNumber}` : ""} · {/^\d+$/.test(c.pageLabel) ? `page ${c.pageLabel}` : c.pageLabel} · tap to open the page</span>
                      <span className="mt-1.5 line-clamp-3 block border-l-2 border-rule pl-2 text-[14px] text-ink-2">{c.quote}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
      {r.status !== "blocked" && (
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
          <p className="text-[13px] font-bold text-ink-2">{ANSWER_FOOTER}</p>
          {r.questionId && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-pressed={r.rating === "up"} aria-label="Helpful" onClick={() => rate("up")}><ThumbsUp className={cx("h-4 w-4", r.rating === "up" && "fill-current text-brand")} /></Button>
              <Button size="sm" variant="ghost" aria-pressed={r.rating === "down"} aria-label="Not helpful" onClick={() => rate("down")}><ThumbsDown className={cx("h-4 w-4", r.rating === "down" && "fill-current text-warn")} /></Button>
              <Button size="sm" variant="ghost" onClick={() => setReportOpen(true)}><Flag className="h-4 w-4" />Report a problem</Button>
            </div>
          )}
        </footer>
      )}
      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Report a problem" footer={<><Button onClick={() => setReportOpen(false)}>Cancel</Button><Button variant="primary" busy={busy} onClick={report}>Send report</Button></>}>
        <p className="mb-3 text-[15px] text-ink-2">Tell us what's wrong: an unsafe answer, a wrong source, or outdated information. Don't include patient details.</p>
        <TextArea label="What's wrong?" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </article>
  );
}

export default function Ask() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const [question, setQuestion] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const instId = s.instId!;
  const uid = s.user!.uid;
  const history = useQuery<QuestionRecord>(query(collection(db, "institutions", instId, "questions"), where("userId", "==", uid), where("hiddenByUser", "==", false), orderBy("createdAt", "desc"), limit(30)), `q:${instId}:${uid}`);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => { if (params.get("q") && s.caps.ask && !shown && !status) submit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (q.length < 3) return setErr("Type a question first.");
    setErr(null); setShown(null); setStatus("Searching your documents…");
    try {
      const r = await ask(instId, q, setStatus);
      setShown({ ...r, question: q, rating: null });
      if (params.get("q")) setParams({}, { replace: true });
      setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) { setErr((e as Error).message); } finally { setStatus(null); }
  };

  const open = (h: QuestionRecord & { id: string }) => { setShown({ questionId: h.id, status: h.status, answer: h.answer, citations: h.citations, question: h.question, rating: h.feedback?.rating ?? null }); setShowHistory(false); window.scrollTo({ top: 0 }); };

  if (!s.caps.ask) return <div><PageHead title="Ask DocInsight" /><Banner tone="warn" title="Ask DocInsight is paused">{s.inst?.status === "restricted" ? "Your institution is read-only until the subscription is paid. Search and documents still work." : "Not available for your institution right now."}</Banner><Link to="/app/search" className="btn">Go to search</Link></div>;

  return (
    <div>
      <PageHead title="Ask DocInsight" sub="Answers come only from your hospital's approved documents and the Knowledge Hub, with the page to check." actions={<Button size="sm" variant="ghost" onClick={() => setShowHistory((x) => !x)} aria-expanded={showHistory}><History className="h-4 w-4" />History</Button>} />
      {showHistory && (
        <section className="card mb-5 p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="h2">Your last 30 days</h2>
            {(history.data?.length ?? 0) > 0 && <ConfirmButton confirm="Your questions and answers will be removed from your history. This can't be undone." confirmLabel="Clear history" onConfirm={async () => { await api("clearHistory", { instId }); toast("History cleared"); setShown(null); }}>Clear history</ConfirmButton>}
          </div>
          {history.data?.length === 0 ? <p className="text-ink-2">No questions yet. Only you can see your history.</p> : (
            <ul className="divide-y divide-rule">{(history.data ?? []).map((h) => <li key={h.id}><button className="w-full py-2.5 text-left hover:text-brand" onClick={() => open(h)}><b className="block">{h.question}</b><span className="text-[13px] text-ink-2">{ago(h.createdAt)}{h.status === "not_found" ? " · not covered" : ""}</span></button></li>)}</ul>
          )}
        </section>
      )}
      <form onSubmit={submit} className="card p-3">
        <label htmlFor="ask" className="sr-only">Your question</label>
        <textarea id="ask" rows={3} className="w-full resize-none bg-transparent p-1 text-[17px] outline-none placeholder:text-ink-2/70" placeholder="e.g. What is our protocol for a post-partum haemorrhage?" value={question}
          onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} maxLength={600} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-2">
          <p className="text-[13px] text-ink-2">Don't include patient names or details.</p>
          <Button variant="primary" busy={!!status} type="submit"><Send className="h-4 w-4" />Ask</Button>
        </div>
      </form>
      <div ref={top} className="scroll-mt-20" />
      <div className="mt-5">
        <ErrorText error={err} />
        {status && <div role="status" className="card flex items-center gap-3 p-4 text-ink-2"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" aria-hidden />{status}</div>}
        {shown && <Answer r={shown} instId={instId} onRated={(v) => setShown({ ...shown, rating: v })} />}
        {!shown && !status && (
          <div className="text-ink-2">
            <p className="font-bold text-ink">Good questions are specific:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>"What's the escalation pathway for a NEWS score of 7?"</li>
              <li>"How do I clear an occlusion alarm on the infusion pump?"</li>
              <li>"Which HMO needs pre-authorisation for a CT scan?"</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
