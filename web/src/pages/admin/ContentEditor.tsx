import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { collection, doc, orderBy, query, where } from "firebase/firestore";
import { CheckCircle2, Eye, FileUp, RotateCcw } from "lucide-react";
import { db } from "../../lib/firebase";
import { api, ApiError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useDoc, useQuery } from "../../lib/hooks";
import { loadText, pageImageUrl, versionBase, hasPageImages } from "../../lib/storage";
import { mdToHtml } from "../../lib/markdown";
import { fmtDate, fmtDateTime } from "../../lib/format";
import { Banner, Button, Check, ConfirmButton, Empty, ErrorText, Modal, PageHead, SelectField, Spinner, StatusPill, TextArea, TextField, toast } from "../../components/ui";
import { DOCUMENT_TYPES } from "../../../../shared/src/config";
import type { ContentItem, ContentType, ContentVersion, PageText, Section } from "../../../../shared/src/types";
import { ACCEPT, mimeOf, uploadFile } from "./upload";
import { AdminNav, useManagedSpaceIds, useMembers } from "./shared";

const TYPES: { value: ContentType; label: string; help: string }[] = [
  { value: "file", label: "Upload a file", help: "PDF, Word (.docx), or a photo of a page (JPG, PNG). Scans are read automatically." },
  { value: "page", label: "Write a page", help: "Type or paste the content. Use # for headings and - for lists." },
  { value: "checklist", label: "Checklist", help: "One item per line." },
  { value: "link", label: "Link", help: "A web page or a file kept elsewhere." },
];

interface BodyState { type: ContentType; file: File | null; body: string; checklist: string; url: string }

function BodyFields({ v, set }: { v: BodyState; set: (x: Partial<BodyState>) => void }) {
  const [preview, setPreview] = useState(false);
  if (v.type === "file" || v.type === "image") return (
    <div className="mb-4">
      <label className="label" htmlFor="file">File</label>
      <input id="file" type="file" accept={ACCEPT} className="block w-full text-[15px] file:mr-3 file:rounded-lg file:border file:border-rule file:bg-surface file:px-4 file:py-2.5 file:font-bold" onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
      <span className="help">Up to 100 MB. Split very large manuals into parts.</span>
    </div>
  );
  if (v.type === "page") return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between"><label className="label mb-0" htmlFor="body">Content</label><button type="button" className="link text-sm" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</button></div>
      {preview ? <div className="card prose-doc max-h-[60vh] overflow-auto p-4" dangerouslySetInnerHTML={{ __html: mdToHtml(v.body) }} /> : <textarea id="body" className="input min-h-[280px] font-mono text-[15px]" value={v.body} onChange={(e) => set({ body: e.target.value })} placeholder={"# Title\n\n## When to use\n- …\n\n## Steps\n1. …"} />}
    </div>
  );
  if (v.type === "checklist") return <TextArea label="Items, one per line" value={v.checklist} onChange={(e) => set({ checklist: e.target.value })} rows={8} />;
  return <TextField label="Link" type="url" placeholder="https://" value={v.url} onChange={(e) => set({ url: e.target.value })} />;
}

function bodyPayload(v: BodyState) {
  return {
    ...(v.file && { file: { name: v.file.name, size: v.file.size, mime: mimeOf(v.file) } }),
    ...(v.type === "page" && { body: v.body }),
    ...(v.type === "checklist" && { checklist: v.checklist.split("\n").map((x) => x.trim()).filter(Boolean) }),
    ...(v.type === "link" && { url: v.url.trim() }),
  };
}

