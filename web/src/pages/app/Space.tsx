import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useSession } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { Empty, PageHead, Spinner } from "../../components/ui";
import { DocRow } from "./common";
import type { ContentItem, Section } from "../../../../shared/src/types";

export default function SpacePage() {
  const { spaceId = "" } = useParams();
  const s = useSession();
  const space = s.spaces.find((x) => x.id === spaceId);
  const [filter, setFilter] = useState("");
  const sections = useQuery<Section>(s.instId ? query(collection(db, "institutions", s.instId, "sections"), where("spaceId", "==", spaceId)) : null, `sec:${s.instId}:${spaceId}`);
  const content = useQuery<ContentItem>(s.instId ? query(collection(db, "institutions", s.instId, "content"), where("spaceId", "==", spaceId), where("published", "==", true)) : null, `content:${s.instId}:${spaceId}`);
  const favIds = new Set<string>();
  const groups = useMemo(() => {
    const secs = (sections.data ?? []).filter((x) => !x.archived).sort((a, b) => a.order - b.order);
    const items = (content.data ?? []).filter((c) => c.status !== "archived" && (!filter || c.title.toLowerCase().includes(filter.toLowerCase()))).sort((a, b) => a.title.localeCompare(b.title));
    const out = secs.map((sec) => ({ id: sec.id, name: sec.name, items: items.filter((c) => c.sectionId === sec.id) }));
    const loose = items.filter((c) => !c.sectionId || !secs.some((x) => x.id === c.sectionId));
    if (loose.length) out.push({ id: "_", name: secs.length ? "Other" : "Documents", items: loose });
    return out.filter((g) => g.items.length);
  }, [sections.data, content.data, filter]);

  if (s.spacesReady && !space) return <Empty title="Department not found">It may have been archived, or you don't have access. <Link to="/app" className="link">Go home</Link></Empty>;
  const loading = content.data === undefined || sections.data === undefined;
  const total = content.data?.length ?? 0;
  return (
    <div>
      <PageHead title={space?.name ?? "…"} sub={space?.description} back={{ to: "/app", label: "Home" }} actions={s.canEditSomewhere && (s.isManager || s.member?.editSpaceIds.includes(spaceId)) ? <Link to={`/app/admin/content/new?space=${spaceId}`} className="btn btn-sm">Add document</Link> : undefined} />
      {total > 8 && <input className="input mb-4" placeholder={`Filter ${total} documents`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter documents" />}
      {loading ? <Spinner /> : groups.length === 0 ? <Empty title={filter ? "No matches" : "No documents yet"}>{filter ? "Try another word." : "Approved documents in this department appear here."}</Empty> : groups.map((g) => (
        <section key={g.id} className="mb-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-2">{g.name}</h2>
          <ul className="card divide-y divide-rule">{g.items.map((c) => <DocRow key={c.id} c={c} fav={favIds.has(c.id)} />)}</ul>
        </section>
      ))}
    </div>
  );
}
