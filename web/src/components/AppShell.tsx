import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { collection, limit, query, where } from "firebase/firestore";
import { Bell, BookOpen, Building2, ChevronDown, FileStack, Home, Library, LogOut, MessageCircleQuestion, Search, Settings, Shield, WifiOff } from "lucide-react";
import { db } from "../lib/firebase";
import { useSession } from "../lib/session";
import { useOnline, useQuery } from "../lib/hooks";
import { fmtDate, toDate } from "../lib/format";
import { Banner, Button, Spinner, cx } from "./ui";
import { registerPush } from "../lib/push";

function Logo() {
  return (
    <span className="flex items-center gap-2 font-bold">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="rgb(var(--brand))" /><path d="M9 8h8a7 7 0 010 14h-3v4H9V8zm5 4v6h3a3 3 0 000-6h-3z" fill="#fff" /></svg>
      DocInsight
    </span>
  );
}
export { Logo };

function PaywallBanner() {
  const s = useSession();
  const inst = s.inst;
  if (!inst || !s.member) return null;
  const billingLink = s.isManager ? <Link to="/app/admin/billing" className="btn btn-primary btn-sm">Go to billing</Link> : null;
  switch (inst.status) {
    case "pending_payment":
      if (!s.isManager) return null;
      return <Banner title="Your institution is set up" action={billingLink}>You can build your library and invite admins now. Staff invites open once your first invoice is paid.</Banner>;
    case "past_due": {
      if (!s.isManager) return null;
      const since = toDate(inst.pastDueSince);
      const ro = since ? new Date(since.getTime() + 15 * 86_400_000) : null;
      return <Banner tone="warn" title="Payment overdue" action={billingLink}>Staff still have full access. {ro && <>If payment isn't received by <b>{fmtDate(ro)}</b>, DocInsight becomes read-only.</>}</Banner>;
    }
    case "restricted":
      return <Banner tone="warn" title="Read-only" action={billingLink}>Documents and search still work. Ask DocInsight, uploads and invites are paused until the subscription is paid{s.isManager ? "." : ". Your administrator has been told."}</Banner>;
    case "suspended":
    case "cancelled":
      return s.isManager ? <Banner tone="warn" title={inst.status === "suspended" ? "Access suspended" : "Subscription cancelled"} action={billingLink}>Staff can't open DocInsight. Admins can still export documents and settle billing. Your data is kept{inst.status === "cancelled" ? " for 90 days" : ""}.</Banner> : null;
    default:
      return null;
  }
}

function InstSwitcher() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  if (!s.inst) return null;
  const many = s.institutions.length > 1;
  return (
    <div className="relative min-w-0">
      <button className={cx("flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left", many && "hover:bg-soft")} onClick={() => many && setOpen((o) => !o)} aria-expanded={many ? open : undefined} aria-haspopup={many ? "menu" : undefined}>
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.inst.colour }} aria-hidden />
        <span className="truncate font-bold">{s.inst.name}</span>
        {many && <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />}
      </button>
      {open && (
        <div role="menu" className="card absolute left-0 top-full z-40 mt-1 w-72 p-1 shadow-lg">
          {s.institutions.map((i) => (
            <button key={i.id} role="menuitem" className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-soft", i.id === s.instId && "font-bold")} onClick={() => { s.switchInstitution(i.id); setOpen(false); }}>
              <span className="h-3 w-3 rounded-full" style={{ background: i.colour }} aria-hidden />{i.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useUnread() {
  const s = useSession();
  const q = s.user && s.instId && s.member && s.caps.read ? query(collection(db, "institutions", s.instId, "members", s.user.uid, "inbox"), where("read", "==", false), limit(99)) : null;
  const { data } = useQuery(q, `${s.instId}:${s.user?.uid}:${s.caps.read}`);
  return data?.length ?? 0;
}

export default function AppShell() {
  const s = useSession();
  const online = useOnline();
  const loc = useLocation();
  const nav = useNavigate();
  const unread = useUnread();

  useEffect(() => { if (s.settings.pushEnabled && s.user) registerPush(s.user.uid).catch(() => undefined); }, [s.settings.pushEnabled, s.user]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  if (s.blocked) {
    const msg = s.blocked === "signed_out" ? "An administrator signed you out. Sign in again to continue." : s.blocked === "expired" ? "Your temporary access has ended. Ask your administrator if you need more time." : "Your access to this institution was removed.";
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Logo />
        <h1 className="h1 mt-6">Access ended</h1>
        <p className="mt-2 text-ink-2">{msg}</p>
        <div className="mt-6 flex gap-2">
          <Button variant="primary" onClick={async () => { await s.signOutNow(); nav("/login"); }}>Sign in again</Button>
          {s.institutions.length > 1 && <Button onClick={() => { const o = s.institutions.find((i) => i.id !== s.instId); if (o) s.switchInstitution(o.id); }}>Open another institution</Button>}
        </div>
      </main>
    );
  }

  const onPlatform = loc.pathname.startsWith("/app/platform");
  if (!s.instId && !onPlatform) {
    if (s.platformAdmin) return <Navigate to="/app/platform" replace />;
    return <Navigate to="/welcome" replace />;
  }
  if (s.instId && !s.member && !onPlatform) return <Spinner className="justify-center" />;

  const noAccess = s.member && s.member.access === "none" && !onPlatform;
  const adminArea = s.canEditSomewhere || s.canApproveSomewhere;
  const items = [
    { to: "/app", label: "Home", icon: Home, end: true, show: true },
    { to: "/app/search", label: "Search", icon: Search, show: s.caps.search },
    { to: "/app/ask", label: "Ask", icon: MessageCircleQuestion, show: true },
    { to: "/app/updates", label: "Updates", icon: Bell, badge: unread, show: true },
    { to: "/app/hub", label: "Knowledge Hub", icon: Library, show: s.inst?.country === "NG" || !!s.profile?.hubAccess },
  ].filter((i) => i.show);
  const adminItems = [
    { to: "/app/admin", label: "Manage", icon: FileStack, show: adminArea },
    { to: "/app/platform", label: "Platform", icon: Shield, show: s.platformAdmin },
  ].filter((i) => i.show);

  const linkCls = ({ isActive }: { isActive: boolean }) => cx("flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-bold", isActive ? "bg-soft text-ink" : "text-ink-2 hover:bg-soft hover:text-ink");

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-rule bg-surface px-3 py-4 md:flex">
        <Link to="/app" className="mb-4 px-2"><Logo /></Link>
        <InstSwitcher />
        <nav className="mt-4 flex flex-1 flex-col gap-0.5" aria-label="Main">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={linkCls}>
              <i.icon className="h-5 w-5" aria-hidden />{i.label}
              {!!i.badge && <span className="ml-auto rounded-full bg-brand px-2 text-xs text-white">{i.badge > 98 ? "99+" : i.badge}</span>}
            </NavLink>
          ))}
          {adminItems.length > 0 && <div className="my-2 border-t border-rule" />}
          {adminItems.map((i) => <NavLink key={i.to} to={i.to} className={linkCls}><i.icon className="h-5 w-5" aria-hidden />{i.label}</NavLink>)}
        </nav>
        <NavLink to="/app/settings" className={linkCls}><Settings className="h-5 w-5" aria-hidden />Settings</NavLink>
        <button className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-bold text-ink-2 hover:bg-soft" onClick={async () => { await s.signOutNow(); nav("/"); }}><LogOut className="h-5 w-5" aria-hidden />Sign out</button>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-rule bg-surface/95 px-3 py-2 backdrop-blur md:hidden">
          <div className="flex min-w-0 items-center gap-1"><InstSwitcher />{!s.inst && <Logo />}</div>
          <div className="flex items-center">
            {adminArea && <Link to="/app/admin" className="btn btn-ghost btn-sm" aria-label="Manage"><FileStack className="h-5 w-5" /></Link>}
            {s.platformAdmin && <Link to="/app/platform" className="btn btn-ghost btn-sm" aria-label="Platform"><Building2 className="h-5 w-5" /></Link>}
            <Link to="/app/settings" className="btn btn-ghost btn-sm" aria-label="Settings"><Settings className="h-5 w-5" /></Link>
          </div>
        </header>
        {!online && <div className="flex items-center justify-center gap-2 bg-ink px-3 py-1.5 text-sm font-bold text-page"><WifiOff className="h-4 w-4" aria-hidden />Offline. Saved documents still open.</div>}
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8">
          {!onPlatform && <PaywallBanner />}
          {noAccess ? (
            <div className="py-10">
              <h1 className="h1">DocInsight is paused for {s.inst?.name}</h1>
              <p className="mt-2 max-w-prose text-ink-2">Your institution's subscription needs attention. Your administrator has been told. Nothing has been deleted.</p>
              {s.institutions.length > 1 && <p className="mt-4">You can switch to another institution from the menu above.</p>}
            </div>
          ) : <Outlet />}
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-rule bg-surface md:hidden" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, 1fr)`, paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Main">
          {items.slice(0, 5).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx("relative flex flex-col items-center gap-0.5 py-2 text-[12px] font-bold", isActive ? "text-brand" : "text-ink-2")}>
              <i.icon className="h-6 w-6" aria-hidden />
              {i.label === "Knowledge Hub" ? "Hub" : i.label}
              {!!i.badge && <span className="absolute right-[calc(50%-20px)] top-1 h-2.5 w-2.5 rounded-full bg-warn" aria-label={`${i.badge} unread`} />}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function BookIcon() { return <BookOpen className="h-5 w-5" aria-hidden />; }
