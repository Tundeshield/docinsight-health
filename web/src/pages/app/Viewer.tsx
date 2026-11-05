import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { BookOpenCheck, ChevronLeft, ChevronRight, CloudDownload, CloudOff, ExternalLink, Image as ImageIcon, Star, Type } from "lucide-react";
import { db } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useDoc, useOnline } from "../../lib/hooks";
import { hasPageImages, isOffline, loadText, pageImageUrl, removeOffline, saveOffline, versionBase } from "../../lib/storage";
import { highlightQuote, mdToHtml } from "../../lib/markdown";
import { fmtDate, isOverdue } from "../../lib/format";
import { Banner, Button, Empty, Spinner, cx, toast } from "../../components/ui";
import { docTypeLabel } from "./common";
import type { ContentItem, ContentVersion, PageText } from "../../../../shared/src/types";

function PageImage({ base, n, alt }: { base: string; n: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null); setErr(false);
    pageImageUrl(base, n).then((u) => live && setUrl(u)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [base, n]);
  if (err) return <div className="flex aspect-[1/1.3] items-center justify-center rounded-lg bg-soft p-6 text-center text-ink-2">This page image couldn't load. Switch to text view, or try again when you have a connection.</div>;
  if (!url) return <div className="flex aspect-[1/1.3] items-center justify-center rounded-lg bg-soft"><Spinner label={`Loading page ${n}…`} /></div>;
  return <img src={url} alt={alt} className="w-full rounded-lg border border-rule bg-white" />;
}

function TextPage({ page, quote }: { page: PageText; quote: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => mdToHtml(page.text), [page.text]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = html;
    if (quote) {
      const m = highlightQuote(ref.current, quote);
      if (m) setTimeout(() => m.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    }
  }, [html, quote]);
  return (
    <div className="card p-4 md:p-6">
      {page.ocr && <p className="mb-3 text-[13px] text-ink-2">Text read from a scanned page{page.edited ? ", checked by a person" : ""}. Check the page image if anything looks wrong.</p>}
      <div ref={ref} className="prose-doc break-words" />
    </div>
  );
}

