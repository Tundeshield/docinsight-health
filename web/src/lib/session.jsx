// Who is signed in, which hospital they're in, their role, and the feature flags.
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase.js";

const Ctx = createContext(null);
const DEFAULT_FLAGS = { billingEnabled: true, paymentProvider: "dummy" };
export function hasActivePlan(org) {
  const b = org?.billing || {};
  if (!["active", "non-renewing"].includes(b.status)) return false;
  const end = b.currentPeriodEnd?.toMillis ? b.currentPeriodEnd.toMillis() : null;
  return !end || end > Date.now();
}
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(undefined);
  const [org, setOrg] = useState(null);
  const [member, setMember] = useState(null);
  const [flags, setFlags] = useState(DEFAULT_FLAGS);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); if (!u) { setProfile(null); setOrg(null); setMember(null); } }), []);
  useEffect(() => {
    if (!user) return;
    setProfile(undefined);
    const offs = [
      onSnapshot(doc(db, "users", user.uid), (s) => setProfile(s.exists() ? s.data() : {}), () => setProfile({})),
      onSnapshot(doc(db, "config", "flags"), (s) => setFlags({ ...DEFAULT_FLAGS, ...(s.exists() ? s.data() : {}) }), () => {})
    ];
    return () => offs.forEach((f) => f());
  }, [user]);
  const orgId = profile?.orgId;
  useEffect(() => {
    if (!user || !orgId) { setOrg(null); setMember(null); return; }
    setOrg(undefined); setMember(undefined);
    const offs = [
      onSnapshot(doc(db, "orgs", orgId), (s) => setOrg(s.exists() ? { id: s.id, ...s.data() } : null), () => setOrg(null)),
      onSnapshot(doc(db, "orgs", orgId, "members", user.uid), (s) => setMember(s.exists() ? s.data() : null), () => setMember(null))
    ];
    return () => offs.forEach((f) => f());
  }, [user, orgId]);

  const isManager = !!member && ["owner", "manager"].includes(member.role);
  const billingOn = !!flags.billingEnabled && !!org && !org.billingExempt;
  const paid = !billingOn || hasActivePlan(org);
  const loading = user === undefined || (!!user && profile === undefined) || (!!orgId && (org === undefined || member === undefined));
  return <Ctx.Provider value={{ user, profile, org, member, flags, isManager, billingOn, paid, loading }}>{children}</Ctx.Provider>;
}
