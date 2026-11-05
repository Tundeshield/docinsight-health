import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "./firebase";
import { api } from "./api";
import { capabilities, type Capabilities } from "../../../shared/src/billing";
import type { Institution, Member, Space, UserProfile, UserSettings } from "../../../shared/src/types";

export type WithId<T> = T & { id: string };
export interface InstSummary { id: string; name: string; colour: string }

export interface Session {
  ready: boolean;
  user: User | null;
  profile: UserProfile | null;
  platformAdmin: boolean;
  institutions: InstSummary[];
  instId: string | null;
  inst: WithId<Institution> | null;
  member: Member | null;
  spaces: WithId<Space>[];
  spacesReady: boolean;
  settings: UserSettings;
  caps: Capabilities;
  isManager: boolean;
  isOwner: boolean;
  canEditSomewhere: boolean;
  canApproveSomewhere: boolean;
  /** Set when an admin signed this person out, or locum access ended */
  blocked: null | "signed_out" | "expired" | "removed";
  switchInstitution: (id: string) => void;
  refresh: () => Promise<void>;
  signOutNow: () => Promise<void>;
}

const DEFAULT_SETTINGS: UserSettings = { dataSaver: false, emailDigest: true, pushEnabled: false };
const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside provider");
  return s;
};

const LS_INST = "di.inst";
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

