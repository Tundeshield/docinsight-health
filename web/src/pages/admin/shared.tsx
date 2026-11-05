import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useSession, type WithId } from "../../lib/session";
import { useQuery } from "../../lib/hooks";
import { cx } from "../../components/ui";
import type { ContentItem, Member } from "../../../../shared/src/types";

/** Spaces this person can manage (edit or approve). */
export function useManagedSpaceIds(kind: "edit" | "approve" | "any" = "any"): string[] {
  const s = useSession();
  if (s.isManager) return s.spaces.map((x) => x.id);
  const m = s.member;
  if (!m) return [];
  const ids = kind === "edit" ? m.editSpaceIds : kind === "approve" ? m.approveSpaceIds : [...new Set([...m.editSpaceIds, ...m.approveSpaceIds])];
  return ids.filter((id) => s.spaces.some((x) => x.id === id));
}

/** All content (any status) in spaces this person manages. */
export function useManagedContent(): WithId<ContentItem>[] | undefined {
  const s = useSession();
  const ids = useManagedSpaceIds();
  const key = `${s.instId}:${s.isManager}:${ids.join(",")}`;
  const [data, setData] = useState<WithId<ContentItem>[] | undefined>(undefined);
  useEffect(() => {
    if (!s.instId) return;
    const col = collection(db, "institutions", s.instId, "content");
    if (s.isManager) {
      return onSnapshot(query(col, limit(2000)), (snap) => setData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WithId<ContentItem>)), () => setData([]));
    }
    if (!ids.length) { setData([]); return; }
    const parts = new Map<string, WithId<ContentItem>[]>();
    const offs = ids.map((sid) => onSnapshot(query(col, where("spaceId", "==", sid)), (snap) => {
      parts.set(sid, snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WithId<ContentItem>));
      if (parts.size === ids.length) setData([...parts.values()].flat());
    }, () => { parts.set(sid, []); if (parts.size === ids.length) setData([...parts.values()].flat()); }));
    return () => offs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

export function useMembers() {
  const s = useSession();
  return useQuery<Member>(s.instId && s.isManager ? query(collection(db, "institutions", s.instId, "members")) : null, `members:${s.instId}:${s.isManager}`);
}

export function AdminNav() {
  const s = useSession();
  const links = [
    { to: "/app/admin", label: "Overview", end: true, show: true },
    { to: "/app/admin/content", label: "Documents", show: true },
    { to: "/app/admin/approvals", label: "Approvals", show: s.canApproveSomewhere },
    { to: "/app/admin/spaces", label: "Spaces", show: s.isManager },
    { to: "/app/admin/people", label: "People", show: s.isManager },
    { to: "/app/admin/must-read", label: "Must read", show: s.isManager },
    { to: "/app/admin/analytics", label: "Analytics", show: true },
    { to: "/app/admin/audit", label: "Change log", show: s.isManager },
    { to: "/app/admin/billing", label: "Billing", show: s.isManager },
    { to: "/app/admin/settings", label: "Settings", show: s.isManager },
  ].filter((l) => l.show);
  return (
    <nav aria-label="Manage" className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-rule px-4 md:mx-0 md:px-0">
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[15px] font-bold", isActive ? "border-brand text-ink" : "border-transparent text-ink-2 hover:text-ink")}>{l.label}</NavLink>
      ))}
    </nav>
  );
}

export const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", editor: "Editor", approver: "Approver", staff: "Staff", locum: "Locum / guest" };