export default function Viewer({ hub = false }: { hub?: boolean }) {
  const { contentId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const s = useSession();
  const online = useOnline();
  const uid = s.user!.uid;
  const instId = s.instId ?? "";
  const contentRef = hub ? doc(db, "hubContent", contentId) : doc(db, "institutions", instId, "content", contentId);
  const { data: content, error } = useDoc<ContentItem>(contentRef);
  const vParam = params.get("v");
  const versionId = vParam || content?.currentVersionId || null;
  const isDraft = !!vParam && vParam !== content?.currentVersionId;
  const { data: version } = useDoc<ContentVersion>(isDraft && content ? doc(db, hub ? `hubContent/${contentId}/versions/${vParam}` : `institutions/${instId}/content/${contentId}/versions/${vParam}`) : null);
  const quote = params.get("q") ?? "";
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("page")) || 1));
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"image" | "text">(quote || s.settings.dataSaver ? "text" : "image");
  const [fav, setFav] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [acked, setAcked] = useState<boolean | null>(null);
  const [ackBusy, setAckBusy] = useState(false);
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const viewed = useRef(false);

  const base = content && versionId ? versionBase({ instId, hub, spaceId: content.spaceId, contentId, versionId, draft: isDraft }) : null;

  useEffect(() => {
    if (!base) return;
    setPages(null); setLoadErr(null);
    loadText(base).then(setPages).catch(() => setLoadErr(online ? "This document couldn't be opened. It may still be processing." : "You're offline and this document isn't saved on this phone."));
  }, [base, online]);

  useEffect(() => { const p = Number(params.get("page")); if (p) setPage(p); if (params.get("q")) setMode("text"); }, [params]);

  // Favourite, offline and acknowledgement state; mark updates read; count the view
  useEffect(() => {
    if (!content || hub) return;
    isOffline(contentId).then(setSaved);
    getDocs(query(collection(db, "institutions", instId, "members", uid, "favourites"), where("contentId", "==", contentId))).then((r) => setFav(!r.empty)).catch(() => undefined);
    if (content.mustRead && content.mustReadVersionId) {
      getDoc(doc(db, "institutions", instId, "acknowledgements", `${contentId}_${content.mustReadVersionId}_${uid}`)).then((d) => setAcked(d.exists())).catch(() => setAcked(false));
    }
    getDocs(query(collection(db, "institutions", instId, "members", uid, "inbox"), where("contentId", "==", contentId), where("read", "==", false)))
      .then((r) => r.docs.forEach((d) => updateDoc(d.ref, { read: true }).catch(() => undefined))).catch(() => undefined);
    if (!viewed.current && !isDraft && online) { viewed.current = true; api("recordView", { instId, contentId }).catch(() => undefined); }
  }, [content?.id, content?.mustReadVersionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const images = content && pages ? hasPageImages(content.type, pages) : false;
  const effectiveMode = images ? mode : "text";
  const count = pages?.length ?? 0;
  const cur = pages?.find((p) => p.n === page) ?? pages?.[0];
  const go = (n: number) => { const p = Math.min(Math.max(1, n), count); setPage(p); const next = new URLSearchParams(params); next.set("page", String(p)); if (p !== Number(params.get("page"))) next.delete("q"); setParams(next, { replace: true }); window.scrollTo({ top: 0 }); };

  if (error || content === null) return <Empty title="Document not available">It may have been archived, or you don't have access to it. <Link to="/app" className="link">Go home</Link></Empty>;
  if (!content) return <Spinner />;
  if (!content.published && !isDraft && !s.canEditSomewhere) return <Empty title="Not published yet">This document hasn't been approved yet.</Empty>;

  const toggleFav = async () => {
    const ref = doc(db, "institutions", instId, "members", uid, "favourites", contentId);
    try {
      if (fav) { await deleteDoc(ref); setFav(false); toast("Removed from favourites"); }
      else { await setDoc(ref, { contentId, title: content.title, spaceId: content.spaceId, at: serverTimestamp() }); setFav(true); toast("Added to favourites"); }
    } catch { toast("Couldn't update favourites. Try again."); }
  };
  const toggleOffline = async () => {
    if (!base || !pages) return;
    if (saved) { await removeOffline(contentId); setSaved(false); toast("Removed from this phone"); return; }
    setSaving("Saving…");
    try {
      const space = s.spaces.find((x) => x.id === content.spaceId);
      await saveOffline({ contentId, versionId: versionId!, title: content.title, spaceName: space?.name ?? "", base, pages: images ? pages.length : 0 }, (d, t) => setSaving(`Saving page ${d} of ${t}…`));
      setSaved(true); toast("Saved. It will open without a connection.");
    } catch { toast("Couldn't save for offline. Check your connection."); } finally { setSaving(null); }
  };
  const acknowledge = async () => {
    setAckBusy(true);
    try { await api("acknowledge", { instId, contentId }); setAcked(true); toast("Thanks. Your acknowledgement is recorded."); }
    catch (e) { toast((e as Error).message); } finally { setAckBusy(false); }
  };

  const space = s.spaces.find((x) => x.id === content.spaceId);
  const backTo = hub ? `/app/hub/${content.spaceId}` : space ? `/app/s/${space.id}` : "/app";
  const needsAck = !hub && content.mustRead && content.mustReadVersionId === content.currentVersionId && acked === false && !isDraft;

  return (
    <div>
      <button onClick={() => (history.length > 1 ? nav(-1) : nav(backTo))} className="mb-2 text-sm font-bold text-ink-2 hover:text-ink">← Back</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-1.5">
            <span className={cx("pill", hub ? "bg-soft text-hub" : "bg-ok-bg text-ok")}>{hub ? "National guidance" : "Hospital protocol"}</span>
            <span className="pill bg-soft text-ink-2">{docTypeLabel(content.documentType)}</span>
            {isDraft && <span className="pill bg-warn-bg text-warn">Draft v{version?.number ?? ""}, not live</span>}
          </div>
          <h1 className="h1 break-words">{content.title}</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            {hub ? <>{content.sourceName}{content.publicationDate ? `, ${content.publicationDate}` : ""}</> : <>
              {space?.name}{content.currentVersionNumber && !isDraft ? ` · Version ${content.currentVersionNumber}` : ""}
              {content.approvedByName && !isDraft ? ` · approved by ${content.approvedByName}${content.approvedAt ? ` on ${fmtDate(content.approvedAt)}` : ""}` : ""}
              {content.effectiveDate ? ` · effective ${fmtDate(content.effectiveDate)}` : ""}
            </>}
          </p>
        </div>
        {!hub && !isDraft && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={toggleFav} aria-pressed={fav} aria-label={fav ? "Remove from favourites" : "Add to favourites"}><Star className={cx("h-5 w-5", fav && "fill-current text-brand")} /></Button>
            <Button size="sm" variant="ghost" onClick={toggleOffline} disabled={!!saving || !pages} aria-label={saved ? "Remove offline copy" : "Save for offline"}>{saved ? <CloudOff className="h-5 w-5" /> : <CloudDownload className="h-5 w-5" />}<span className="hidden sm:inline">{saving ?? (saved ? "Saved" : "Save offline")}</span></Button>
          </div>
        )}
      </div>
      {content.description && <p className="mt-3 max-w-prose">{content.description}</p>}
      {!hub && isOverdue(content.reviewDate) && <Banner tone="warn" title="Review date has passed">This document was due for review on {fmtDate(content.reviewDate)}. It is still the current approved version. Check with the document owner if unsure.</Banner>}
      {needsAck && <Banner tone="warn" title="Must read" action={<Button variant="primary" size="sm" busy={ackBusy} onClick={acknowledge}><BookOpenCheck className="h-4 w-4" />I have read this</Button>}>Your hospital asks every member of staff to read this version and confirm.</Banner>}
      {acked && content.mustRead && !isDraft && <p className="mb-3 mt-3 text-sm font-bold text-ok">✓ You've acknowledged this version.</p>}
      {hub && content.originalUrl && <a href={content.originalUrl} target="_blank" rel="noreferrer" className="link mt-2 inline-flex items-center gap-1 text-sm">Original publication <ExternalLink className="h-4 w-4" /></a>}

      {content.type === "link" && (content.url || version?.url) && (
        <a href={(version?.url ?? content.url)!} target="_blank" rel="noreferrer noopener" className="btn btn-primary mt-4"><ExternalLink className="h-4 w-4" />Open link</a>
      )}

      <div className="mt-5">
        {loadErr ? <Empty title="Can't open this document">{loadErr}</Empty> : !pages ? <Spinner label="Opening document…" /> : count === 0 ? <Empty title="No content">This document has no readable pages.</Empty> : (
          <>
            {(count > 1 || images) && (
              <div className="sticky top-[53px] z-20 -mx-4 mb-3 flex items-center justify-between gap-2 border-b border-rule bg-page/95 px-4 py-2 backdrop-blur md:top-0">
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Previous page"><ChevronLeft className="h-5 w-5" /></Button>
                  <label className="sr-only" htmlFor="pg">Page</label>
                  <select id="pg" className="input !min-h-[36px] w-auto py-1" value={cur?.n ?? 1} onChange={(e) => go(Number(e.target.value))}>
                    {pages.map((p) => <option key={p.n} value={p.n}>{/^\d+$/.test(p.label) ? `Page ${p.label}` : p.label} of {count}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" disabled={page >= count} onClick={() => go(page + 1)} aria-label="Next page"><ChevronRight className="h-5 w-5" /></Button>
                </div>
                {images && (
                  <div className="flex rounded-lg border border-rule p-0.5" role="group" aria-label="View">
                    <button className={cx("flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-bold", effectiveMode === "image" ? "bg-ink text-page" : "text-ink-2")} aria-pressed={effectiveMode === "image"} onClick={() => setMode("image")}><ImageIcon className="h-4 w-4" />Page</button>
                    <button className={cx("flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-bold", effectiveMode === "text" ? "bg-ink text-page" : "text-ink-2")} aria-pressed={effectiveMode === "text"} onClick={() => setMode("text")}><Type className="h-4 w-4" />Text</button>
                  </div>
                )}
              </div>
            )}
            {quote && effectiveMode === "text" && <p className="mb-2 text-sm text-ink-2">The cited passage is highlighted.</p>}
            {cur && (effectiveMode === "image" && base ? <PageImage base={base} n={cur.n} alt={`${content.title}, page ${cur.label}`} /> : content.type === "checklist" ? (
              <div className="card p-4">
                <ul className="space-y-2">
                  {cur.text.split("\n").filter((l) => /^\d+\.\s/.test(l)).map((l, i) => (
                    <li key={i}><label className="flex items-start gap-3 text-[17px]"><input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--brand))]" checked={!!checks[i]} onChange={(e) => setChecks({ ...checks, [i]: e.target.checked })} /><span className={cx(checks[i] && "text-ink-2 line-through")}>{l.replace(/^\d+\.\s/, "")}</span></label></li>
                  ))}
                </ul>
                <p className="mt-4 text-[13px] text-ink-2">Ticks are only on this screen and aren't saved.</p>
              </div>
            ) : <TextPage page={cur} quote={quote && cur.n === Number(params.get("page") || cur.n) ? quote : ""} />)}
            {count > 1 && (
              <div className="mt-4 flex justify-between">
                <Button disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft className="h-4 w-4" />Previous</Button>
                <Button disabled={page >= count} onClick={() => go(page + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
              </div>
            )}
          </>
        )}
      </div>
      {!hub && s.canEditSomewhere && (s.isManager || s.member?.editSpaceIds.includes(content.spaceId) || s.member?.approveSpaceIds.includes(content.spaceId)) && (
        <p className="mt-8 text-sm"><Link to={`/app/admin/content/${contentId}`} className="link">Manage this document →</Link></p>
      )}
    </div>
  );
}
