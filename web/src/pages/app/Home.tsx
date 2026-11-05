import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { ArrowRight, CloudOff, Search as SearchIcon, Star } from "lucide-react";
import { db } from "../../lib/firebase";
import { useSession } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { offlineDocs, type OfflineDoc } from "../../lib/storage";
import { ago } from "../../lib/format";
import { Empty, Spinner } from "../../components/ui";
import type { InboxItem } from "../../../../shared/src/types";

export default function Home() {
  const s = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [offline, setOffline] = useState<OfflineDoc[]>([]);
  useEffect(() => { offlineDocs().then(setOffline).catch(() => undefined); }, []);
  const uid = s.user!.uid;
  const inbox = useQuery<InboxItem>(s.instId && s.caps.read ? query(collection(db, "institutions", s.instId, "members", uid, "inbox"), orderBy("at", "desc"), limit(40)) : null, `inbox:${s.instId}`);
  const favs = useQuery<{ contentId: string; title: string; spaceId: string }>(s.instId && s.caps.read ? query(collection(db, "institutions", s.instId, "members", uid, "favourites"), orderBy("at", "desc"), limit(20)) : null, `fav:${s.instId}`);
  const mustRead = (inbox.data ?? []).filter((i) => i.mustRead && !i.acknowledgedAt);
  const recent = (inbox.data ?? []).slice(0, 5);
  const first = (s.member?.name || s.user?.displayName || "").split(" ")[0];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    nav(`/app/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div>
      <h1 className="h1">{first ? `Hello, ${first}` : "Home"}</h1>
      <form onSubmit={submit} className="mt-4 flex gap-2" role="search">
        <label htmlFor="home-q" className="sr-only">Search or ask</label>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2" aria-hidden />
          <input id="home-q" className="input pl-10" placeholder="Search protocols, SOPs, manuals…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {s.caps.ask && <Link to={q.trim() ? `/app/ask?q=${encodeURIComponent(q.trim())}` : "/app/ask"} className="link">Or ask DocInsight a question →</Link>}
      </div>

      {mustRead.length > 0 && (
        <section className="mt-8">
          <h2 className="h2 mb-3">Must read <span className="pill ml-1 bg-warn-bg text-warn">{mustRead.length}</span></h2>
          <ul className="card divide-y divide-rule">
            {mustRead.map((m) => (
              <li key={m.updateId}><Link to={`/app/doc/${m.contentId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-soft"><span className="min-w-0 flex-1"><b>{m.title}</b><span className="block text-[13px] text-ink-2">{m.spaceName} · {ago(m.at)}{m.changeNote ? ` · ${m.changeNote}` : ""}</span></span><ArrowRight className="h-5 w-5 text-ink-2" aria-hidden /></Link></li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="h2 mb-3">Departments</h2>
        {!s.spacesReady ? <Spinner /> : s.spaces.length === 0 ? (
          <Empty title="No departments yet">{s.isManager ? <>Add departments in <Link className="link" to="/app/admin/spaces">Manage → Spaces</Link>.</> : "Your administrator hasn't given you access to any departments yet."}</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {s.spaces.map((sp) => (
              <Link key={sp.id} to={`/app/s/${sp.id}`} className="card flex min-h-[72px] items-center gap-3 p-3 hover:border-ink-2">
                <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: sp.colour }} aria-hidden />
                <span className="font-bold leading-tight">{sp.name}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {(favs.data?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="h2 mb-3">Favourites</h2>
          <ul className="card divide-y divide-rule">
            {favs.data!.map((f) => <li key={f.id}><Link to={`/app/doc/${f.contentId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-soft"><Star className="h-4 w-4 fill-current text-brand" aria-hidden /><b>{f.title}</b></Link></li>)}
          </ul>
        </section>
      )}

      {offline.length > 0 && (
        <section className="mt-8">
          <h2 className="h2 mb-3">Saved on this phone</h2>
          <ul className="card divide-y divide-rule">
            {offline.map((d) => <li key={d.key}><Link to={`/app/doc/${d.contentId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-soft"><CloudOff className="h-4 w-4 text-ink-2" aria-hidden /><span><b>{d.title}</b><span className="block text-[13px] text-ink-2">{d.spaceName} · saved {ago(new Date(d.savedAt))}</span></span></Link></li>)}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between"><h2 className="h2">Latest changes</h2><Link to="/app/updates" className="link text-sm">All updates</Link></div>
        {inbox.data === undefined ? <Spinner /> : recent.length === 0 ? <Empty title="Nothing new yet">When a document you can see is published or updated, it shows here.</Empty> : (
          <ul className="card divide-y divide-rule">
            {recent.map((m) => <li key={m.updateId}><Link to={`/app/doc/${m.contentId}`} className="block px-4 py-3 hover:bg-soft"><span className="flex items-center gap-2">{!m.read && <span className="h-2 w-2 rounded-full bg-brand" aria-label="Unread" />}<b>{m.title}</b></span><span className="block text-[13px] text-ink-2">{m.kind === "updated" ? "Updated" : "New"} · {m.spaceName} · {ago(m.at)}</span></Link></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
