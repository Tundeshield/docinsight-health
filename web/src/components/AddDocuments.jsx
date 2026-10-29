import { useState } from "react";
import { ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "../firebase.js";
import { call } from "../lib/api.js";
import { CATS } from "../lib/constants.js";

const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f.name);
const TYPE_BY_EXT = { pdf: "application/pdf", md: "text/markdown", markdown: "text/markdown", txt: "text/plain", html: "text/html", htm: "text/html", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff" };
const contentType = (f) => f.type || TYPE_BY_EXT[(f.name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
const safeName = (n, i, photos) => photos ? `page-${String(i + 1).padStart(4, "0")}.${(n.split(".").pop() || "jpg").toLowerCase()}` : n.replace(/[^\w.\- ]+/g, "_");

export default function AddDocuments({ orgId, onClose, onAdded }) {
  const [meta, setMeta] = useState({ category: "protocol", area: "", version: "", reviewDate: "", title: "" });
  const [files, setFiles] = useState([]); const [over, setOver] = useState(false);
  const [readScans, setReadScans] = useState(true);
  const [progress, setProgress] = useState(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });
  const photos = files.length > 1 || (files[0] && isImage(files[0]));
  const pick = (list) => {
    setErr("");
    const arr = [...list];
    if (arr.length > 1 && !arr.every(isImage)) { setErr("Add documents one at a time. You can select several files only when they're photos of one document's pages."); return; }
    const sorted = arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setFiles(sorted);
    if (!meta.title && sorted[0]) setMeta((m) => ({ ...m, title: sorted.length > 1 ? "" : sorted[0].name.replace(/\.[^.]+$/, "") }));
  };
  const submit = async () => {
    if (!files.length) { setErr("Choose a file first."); return; }
    if (photos && !meta.title.trim()) { setErr("Give the photographed document a title."); return; }
    setBusy(true); setErr("");
    try {
      const { srcId, uploadPrefix } = await call("createSource", { orgId, ...meta, readScans, files: files.map((f) => ({ name: f.name, size: f.size })) });
      const total = files.reduce((a, f) => a + f.size, 0); let done = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        await new Promise((res, rej) => {
          const task = uploadBytesResumable(ref(storage, uploadPrefix + safeName(f.name, i, photos)), f, { contentType: contentType(f) });
          let last = 0;
          task.on("state_changed", (s) => { done += s.bytesTransferred - last; last = s.bytesTransferred; setProgress(done / total); }, rej, res);
        });
      }
      await call("processSource", { orgId, srcId });
      onAdded(meta.title || files[0].name); onClose();
    } catch (e) {
      setErr(e.code === "storage/unauthorized" ? "Upload was refused. Check you're still a library manager and try again." : e.message || "Upload failed. Check your connection and try again.");
      setBusy(false); setProgress(null);
    }
  };
  return (<>
    <div className="scrim" onClick={() => !busy && onClose()} />
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="addTitle">
      <h4 id="addTitle">Add a document</h4>
      <p className="sub">Everyone in your hospital can ask about documents you add. Large and scanned documents are processed in the background, so you can close this window after uploading.</p>
      <div className="field"><label htmlFor="cat">Document type</label>
        <select id="cat" value={meta.category} onChange={set("category")}>{Object.entries(CATS).map(([k, c]) => <option key={k} value={k}>{c.one} ({c.hint})</option>)}</select></div>
      <div className={`drop${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}>
        {files.length ? <><strong>{files.length > 1 ? `${files.length} photos selected` : files[0].name}</strong> <label className="btn small" style={{ marginLeft: 8 }}>Change<input type="file" hidden multiple accept=".pdf,.md,.txt,.html,.htm,image/*" onChange={(e) => pick(e.target.files)} /></label></>
          : <><strong>Drop a file here</strong> or <label className="btn small" style={{ marginLeft: 6 }}>Choose file<input type="file" hidden multiple accept=".pdf,.md,.txt,.html,.htm,image/*" onChange={(e) => pick(e.target.files)} /></label>
            <div style={{ marginTop: 6, fontSize: 13 }}>PDF (scanned copies too), phone photos of pages, web pages or text. To add photos of one document, select all the pages at once.</div></>}
      </div>
      <div style={{ height: 14 }} />
      <div className="field"><label htmlFor="title">Title</label><input id="title" value={meta.title} onChange={set("title")} placeholder="e.g. Adult sepsis escalation protocol" /></div>
      <div className="field"><label htmlFor="area">Department, equipment model or system</label><input id="area" value={meta.area} onChange={set("area")} placeholder="e.g. Emergency department, Mindray SV300, Paediatrics" /></div>
      <div className="two">
        <div className="field"><label htmlFor="ver">Version or effective date</label><input id="ver" value={meta.version} onChange={set("version")} placeholder="e.g. v3.2, March 2026" /></div>
        <div className="field"><label htmlFor="rev">Next review due</label><input id="rev" type="date" value={meta.reviewDate} onChange={set("reviewDate")} /><small>Staff are warned when a document is past review.</small></div>
      </div>
      <label className="check"><input type="checkbox" checked={readScans} onChange={(e) => setReadScans(e.target.checked)} /><span>Read scanned pages and photos<br /><span className="muted" style={{ fontSize: 14 }}>Claude transcribes them exactly, marking anything it can't read with certainty. About 30 seconds per 4 pages.</span></span></label>
      {progress != null && <div className="bar" aria-label="Upload progress"><span style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} /></div>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy}>{busy ? (progress != null && progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Starting…") : "Add document"}</button>
      </div>
    </div>
  </>);
}
