import { useState } from "react";
import { collection, query } from "firebase/firestore";
import { ArrowDown, ArrowUp, Lock, Plus } from "lucide-react";
import { db } from "../../lib/firebase";
import { api } from "../../lib/api";
import { useSession, type WithId } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { Banner, Button, Check, ConfirmButton, ErrorText, Modal, PageHead, SelectField, Spinner, TextArea, TextField, toast } from "../../components/ui";
import { JOB_TITLES, SPACE_TEMPLATES } from "../../../../shared/src/config";
import type { Member, Section, Space } from "../../../../shared/src/types";
import { AdminNav, useMembers } from "./shared";

function PeoplePicker({ label, help, members, value, onChange }: { label: string; help?: string; members: Member[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const chosen = members.filter((m) => value.includes(m.userId));
  const options = members.filter((m) => !value.includes(m.userId) && m.status === "active" && (!q || `${m.name} ${m.email} ${m.jobTitle}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  return (
    <div className="mb-4">
      <span className="label">{label}</span>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chosen.length === 0 && <span className="text-[14px] text-ink-2">Nobody yet</span>}
        {chosen.map((m) => <button key={m.userId} type="button" className="chip" onClick={() => onChange(value.filter((x) => x !== m.userId))} aria-label={`Remove ${m.name}`}>{m.name || m.email} ✕</button>)}
      </div>
      <input className="input" placeholder="Search people to add" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Add to ${label}`} />
      {q && <ul className="card mt-1 divide-y divide-rule">{options.length === 0 ? <li className="px-3 py-2 text-ink-2">No matches. Invite them first.</li> : options.map((m) => <li key={m.userId}><button type="button" className="w-full px-3 py-2 text-left hover:bg-soft" onClick={() => { onChange([...value, m.userId]); setQ(""); }}><b>{m.name || m.email}</b> <span className="text-sm text-ink-2">{m.jobTitle}</span></button></li>)}</ul>}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

function SpaceForm({ space, open, onClose, members }: { space: WithId<Space> | null; open: boolean; onClose: () => void; members: Member[] }) {
  const s = useSession();
  const [f, setF] = useState(() => ({
    name: space?.name ?? "", colour: space?.colour ?? "#0E7A68", description: space?.description ?? "", visibility: space?.visibility ?? "all",
    allowedJobTitles: space?.allowedJobTitles ?? [], allowedUserIds: space?.allowedUserIds ?? [], editorIds: space?.editorIds ?? [], approverIds: space?.approverIds ?? [],
    requiresApproval: space?.requiresApproval ?? true, sections: "Protocols, SOPs, Forms",
  }));
  const [confirmNonClinical, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const payload = { instId: s.instId, name: f.name, colour: f.colour, description: f.description, visibility: f.visibility, allowedJobTitles: f.allowedJobTitles, allowedUserIds: f.allowedUserIds, editorIds: f.editorIds, approverIds: f.approverIds, requiresApproval: f.requiresApproval, confirmNonClinical };
      if (space) await api("updateSpace", { ...payload, spaceId: space.id });
      else await api("createSpace", { ...payload, sections: f.sections.split(",").map((x) => x.trim()).filter(Boolean) });
      toast("Saved"); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={space ? `Edit ${space.name}` : "New space"} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      <ErrorText error={err} />
      <div className="grid gap-x-3 sm:grid-cols-[1fr_120px]">
        <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <TextField label="Colour" type="color" value={f.colour} onChange={(e) => setF({ ...f, colour: e.target.value })} className="[&_input]:h-11 [&_input]:p-1" />
      </div>
      <TextArea label="Description (optional)" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      {!space && <TextField label="Sections" value={f.sections} onChange={(e) => setF({ ...f, sections: e.target.value })} help="Separate with commas. You can change them later." />}
      <SelectField label="Who can see it" value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as "all" | "restricted" })} options={[{ value: "all", label: "Everyone in the institution" }, { value: "restricted", label: "Only chosen job titles or people" }]} />
      {f.visibility === "restricted" && (
        <>
          <fieldset className="mb-4"><legend className="label">Job titles</legend><div className="flex flex-wrap gap-1.5">{JOB_TITLES.map((t) => <button key={t} type="button" aria-pressed={f.allowedJobTitles.includes(t)} className={`chip ${f.allowedJobTitles.includes(t) ? "border-ink bg-ink text-page" : ""}`} onClick={() => setF({ ...f, allowedJobTitles: f.allowedJobTitles.includes(t) ? f.allowedJobTitles.filter((x) => x !== t) : [...f.allowedJobTitles, t] })}>{t}</button>)}</div></fieldset>
          <PeoplePicker label="People added by name" members={members} value={f.allowedUserIds} onChange={(v) => setF({ ...f, allowedUserIds: v })} />
        </>
      )}
      <PeoplePicker label="Editors" help="Can upload and update documents here. Admins can always edit." members={members} value={f.editorIds} onChange={(v) => setF({ ...f, editorIds: v })} />
      <Check label="Clinical approval required" help="Documents need a named approver before they go live. Switch off only for non-clinical spaces such as HR or billing." checked={f.requiresApproval} onChange={(v) => setF({ ...f, requiresApproval: v })} />
      {!f.requiresApproval && space?.requiresApproval !== false && !["billing", "hr"].includes(space?.template ?? "") && <Check label="I confirm this space holds no clinical content" checked={confirmNonClinical} onChange={setConfirm} />}
      {f.requiresApproval && <PeoplePicker label="Clinical approvers" help="At least one. They're told when something is submitted." members={members} value={f.approverIds} onChange={(v) => setF({ ...f, approverIds: v })} />}
    </Modal>
  );
}

function Sections({ space, sections }: { space: WithId<Space>; sections: WithId<Section>[] }) {
  const s = useSession();
  const [name, setName] = useState("");
  const list = sections.filter((x) => x.spaceId === space.id && !x.archived).sort((a, b) => a.order - b.order);
  const move = async (i: number, d: number) => { const ids = list.map((x) => x.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await api("reorderSections", { instId: s.instId, spaceId: space.id, sectionIds: ids }).catch((e) => toast(e.message)); };
  return (
    <div className="mt-3 border-t border-rule pt-3">
      <p className="mb-1 text-sm font-bold text-ink-2">Sections</p>
      <ul className="mb-2">
        {list.map((sec, i) => (
          <li key={sec.id} className="flex items-center gap-1 py-1">
            <span className="flex-1">{sec.name}</span>
            <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => { const n = prompt("Rename section", sec.name); if (n?.trim()) api("saveSection", { instId: s.instId, spaceId: space.id, sectionId: sec.id, name: n.trim() }).catch((e) => toast(e.message)); }}>Rename</Button>
            <Button size="sm" variant="ghost" onClick={() => api("saveSection", { instId: s.instId, spaceId: space.id, sectionId: sec.id, archived: true }).then(() => toast("Section archived")).catch((e) => toast(e.message))}>Archive</Button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; api("saveSection", { instId: s.instId, spaceId: space.id, name: name.trim() }).then(() => setName("")).catch((er) => toast(er.message)); }}>
        <input className="input" placeholder="New section" value={name} onChange={(e) => setName(e.target.value)} aria-label="New section name" />
        <Button size="sm" type="submit">Add</Button>
      </form>
    </div>
  );
}

export default function Spaces() {
  const s = useSession();
  const members = useMembers();
  const sections = useQuery<Section>(s.instId ? query(collection(db, "institutions", s.instId, "sections")) : null, `allsecs:${s.instId}`);
  const [edit, setEdit] = useState<WithId<Space> | null | "new">(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [tpls, setTpls] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const existing = new Set(s.spaces.map((x) => x.template).filter(Boolean));
  const move = async (i: number, d: number) => { const ids = s.spaces.map((x) => x.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await api("reorderSpaces", { instId: s.instId, spaceIds: ids }).catch((e) => toast(e.message)); };
  const name = (uid: string) => members.data?.find((m) => m.userId === uid)?.name ?? "";
  return (
    <div>
      <PageHead title="Spaces" sub="Departments and who can see, edit and approve in each." actions={<><Button size="sm" onClick={() => setTplOpen(true)}>Add from templates</Button><Button size="sm" variant="primary" onClick={() => setEdit("new")}><Plus className="h-4 w-4" />New space</Button></>} />
      <AdminNav />
      {!s.spacesReady || !members.data ? <Spinner /> : (
        <ul className="grid gap-3">
          {s.spaces.map((sp, i) => (
            <li key={sp.id} className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-1 h-8 w-1.5 rounded-full" style={{ background: sp.colour }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-2 text-lg font-bold">{sp.name}{sp.visibility === "restricted" && <Lock className="h-4 w-4 text-ink-2" aria-label="Restricted" />}</h2>
                  <p className="text-[14px] text-ink-2">
                    {sp.visibility === "restricted" ? `Restricted to ${[...sp.allowedJobTitles, ...sp.allowedUserIds.map(name)].filter(Boolean).join(", ") || "nobody yet"}` : "Everyone"}
                    {" · "}{sp.requiresApproval ? (sp.approverNames.length ? `Approvers: ${sp.approverNames.join(", ")}` : <b className="text-warn">No approver</b>) : "No approval step"}
                    {sp.editorIds.length ? ` · Editors: ${sp.editorIds.map(name).filter(Boolean).join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === s.spaces.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" onClick={() => setEdit(sp)}>Edit</Button>
                  <Button size="sm" variant="ghost" aria-expanded={open === sp.id} onClick={() => setOpen(open === sp.id ? null : sp.id)}>Sections</Button>
                </div>
              </div>
              {open === sp.id && sections.data && (
                <>
                  <Sections space={sp} sections={sections.data} />
                  <div className="mt-3"><ConfirmButton title={`Archive ${sp.name}?`} confirmLabel="Archive space" confirm="Staff will stop seeing this space and its documents. Documents are kept and the space can be restored by support." onConfirm={() => api("updateSpace", { instId: s.instId, spaceId: sp.id, archived: true })}>Archive space</ConfirmButton></div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.spaces.some((x) => x.requiresApproval && !x.approverIds.length) && <div className="mt-4"><Banner tone="warn">Spaces without an approver can't publish documents. Name at least one approver.</Banner></div>}
      {edit && members.data && <SpaceForm key={edit === "new" ? "new" : edit.id} space={edit === "new" ? null : edit} open onClose={() => setEdit(null)} members={members.data} />}
      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title="Add from templates" footer={<Button variant="primary" disabled={!tpls.length} onClick={async () => { try { await api("addSpacesFromTemplates", { instId: s.instId, templates: tpls }); toast("Spaces added"); setTplOpen(false); setTpls([]); } catch (e) { toast((e as Error).message); } }}>Add {tpls.length || ""}</Button>}>
        {SPACE_TEMPLATES.filter((t) => !existing.has(t.key)).map((t) => <Check key={t.key} label={t.name} help={t.sections.join(", ")} checked={tpls.includes(t.key)} onChange={(v) => setTpls(v ? [...tpls, t.key] : tpls.filter((x) => x !== t.key))} />)}
        {SPACE_TEMPLATES.every((t) => existing.has(t.key)) && <p className="text-ink-2">You've added every template.</p>}
      </Modal>
    </div>
  );
}
