import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase.js";
import { useSession } from "../lib/session.jsx";
import { TEAM_ROLES } from "../lib/constants.js";

export default function Shell({ children }) {
  const { user, org, member, isManager, billingOn } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const planLabel = !billingOn ? "Free pilot" : `${org.plan[0].toUpperCase()}${org.plan.slice(1)} plan`;
  const item = (to, label, extra) => <NavLink to={to} end className={({ isActive }) => `item${isActive ? " active" : ""}`} onClick={() => setOpen(false)}>{label}{extra}</NavLink>;
  return (
    <div className="shell">
      <nav className={`nav${open ? " open" : ""}`} aria-label="Main">
        <div className="brand"><span className="cross" aria-hidden="true" />DocInsight Health</div>
        <div className="org"><strong>{org.name}</strong>{planLabel}</div>
        {item("/app", "Ask")}
        {item("/app/library", "Library")}
        {isManager && item("/app/team", "Team")}
        {isManager && item("/app/billing", billingOn ? "Billing" : "Plan & usage")}
        <div className="foot">
          <div className="who">{user.email}<br />{TEAM_ROLES[member?.role] || ""}</div>
          <button className="linkbtn" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </nav>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="content">
        <div className="mobilebar">
          <button className="btn small" onClick={() => setOpen(true)} aria-label="Open menu">Menu</button>
          <strong>{{ "/app": "Ask", "/app/library": "Library", "/app/team": "Team", "/app/billing": "Billing" }[loc.pathname.replace(/\/$/, "")] || "DocInsight Health"}</strong>
          <span style={{ width: 60 }} />
        </div>
        {children}
      </div>
    </div>
  );
}
