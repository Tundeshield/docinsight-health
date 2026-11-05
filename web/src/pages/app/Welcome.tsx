import { Link, Navigate, useNavigate } from "react-router-dom";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/AppShell";
import { Button } from "../../components/ui";

export default function Welcome() {
  const s = useSession();
  const nav = useNavigate();
  if (s.instId) return <Navigate to="/app" replace />;
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Logo />
      <h1 className="h1 mt-8">Welcome{s.user?.displayName ? `, ${s.user.displayName.split(" ")[0]}` : ""}</h1>
      <p className="mt-2 text-ink-2">You're signed in as {s.user?.email || s.user?.phoneNumber}. You're not part of a hospital on DocInsight yet.</p>
      <div className="mt-6 grid gap-3">
        <Link to="/join" className="card block p-4 hover:border-ink-2"><b>Join my hospital</b><span className="block text-ink-2">Use the join code from your administrator or ward poster.</span></Link>
        <Link to="/setup" className="card block p-4 hover:border-ink-2"><b>Set up a new institution</b><span className="block text-ink-2">For owners and administrators.</span></Link>
        <div className="card p-4"><b>Waiting for an invite?</b><span className="block text-ink-2">Open the link in your invite email or SMS. If you signed up with a different email, sign out and use the invited one.</span></div>
        {s.platformAdmin && <Link to="/app/platform" className="btn btn-primary">Open the platform console</Link>}
      </div>
      <Button variant="ghost" className="mt-6" onClick={async () => { await s.signOutNow(); nav("/"); }}>Sign out</Button>
    </main>
  );
}
