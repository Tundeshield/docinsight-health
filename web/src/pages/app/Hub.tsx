import { Link, useParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useSession } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { Banner, Empty, PageHead, Spinner } from "../../components/ui";
import { DocRow } from "./common";
import type { ContentItem, HubCollection } from "../../../../shared/src/types";

export default function Hub() {
  const { collectionId } = useParams();
  const s = useSession();
  const access = !!s.profile?.hubAccess || s.platformAdmin;
  const hidden = new Set(s.inst?.settings?.hiddenHubCollections ?? []);
  const cols = useQuery<HubCollection>(access ? query(collection(db, "hubCollections"), where("archived", "==", false)) : null, `hubcols:${access}`);
  const items = useQuery<ContentItem>(access && collectionId ? query(collection(db, "hubContent"), where("spaceId", "==", collectionId), where("published", "==", true)) : null, `hub:${collectionId}`);
  const visible = (cols.data ?? []).filter((c) => !hidden.has(c.id)).sort((a, b) => a.order - b.order);
  const current = visible.find((c) => c.id === collectionId);

  if (!access) return (
    <div>
      <PageHead title="Knowledge Hub" sub="National guidelines, HMO and NHIA rules, and essential medicines, kept up to date by DocInsight." />
      <Banner title="Included with every paid plan">The Knowledge Hub opens once your institution's subscription is active.{s.isManager && <> <Link className="link" to="/app/admin/billing">Go to billing</Link></>}</Banner>
    </div>
  );
  if (collectionId) return (
    <div>
      <PageHead title={current?.name ?? "Knowledge Hub"} sub={current?.description} back={{ to: "/app/hub", label: "Knowledge Hub" }} />
      {items.data === undefined ? <Spinner /> : items.data.length === 0 ? <Empty title="Nothing published here yet">The DocInsight team is adding documents to this collection.</Empty> : (
        <ul className="card divide-y divide-rule">{items.data.sort((a, b) => a.title.localeCompare(b.title)).map((c) => <DocRow key={c.id} c={c} />)}</ul>
      )}
    </div>
  );
  return (
    <div>
      <PageHead title="Knowledge Hub" sub="National guidance curated by DocInsight. Labelled separately from your hospital's own protocols." />
      <Banner>Where a national guideline and your hospital's protocol differ, follow your hospital's approved protocol and raise it with the document owner.</Banner>
      {cols.data === undefined ? <Spinner /> : visible.length === 0 ? <Empty title="Coming soon">Collections are being prepared.</Empty> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visible.map((c) => <Link key={c.id} to={`/app/hub/${c.id}`} className="card block p-4 hover:border-ink-2"><b className="text-hub">{c.name}</b><span className="mt-1 block text-[15px] text-ink-2">{c.description}</span></Link>)}
        </div>
      )}
    </div>
  );
}
