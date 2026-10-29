import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "./lib/session.jsx";
import Landing from "./pages/Landing.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Join from "./pages/Join.jsx";
import Shell from "./components/Shell.jsx";
import AskPage from "./pages/AskPage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import BillingPage from "./pages/BillingPage.jsx";
import Paywall from "./pages/Paywall.jsx";
import Checkout from "./pages/Checkout.jsx";

function Loading() { return <div className="auth-main" style={{ height: "100%" }}><p className="muted">Loading…</p></div>; }

/** Everything under /app: signed in → registered organisation → active plan (the paywall) → the product. */
function AppArea() {
  const { user, org, loading, isManager, paid } = useSession();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!org) return <Onboarding />;
  return (
    <Routes>
      <Route path="checkout/:checkoutId" element={isManager ? <Checkout /> : <Navigate to="/app" />} />
      <Route path="*" element={!paid ? <Paywall /> : (
        <Shell>
          <Routes>
            <Route index element={<AskPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="team" element={isManager ? <TeamPage /> : <Navigate to="/app" />} />
            <Route path="billing" element={isManager ? <BillingPage /> : <Navigate to="/app" />} />
            <Route path="*" element={<Navigate to="/app" />} />
          </Routes>
        </Shell>
      )} />
    </Routes>
  );
}

function AuthRoute({ mode }) {
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/app" replace />;
  return <AuthPage mode={mode} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthRoute mode="signin" />} />
      <Route path="/signup" element={<AuthRoute mode="signup" />} />
      <Route path="/join/:orgId/:token" element={<Join />} />
      <Route path="/app/*" element={<AppArea />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
