import { useState } from "react";
import { Link } from "react-router-dom";
import { collection, limit, orderBy, query, updateDoc, doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useSession } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { ago } from "../../lib/format";
import { Button, Empty, PageHead, Spinner, Tabs, cx } from "../../components/ui";
import type { InboxItem } from "../../../../shared/src/types";

export default function Updates() {
  const s = useSession();
  const uid = s.user!.uid;
  const [tab, setTab] = useState<"all" | "unread" | "must">("all");
  const { data } = useQuery<InboxItem>(s.instId ? query(collection(db, "institutions", s.instId, "members", uid, "inbox"), orderBy("at", "desc"), limit(100)) : null, `upd:${s.instId}`);
  const items = (data ?? []).filter((i) => (tab === "unread" ? !i.read : tab === "must" ? i.mustRead : true));
  const unread = (data ?? []).filter((i) => !i.read);
  const markAll = () => unread.forEach((i) => updateDoc(doc(db, "institutions", s.instId!, "members", uid, "inbox", i.id), { read: true }).catch(() => undefined));
  return (
    <div>
      <PageHead title="Updates" sub="New and changed documents in your departments." actions={unread.length > 0 ? <Button size="sm" onClick={markAll}>Mark all read</Button> : undefined} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "all", label: "All" }, { value: "unread", label: `Unread${unread.length ? ` (${unread.length})` : ""}` }, { value: "must", label: "Must read" }]} />
      {data === undefined ? <Spinner /> : items.length === 0 ? <Empty title="Nothing here">You're up to date.</Empty> : (
        <ul className="card divide-y divide-rule">
          {items.map((i) => (
            <li key={i.id}>
              <Link to={`/app/doc/${i.contentId}`} className="flex gap-3 px-4 py-3 hover:bg-soft">
                <span className={cx("mt-2 h-2 w-2 shrink-0 rounded-full", i.read ? "bg-transparent" : "bg-brand")} aria-label={i.read ? undefined : "Unread"} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cx("pill", i.kind === "updated" ? "bg-soft text-ink" : "bg-ok-bg text-ok")}>{i.kind === "updated" ? "Updated" : "New"}</span>
                    {i.mustRead && <span className={cx("pill", i.acknowledgedAt ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn")}>{i.acknowledgedAt ? "Acknowledged" : "Must read"}</span>}
                    <b>{i.title}</b>
                  </span>
                  <span className="block text-[13px] text-ink-2">{i.spaceName} · {ago(i.at)}</span>
                  {i.changeNote && <span className="mt-1 block text-[15px]">What changed: {i.changeNote}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