export function ContentNew() {
  const s = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const editable = useManagedSpaceIds("edit");
  const spaces = s.spaces.filter((x) => editable.includes(x.id));
  const [spaceId, setSpaceId] = useState(params.get("space") && editable.includes(params.get("space")!) ? params.get("space")! : spaces[0]?.id ?? "");
  const [sectionId, setSectionId] = useState("");
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("protocol");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [language, setLanguage] = useState("en");
  const [effectiveDate, setEffective] = useState("");
  const [reviewDate, setReview] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return d.toISOString().slice(0, 10); });
  const [mustRead, setMustRead] = useState(false);
  const [body, setBodyState] = useState<BodyState>({ type: "file", file: null, body: "", checklist: "", url: "" });
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sections = useQuery<Section>(s.instId && spaceId ? query(collection(db, "institutions", s.instId, "sections"), where("spaceId", "==", spaceId)) : null, `secs:${spaceId}`);
  const setBody = (x: Partial<BodyState>) => setBodyState((b) => ({ ...b, ...x }));
  useEffect(() => { if (body.file && !title) setTitle(body.file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")); }, [body.file]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!spaces.length) return <><PageHead title="Add document" /><Empty title="No spaces to add to">{s.isManager ? <>Create a space first in <Link className="link" to="/app/admin/spaces">Spaces</Link>.</> : "You aren't an editor of any space."}</Empty></>;
  if (!s.caps.upload) return <><PageHead title="Add document" /><Banner tone="warn" title="Uploads are paused">Your institution's subscription needs attention.</Banner></>;

  const submit = async () => {
    setErr(null);
    if (!title.trim()) return setErr("Add a title.");
    if (body.type === "file" && !body.file) return setErr("Choose a file to upload.");
    const type: ContentType = body.type === "file" && body.file && /^image\//.test(mimeOf(body.file)) ? "image" : body.type;
    setProgress("Saving…");
    try {
      const r = await api<{ contentId: string; versionId: string; uploadPath: string | null }>("createContent", {
        instId: s.instId, spaceId, sectionId: sectionId || null, type, title: title.trim(), documentType, description, language,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean), effectiveDate: effectiveDate || null, reviewDate: reviewDate || null, mustRead,
        ...bodyPayload({ ...body, type }),
      });
      if (r.uploadPath && body.file) {
        await uploadFile(r.uploadPath, body.file, (p) => setProgress(`Uploading… ${p}%`));
        setProgress("Starting processing…");
        await api("processVersion", { instId: s.instId, contentId: r.contentId, versionId: r.versionId });
      }
      nav(`/app/admin/content/${r.contentId}`, { replace: true });
    } catch (e) { setErr((e as Error).message); setProgress(null); }
  };

  return (
    <div className="max-w-2xl">
      <PageHead title="Add document" back={{ to: "/app/admin/content", label: "Documents" }} />
      <ErrorText error={err} />
      <fieldset className="mb-4">
        <legend className="label">What are you adding?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((t) => (
            <label key={t.value} className={`card flex cursor-pointer items-start gap-3 p-3 ${body.type === t.value ? "border-2 border-brand" : ""}`}>
              <input type="radio" name="type" className="mt-1 h-5 w-5 accent-[rgb(var(--brand))]" checked={body.type === t.value} onChange={() => setBody({ type: t.value })} />
              <span><b>{t.label}</b><span className="block text-sm text-ink-2">{t.help}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <BodyFields v={body} set={setBody} />
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid gap-x-3 sm:grid-cols-2">
        <SelectField label="Space" value={spaceId} onChange={(e) => { setSpaceId(e.target.value); setSectionId(""); }} options={spaces.map((x) => ({ value: x.id, label: x.name }))} />
        <SelectField label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} options={[{ value: "", label: "None" }, ...(sections.data ?? []).filter((x) => !x.archived).sort((a, b) => a.order - b.order).map((x) => ({ value: x.id, label: x.name }))]} />
        <SelectField label="Document type" value={documentType} onChange={(e) => setDocumentType(e.target.value)} options={DOCUMENT_TYPES.map((d) => ({ value: d.id, label: d.label }))} />
        <SelectField label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={[{ value: "en", label: "English" }, { value: "fr", label: "French" }]} />
        <TextField label="Effective date" type="date" value={effectiveDate} onChange={(e) => setEffective(e.target.value)} />
        <TextField label="Review date" type="date" value={reviewDate} onChange={(e) => setReview(e.target.value)} help="The owner is reminded 30 and 7 days before." />
      </div>
      <TextArea label="Short description (optional)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      <TextField label="Tags (optional)" placeholder="sepsis, antibiotics" value={tags} onChange={(e) => setTags(e.target.value)} help="Separate with commas. Helps search." />
      {s.isManager && <Check label="Must read" help="Staff are asked to open it and confirm they've read it once it's approved." checked={mustRead} onChange={setMustRead} />}
      <div className="sticky bottom-16 -mx-4 mt-4 flex items-center justify-end gap-3 border-t border-rule bg-page px-4 py-3 md:bottom-0">
        {progress && <span role="status" className="text-sm text-ink-2">{progress}</span>}
        <Button variant="primary" busy={!!progress} onClick={submit}><FileUp className="h-4 w-4" />Save draft</Button>
      </div>
    </div>
  );
}

export function PageChecker({ instId, content, version, onDone, hub = false }: { instId: string; content: ContentItem & { id: string }; version: ContentVersion & { id: string }; onDone: () => void; hub?: boolean }) {
  const base = versionBase({ instId, hub, spaceId: content.spaceId, contentId: content.id, versionId: version.id, draft: true });
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const todo = version.lowConfidencePages.filter((n) => !version.checkedPages.includes(n));
  const [idx, setIdx] = useState(0);
  const n = todo[Math.min(idx, todo.length - 1)];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadText(base).then(setPages).catch(() => setErr("Couldn't load the page text.")); }, [base]);
  useEffect(() => { if (n) { setImg(null); pageImageUrl(base, n).then(setImg).catch(() => undefined); } setText(pages?.find((p) => p.n === n)?.text ?? ""); }, [n, pages, base]);
  if (!todo.length) return null;
  const confirm = async () => {
    setBusy(true); setErr(null);
    try { await api(hub ? "hubSavePageCorrections" : "savePageCorrections", { instId, contentId: content.id, versionId: version.id, pages: [{ n, text }], checked: [n] }); toast(`Page ${n} checked`); if (todo.length === 1) onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const p = pages?.find((x) => x.n === n);
  return (
    <section className="card mb-5 p-4">
      <h2 className="h2">Check scanned pages <span className="pill ml-1 bg-warn-bg text-warn">{todo.length} left</span></h2>
      <p className="mt-1 text-[15px] text-ink-2">These pages were hard to read. Compare the text with the image, fix any mistakes (especially doses and numbers), then confirm. This version can't be approved until every page is checked.</p>
      <ErrorText error={err} />
      {!pages ? <Spinner /> : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>{img ? <img src={img} alt={`Scanned page ${n}`} className="w-full rounded-lg border border-rule bg-white" /> : <Spinner label="Loading page image…" />}</div>
          <div>
            <p className="mb-1 text-sm font-bold">Page {p?.label ?? n} · read with {Math.round((p?.confidence ?? 0) * 100)}% confidence</p>
            <textarea className="input min-h-[360px] font-mono text-[14px]" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Text of page ${n}`} />
            <div className="mt-2 flex flex-wrap justify-between gap-2">
              <div className="flex gap-1">{todo.length > 1 && <><Button size="sm" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Previous</Button><Button size="sm" disabled={idx >= todo.length - 1} onClick={() => setIdx(idx + 1)}>Skip</Button></>}</div>
              <Button variant="primary" busy={busy} onClick={confirm}><CheckCircle2 className="h-4 w-4" />Text is correct</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function NewVersion({ content, open, onClose }: { content: ContentItem & { id: string }; open: boolean; onClose: () => void }) {
  const s = useSession();
  const [body, setBodyState] = useState<BodyState>({ type: content.type, file: null, body: "", checklist: "", url: content.url ?? "" });
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const submit = async () => {
    setErr(null);
    if ((content.type === "file" || content.type === "image") && !body.file) return setErr("Choose the new file.");
    if (!note.trim()) return setErr("Say what changed. Staff see this note.");
    setProgress("Saving…");
    try {
      const r = await api<{ versionId: string; uploadPath: string | null }>("addVersion", { instId: s.instId, contentId: content.id, changeNote: note.trim(), replaceDraft: replace, ...bodyPayload(body) });
      if (r.uploadPath && body.file) {
        await uploadFile(r.uploadPath, body.file, (p) => setProgress(`Uploading… ${p}%`));
        await api("processVersion", { instId: s.instId, contentId: content.id, versionId: r.versionId });
      }
      toast("New version saved"); onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details?.reason === "open_version") setReplace(true);
      setErr((e as Error).message);
    } finally { setProgress(null); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Upload a new version" wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={!!progress} onClick={submit}>{progress ?? "Save new version"}</Button></>}>
      <p className="mb-3 text-[15px] text-ink-2">The current live version stays live until the new one is approved.</p>
      <ErrorText error={err} />
      {replace && <Check label="Discard the version in progress and use this one" checked={replace} onChange={setReplace} />}
      <BodyFields v={body} set={(x) => setBodyState((b) => ({ ...b, ...x }))} />
      <TextArea label="What changed?" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Updated the oxytocin dose in section 3" />
    </Modal>
  );
}

function Details({ content }: { content: ContentItem & { id: string } }) {
  const s = useSession();
  const members = useMembers();
  const [f, setF] = useState({ title: content.title, documentType: content.documentType, description: content.description, tags: content.tags.join(", "), effectiveDate: content.effectiveDate ?? "", reviewDate: content.reviewDate ?? "", sectionId: content.sectionId ?? "", spaceId: content.spaceId, ownerId: content.ownerId });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sections = useQuery<Section>(s.instId ? query(collection(db, "institutions", s.instId, "sections"), where("spaceId", "==", f.spaceId)) : null, `secs:${f.spaceId}`);
  const editable = useManagedSpaceIds("edit");
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api("updateContent", { instId: s.instId, contentId: content.id, title: f.title, documentType: f.documentType, description: f.description, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean), effectiveDate: f.effectiveDate || null, reviewDate: f.reviewDate || null, sectionId: f.sectionId || null, ...(f.spaceId !== content.spaceId && { spaceId: f.spaceId }), ...(f.ownerId !== content.ownerId && { ownerId: f.ownerId }) });
      toast("Saved");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card mb-5 p-4">
      <h2 className="h2 mb-3">Details</h2>
      <ErrorText error={err} />
      <TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="grid gap-x-3 sm:grid-cols-2">
        <SelectField label="Space" value={f.spaceId} onChange={(e) => setF({ ...f, spaceId: e.target.value, sectionId: "" })} options={s.spaces.filter((x) => editable.includes(x.id)).map((x) => ({ value: x.id, label: x.name }))} help={f.spaceId !== content.spaceId ? "Moving changes who can see it." : undefined} />
        <SelectField label="Section" value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })} options={[{ value: "", label: "None" }, ...(sections.data ?? []).filter((x) => !x.archived).map((x) => ({ value: x.id, label: x.name }))]} />
        <SelectField label="Document type" value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value as ContentItem["documentType"] })} options={DOCUMENT_TYPES.map((d) => ({ value: d.id, label: d.label }))} />
        {s.isManager && members.data ? <SelectField label="Owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} options={members.data.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name || m.email }))} help="Gets review reminders." /> : <div />}
        <TextField label="Effective date" type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />
        <TextField label="Review date" type="date" value={f.reviewDate} onChange={(e) => setF({ ...f, reviewDate: e.target.value })} />
      </div>
      <TextArea label="Description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <TextField label="Tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
      <Button busy={busy} onClick={save}>Save details</Button>
    </section>
  );
}

export function ContentDetail() {
  const { contentId = "" } = useParams();
  const s = useSession();
  const instId = s.instId!;
  const { data: content } = useDoc<ContentItem>(doc(db, "institutions", instId, "content", contentId));
  const versions = useQuery<ContentVersion>(query(collection(db, "institutions", instId, "content", contentId, "versions"), orderBy("number", "desc")), `vers:${contentId}`);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [preview, setPreview] = useState<PageText[] | null>(null);
  const latest = versions.data?.[0];
  const space = s.spaces.find((x) => x.id === content?.spaceId);
  const canEdit = s.isManager || (!!content && !!s.member?.editSpaceIds.includes(content.spaceId));
  const canApprove = s.isManager || (!!content && !!s.member?.approveSpaceIds.includes(content.spaceId));
  useEffect(() => {
    if (!content || !latest || !["draft", "in_review", "changes_requested"].includes(latest.status) || latest.processingError) { setPreview(null); return; }
    loadText(versionBase({ instId, spaceId: content.spaceId, contentId, versionId: latest.id, draft: true })).then(setPreview).catch(() => setPreview(null));
  }, [latest?.id, latest?.status, latest?.processedPages]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => (preview ?? []).reduce((a, p) => a + p.text.split(/\s+/).length, 0), [preview]);

  if (content === null) return <Empty title="Document not found" />;
  if (!content || !versions.data) return <Spinner />;
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(key); setErr(null); try { await fn(); if (ok) toast(ok); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  const unchecked = latest ? latest.lowConfidencePages.filter((n) => !latest.checkedPages.includes(n)) : [];

  return (
    <div>
      <PageHead title={content.title} sub={<>{space?.name} · owner {content.ownerName}</>} back={{ to: "/app/admin/content", label: "Documents" }}
        actions={<>
          {content.published && <Link className="btn btn-sm" to={`/app/doc/${content.id}`}><Eye className="h-4 w-4" />View live</Link>}
          {canEdit && content.status !== "archived" && <Button size="sm" onClick={() => setNewOpen(true)}><FileUp className="h-4 w-4" />New version</Button>}
        </>} />
      <AdminNav />
      <ErrorText error={err} />
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusPill status={content.status} />
        {content.published && <span className="pill bg-ok-bg text-ok">v{content.currentVersionNumber} live</span>}
        {content.mustRead && <span className="pill bg-warn-bg text-warn">Must read</span>}
        {!space?.requiresApproval && <span className="pill bg-soft text-ink-2">Non-clinical space: no approval step</span>}
      </div>

      {latest && (
        <section className="card mb-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">Version {latest.number}</h2>
            <StatusPill status={latest.status} />
          </div>
          <p className="mt-1 text-[14px] text-ink-2">By {latest.createdByName} · {fmtDateTime(latest.createdAt)}{latest.fileName ? ` · ${latest.fileName}` : ""}{latest.pageCount ? ` · ${latest.pageCount} pages` : ""}{latest.changeNote ? ` · "${latest.changeNote}"` : ""}</p>
          {(latest.status === "uploading" || latest.status === "processing") && (
            <div className="mt-3" role="status">
              <p className="font-bold">{latest.status === "uploading" ? "Waiting for the upload to finish…" : `Processing${latest.processedPages ? `: ${latest.processedPages} pages done` : "…"}`}</p>
              <p className="text-[14px] text-ink-2">Reading the text, scanning images and preparing pages. Large scanned manuals can take a few minutes. You can leave this page.</p>
              {latest.status === "uploading" && canEdit && <Button size="sm" className="mt-2" onClick={() => run("proc", () => api("processVersion", { instId, contentId, versionId: latest.id }))}><RotateCcw className="h-4 w-4" />Start processing</Button>}
            </div>
          )}
          {latest.processingError && <Banner tone="warn" title="Couldn't process this version">{latest.processingError}{canEdit && <> <button className="link" onClick={() => run("proc", () => api("processVersion", { instId, contentId, versionId: latest.id }), "Trying again")}>Try again</button> or upload a new version.</>}</Banner>}
          {latest.ocrPages.length > 0 && !latest.processingError && latest.status !== "processing" && <p className="mt-2 text-[14px]">{latest.ocrPages.length} scanned page{latest.ocrPages.length > 1 ? "s" : ""} read automatically{latest.ocrConfidence != null ? `, average confidence ${Math.round(latest.ocrConfidence * 100)}%` : ""}{latest.lowConfidencePages.length ? `. ${latest.lowConfidencePages.length - unchecked.length} of ${latest.lowConfidencePages.length} hard-to-read pages checked.` : "."}</p>}
          {latest.reviewComment && ["changes_requested", "rejected"].includes(latest.status) && <Banner tone="warn" title={latest.status === "rejected" ? "Not approved" : "Changes requested"}>{latest.reviewComment}</Banner>}
          {preview && <p className="mt-2 text-[14px] text-ink-2">{preview.length} page{preview.length === 1 ? "" : "s"} of text, about {words.toLocaleString()} words. {hasPageImages(content.type, preview) ? "Page images ready." : ""}</p>}
          {["draft", "in_review", "changes_requested", "approved"].includes(latest.status) && !latest.processingError && <Link className="btn btn-sm mt-3" to={`/app/doc/${contentId}?v=${latest.id}`}><Eye className="h-4 w-4" />Preview this version</Link>}

          {canEdit && ["draft", "changes_requested"].includes(latest.status) && !latest.processingError && unchecked.length === 0 && (
            <div className="mt-4 border-t border-rule pt-4">
              <TextArea label={space?.requiresApproval ? "Note for the approver (optional)" : "What changed? (optional)"} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button variant="primary" busy={busy === "submit"} onClick={() => run("submit", () => api("submitForReview", { instId, contentId, versionId: latest.id, note }), space?.requiresApproval ? "Sent for approval" : "Publishing")}>
                {space?.requiresApproval ? `Submit for approval${space.approverNames.length ? ` (${space.approverNames.join(", ")})` : ""}` : "Publish"}
              </Button>
            </div>
          )}
          {latest.status === "in_review" && (canApprove ? (
            <div className="mt-4 border-t border-rule pt-4">
              <h3 className="mb-2 font-bold">Your decision</h3>
              <p className="mb-3 text-[14px] text-ink-2">Approving makes this version live for staff and Ask DocInsight{content.published ? `, replacing v${content.currentVersionNumber}` : ""}. Check doses, numbers and dates against the original.</p>
              <TextArea label="Comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} help="Needed if you request changes or reject." />
              <div className="flex flex-wrap gap-2">
                <Button variant="brand" busy={busy === "approve"} onClick={() => run("approve", () => api("reviewVersion", { instId, contentId, versionId: latest.id, decision: "approve", comment }), "Approved. Publishing now.")}>Approve and publish</Button>
                <Button busy={busy === "changes"} onClick={() => run("changes", () => api("reviewVersion", { instId, contentId, versionId: latest.id, decision: "changes", comment }), "Changes requested")}>Request changes</Button>
                <Button variant="ghost" busy={busy === "reject"} onClick={() => run("reject", () => api("reviewVersion", { instId, contentId, versionId: latest.id, decision: "reject", comment }), "Rejected")}>Reject</Button>
              </div>
            </div>
          ) : <p className="mt-3 text-[15px]">Waiting for approval by {space?.approverNames.join(", ") || "the space approver"}.</p>)}
        </section>
      )}

      {latest && canEdit && unchecked.length > 0 && latest.status !== "processing" && <PageChecker instId={instId} content={content} version={latest} onDone={() => toast("All pages checked. You can submit it now.")} />}

      {canEdit && <Details content={content} />}

      {s.isManager && content.published && (
        <section className="card mb-5 p-4">
          <h2 className="h2">Must read</h2>
          <p className="mt-1 text-[15px] text-ink-2">{content.mustRead ? "Staff who can see this space are asked to read and acknowledge the current version." : "Ask every member of staff in this space to confirm they've read the current version."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button busy={busy === "mr"} onClick={() => run("mr", () => api("setMustRead", { instId, contentId, mustRead: !content.mustRead }), content.mustRead ? "No longer must read" : "Marked must read. Staff have been told.")}>{content.mustRead ? "Stop asking" : "Mark as must read"}</Button>
            {content.mustRead && <Button busy={busy === "remind"} onClick={() => run("remind", async () => { const r = await api<{ reminded: number }>("remindMustRead", { instId, contentId }); toast(`Reminded ${r.reminded} people`); })}>Remind people who haven't read it</Button>}
            {content.mustRead && <Link className="btn" to={`/app/admin/must-read?content=${contentId}`}>See who has read it</Link>}
          </div>
        </section>
      )}

      <section className="card mb-5 p-4">
        <h2 className="h2 mb-2">Version history</h2>
        <ul className="divide-y divide-rule">
          {versions.data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span><b>v{v.number}</b> <StatusPill status={v.active ? "approved" : v.status} /> <span className="text-[14px] text-ink-2">{v.createdByName}, {fmtDate(v.createdAt)}{v.approvedByName ? ` · approved by ${v.approvedByName} ${fmtDate(v.approvedAt)}` : ""}{v.changeNote ? ` · ${v.changeNote}` : ""}</span></span>
              {!v.processingError && !["uploading", "processing", "rejected"].includes(v.status) && <Link className="link text-sm" to={`/app/doc/${contentId}?v=${v.id}`}>Open</Link>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-ink-2">Older versions are kept for audit. Only the live version is searched and used in answers.</p>
      </section>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {content.status === "archived"
            ? <Button busy={busy === "arch"} onClick={() => run("arch", () => api("archiveContent", { instId, contentId, archived: false }), "Restored")}>Restore</Button>
            : <ConfirmButton title="Archive this document?" confirmLabel="Archive" confirm="Staff will no longer see it, and Ask DocInsight will stop using it. It stays in the change log and can be restored." onConfirm={() => api("archiveContent", { instId, contentId, archived: true }).then(() => toast("Archived"))}>Archive</ConfirmButton>}
        </div>
      )}
      <NewVersion content={content} open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
