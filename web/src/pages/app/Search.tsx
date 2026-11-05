import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { search, type SearchResult } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Banner, Empty, ErrorText, PageHead, Spinner, cx } from "../../components/ui";
import { docTypeLabel } from "./common";

function Snippet({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <b key={i} className="text-ink">{part}</b> : part))}</>;
}

export default function Search() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const source = params.get("source") ?? "all";
  const spaceId = params.get("space") ?? "";
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!q || !s.instId) { setResults(null); return; }
    let live = true;
    setBusy(true); setErr(null);
    search(s.instId, q, { source, ...(spaceId && { spaceId }) }).then((r) => live && setResults(r)).catch((e) => live && setErr(e.message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [q, source, spaceId, s.instId]);

  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };
  const submit = (e: FormEvent) => { e.preventDefault(); set("q", input.trim()); };

  if (!s.caps.search) return <Banner tone="warn" title="Search is paused">Your institution's subscription needs attention.</Banner>;
  return (
    <div>
      <PageHead title="Search" />
      <form onSubmit={submit} className="flex gap-2" role="search">
        <label htmlFor="sq" className="sr-only">Search</label>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2" aria-hidden />
          <input id="sq" autoFocus={!q} className="input pl-10" placeholder="e.g. vancomycin dosing, defibrillator battery" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <button className="btn btn-primary">Search</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {[["all", "Everything"], ["hospital", "My hospital"], ["hub", "Knowledge Hub"]].map(([v, l]) => (
          <button key={v} className={cx("chip", source === v && "border-ink bg-ink text-page")} aria-pressed={source === v} onClick={() => set("source", v === "all" ? "" : v)}>{l}</button>
        ))}
        {s.spaces.length > 1 && source !== "hub" && (
          <select className="chip pr-8" value={spaceId} onChange={(e) => set("space", e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {s.spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
        )}
      </div>
      <div className="mt-5">
        <ErrorText error={err} />
        {busy ? <Spinner label="Searching…" /> : results === null ? <p className="text-ink-2">Search every approved document you can see. Results show the page the words appear on.</p> : results.length === 0 ? (
          <Empty title="No matches" action={s.caps.ask ? <Link className="btn" to={`/app/ask?q=${encodeURIComponent(q)}`}>Ask DocInsight instead</Link> : undefined}>Try different words, or check the spelling.</Empty>
        ) : (
          <>
            <p className="mb-2 text-sm text-ink-2">{results.length} document{results.length === 1 ? "" : "s"}</p>
            <ul className="card divide-y divide-rule">
              {results.map((r) => {
                const href = `${r.source === "hub" ? "/app/hub/doc" : "/app/doc"}/${r.contentId}?page=${r.page}&q=${encodeURIComponent(r.snippet.replace(/…/g, "").slice(0, 160))}`;
                return (
                  <li key={r.contentId}>
                    <Link to={href} className="block px-4 py-3 hover:bg-soft">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={cx("pill", r.source === "hub" ? "bg-soft text-hub" : "bg-ok-bg text-ok")}>{r.label}</span>
                        <b>{r.title}</b>
                      </span>
                      <span className="mt-0.5 block text-[13px] text-ink-2">{r.spaceName} · {docTypeLabel(r.documentType)}{r.versionNumber ? ` · v${r.versionNumber}` : ""} · {/^\d+$/.test(r.pageLabel) ? `page ${r.pageLabel}` : r.pageLabel}{r.heading ? ` · ${r.heading}` : ""}</span>
                      <span className="mt-1 block text-[15px] text-ink-2"><Snippet text={r.snippet} q={q} /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
