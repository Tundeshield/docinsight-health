import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session";
import { Spinner, Toaster } from "./components/ui";
import AppShell from "./components/AppShell";

const Landing = lazy(() => import("./pages/public/Landing"));
const Legal = lazy(() => import("./pages/public/Legal"));
const Login = lazy(() => import("./pages/public/Auth").then((m) => ({ default: m.Login })));
const LoginFinish = lazy(() => import("./pages/public/Auth").then((m) => ({ default: m.LoginFinish })));
const Signup = lazy(() => import("./pages/public/Auth").then((m) => ({ default: m.Signup })));
const Setup = lazy(() => import("./pages/public/Setup"));
const AcceptInvite = lazy(() => import("./pages/public/Join").then((m) => ({ default: m.AcceptInvite })));
const JoinByCode = lazy(() => import("./pages/public/Join").then((m) => ({ default: m.JoinByCode })));

const Home = lazy(() => import("./pages/app/Home"));
const SpacePage = lazy(() => import("./pages/app/Space"));
const Viewer = lazy(() => import("./pages/app/Viewer"));
const Search = lazy(() => import("./pages/app/Search"));
const Ask = lazy(() => import("./pages/app/Ask"));
const Updates = lazy(() => import("./pages/app/Updates"));
const Hub = lazy(() => import("./pages/app/Hub"));
const Settings = lazy(() => import("./pages/app/Settings"));
const Welcome = lazy(() => import("./pages/app/Welcome"));

const AdminHome = lazy(() => import("./pages/admin/AdminHome"));
const AdminSpaces = lazy(() => import("./pages/admin/Spaces"));
const AdminContent = lazy(() => import("./pages/admin/Content"));
const ContentNew = lazy(() => import("./pages/admin/ContentEditor").then((m) => ({ default: m.ContentNew })));
const ContentDetail = lazy(() => import("./pages/admin/ContentEditor").then((m) => ({ default: m.ContentDetail })));
const Approvals = lazy(() => import("./pages/admin/Approvals"));
const People = lazy(() => import("./pages/admin/People"));
const MustRead = lazy(() => import("./pages/admin/MustRead"));
const Analytics = lazy(() => import("./pages/admin/Analytics"));
const Audit = lazy(() => import("./pages/admin/Audit"));
const Billing = lazy(() => import("./pages/admin/Billing"));
const InstSettings = lazy(() => import("./pages/admin/InstSettings"));

const Platform = lazy(() => import("./pages/platform/Platform"));

function RequireAuth({ children }: { children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  if (!s.ready) return <Spinner className="justify-center" />;
  if (!s.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function Gate({ need, children }: { need: "manager" | "editor" | "approver" | "platform"; children: ReactNode }) {
  const s = useSession();
  const ok = need === "platform" ? s.platformAdmin : need === "manager" ? s.isManager : need === "editor" ? s.canEditSomewhere || s.canApproveSomewhere : s.canApproveSomewhere;
  if (!ok) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Suspense fallback={<Spinner className="justify-center" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/pricing" element={<Landing />} />
          <Route path="/legal/:page" element={<Legal />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/finish" element={<LoginFinish />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/setup" element={<RequireAuth><Setup /></RequireAuth>} />
          <Route path="/join/:instId/:token" element={<AcceptInvite />} />
          <Route path="/join" element={<JoinByCode />} />
          <Route path="/j/:code" element={<JoinByCode />} />
          <Route path="/welcome" element={<RequireAuth><Welcome /></RequireAuth>} />
          <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<Home />} />
            <Route path="s/:spaceId" element={<SpacePage />} />
            <Route path="doc/:contentId" element={<Viewer />} />
            <Route path="hub/doc/:contentId" element={<Viewer hub />} />
            <Route path="search" element={<Search />} />
            <Route path="ask" element={<Ask />} />
            <Route path="updates" element={<Updates />} />
            <Route path="hub" element={<Hub />} />
            <Route path="hub/:collectionId" element={<Hub />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<Gate need="editor"><AdminHome /></Gate>} />
            <Route path="admin/content" element={<Gate need="editor"><AdminContent /></Gate>} />
            <Route path="admin/content/new" element={<Gate need="editor"><ContentNew /></Gate>} />
            <Route path="admin/content/:contentId" element={<Gate need="editor"><ContentDetail /></Gate>} />
            <Route path="admin/approvals" element={<Gate need="approver"><Approvals /></Gate>} />
            <Route path="admin/analytics" element={<Gate need="editor"><Analytics /></Gate>} />
            <Route path="admin/spaces" element={<Gate need="manager"><AdminSpaces /></Gate>} />
            <Route path="admin/people" element={<Gate need="manager"><People /></Gate>} />
            <Route path="admin/must-read" element={<Gate need="manager"><MustRead /></Gate>} />
            <Route path="admin/audit" element={<Gate need="manager"><Audit /></Gate>} />
            <Route path="admin/billing" element={<Gate need="manager"><Billing /></Gate>} />
            <Route path="admin/settings" element={<Gate need="manager"><InstSettings /></Gate>} />
            <Route path="platform/*" element={<Gate need="platform"><Platform /></Gate>} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