function hexToRgb(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [institutions, setInstitutions] = useState<InstSummary[]>([]);
  const [instId, setInstId] = useState<string | null>(null);
  const [inst, setInst] = useState<WithId<Institution> | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberReady, setMemberReady] = useState(false);
  const [spaces, setSpaces] = useState<WithId<Space>[]>([]);
  const [spacesReady, setSpacesReady] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [blocked, setBlocked] = useState<Session["blocked"]>(null);
  const [authTime, setAuthTime] = useState<number>(0);
  const ensured = useRef<string | null>(null);

  const refresh = async () => {
    const u = auth.currentUser;
    if (!u) return;
    const key = `di.fresh.${u.uid}`;
    let fresh = false;
    try { fresh = !sessionStorage.getItem(key); sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
    try {
      const r = await api<{ platformAdmin: boolean; institutionIds: string[]; defaultInstitutionId: string | null }>("ensureUser", { fresh });
      setPlatformAdmin(r.platformAdmin);
      // Claims may have changed (new membership): refresh the token so rules see them
      await u.getIdToken(true);
    } catch { /* offline: carry on with cached data */ }
  };

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    setBlocked(null);
    if (u) {
      const t = await u.getIdTokenResult().catch(() => null);
      setAuthTime(Number(t?.claims.auth_time ?? 0));
      if (ensured.current !== u.uid) { ensured.current = u.uid; await refresh(); }
    } else {
      ensured.current = null;
      setProfile(null); setProfileReady(true); setInst(null); setMember(null); setInstId(null); setInstitutions([]); setPlatformAdmin(false);
    }
    setAuthReady(true);
  }), []);

  // Profile, platform admin flag and personal settings
  useEffect(() => {
    if (!user) return;
    setProfileReady(false);
    const offs = [
      onSnapshot(doc(db, "users", user.uid), (s) => { setProfile(s.exists() ? ({ id: s.id, ...s.data() } as UserProfile) : null); setProfileReady(true); }, () => setProfileReady(true)),
      onSnapshot(doc(db, "platformAdmins", user.uid), (s) => setPlatformAdmin(s.exists()), () => undefined),
      onSnapshot(doc(db, "users", user.uid, "private", "settings"), (s) => setSettings({ ...DEFAULT_SETTINGS, ...(s.data() as Partial<UserSettings>) }), () => undefined),
    ];
    return () => offs.forEach((f) => f());
  }, [user?.uid]);

  // Which institution is open
  const idsKey = (profile?.institutionIds ?? []).join(",");
  useEffect(() => {
    const ids = profile?.institutionIds ?? [];
    if (!ids.length) { setInstId(null); setInstitutions([]); return; }
    const saved = lsGet(LS_INST);
    setInstId((cur) => (cur && ids.includes(cur) ? cur : saved && ids.includes(saved) ? saved : profile?.defaultInstitutionId && ids.includes(profile.defaultInstitutionId) ? profile.defaultInstitutionId : ids[0]));
    Promise.all(ids.map(async (id) => {
      const s = await getDoc(doc(db, "institutions", id)).catch(() => null);
      const d = s?.data() as Institution | undefined;
      return d ? { id, name: d.name, colour: d.colour } : null;
    })).then((r) => setInstitutions(r.filter(Boolean) as InstSummary[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Institution and my membership
  useEffect(() => {
    if (!user || !instId) { setInst(null); setMember(null); setMemberReady(true); return; }
    setMemberReady(false);
    const offs = [
      onSnapshot(doc(db, "institutions", instId), (s) => setInst(s.exists() ? ({ id: s.id, ...s.data() } as WithId<Institution>) : null), () => setInst(null)),
      onSnapshot(doc(db, "institutions", instId, "members", user.uid), (s) => { setMember(s.exists() ? (s.data() as Member) : null); setMemberReady(true); }, () => { setMember(null); setMemberReady(true); }),
    ];
    return () => offs.forEach((f) => f());
  }, [user?.uid, instId]);

  // Forced sign-out, removal and locum expiry
  useEffect(() => {
    if (!member || !user) return;
    if (member.signOutBefore && authTime && authTime < member.signOutBefore) {
      setBlocked("signed_out");
      signOut(auth);
      return;
    }
    if (member.status !== "active") setBlocked("removed");
    else if (member.expiresAt && member.expiresAt.toMillis?.() < Date.now()) setBlocked("expired");
    else setBlocked(null);
  }, [member, authTime, user]);

  // Spaces I can see. Managers can list the collection; others read the spaces they were given.
  const isManager = !!member && (member.role === "owner" || member.role === "admin") && member.status === "active";
  const visibleKey = (member?.visibleSpaceIds ?? []).slice().sort().join(",");
  useEffect(() => {
    if (!instId || !member || member.access === "none") { setSpaces([]); setSpacesReady(!!member || memberReady); return; }
    setSpacesReady(false);
    if (isManager) {
      return onSnapshot(query(collection(db, "institutions", instId, "spaces"), where("archived", "==", false)), (s) => {
        setSpaces(s.docs.map((d) => ({ id: d.id, ...d.data() }) as WithId<Space>).sort((a, b) => a.order - b.order));
        setSpacesReady(true);
      }, () => setSpacesReady(true));
    }
    const ids = member.visibleSpaceIds ?? [];
    if (!ids.length) { setSpaces([]); setSpacesReady(true); return; }
    const found = new Map<string, WithId<Space>>();
    let pending = ids.length;
    const offs = ids.map((id) => onSnapshot(doc(db, "institutions", instId, "spaces", id), (s) => {
      if (s.exists()) found.set(id, { id, ...s.data() } as WithId<Space>); else found.delete(id);
      if (pending > 0) pending--;
      setSpaces([...found.values()].filter((x) => !x.archived).sort((a, b) => a.order - b.order));
      if (pending === 0) setSpacesReady(true);
    }, () => { if (pending > 0) pending--; if (pending === 0) setSpacesReady(true); }));
    return () => offs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instId, visibleKey, isManager, member?.access]);

  // Institution colour drives the brand accent
  useEffect(() => {
    const rgb = hexToRgb(inst?.colour ?? "");
    if (rgb) document.documentElement.style.setProperty("--brand", rgb);
    else document.documentElement.style.removeProperty("--brand");
  }, [inst?.colour]);

  const value = useMemo<Session>(() => {
    const status = inst?.status ?? "pending_payment";
    const baseCaps = capabilities(status);
    const managerRead = isManager && (status === "suspended" || status === "cancelled");
    return {
      ready: authReady && (!user || (profileReady && (!instId || memberReady))),
      user, profile, platformAdmin, institutions, instId, inst, member, spaces, spacesReady, settings,
      caps: { ...baseCaps, read: baseCaps.read || managerRead },
      isManager,
      isOwner: !!member && member.role === "owner",
      canEditSomewhere: isManager || (member?.editSpaceIds?.length ?? 0) > 0,
      canApproveSomewhere: isManager || (member?.approveSpaceIds?.length ?? 0) > 0,
      blocked,
      switchInstitution: (id: string) => { lsSet(LS_INST, id); setInstId(id); api("setDefaultInstitution", { instId: id }).catch(() => undefined); },
      refresh,
      signOutNow: async () => { try { sessionStorage.clear(); } catch { /* ignore */ } await signOut(auth); },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user, profileReady, profile, platformAdmin, institutions, instId, inst, member, memberReady, spaces, spacesReady, settings, blocked, isManager]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
