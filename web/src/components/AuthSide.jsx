import { CATS } from "../lib/constants.js";
export default function AuthSide({ heading, text }) {
  return (
    <aside className="auth-side">
      <a className="brand" href="/" style={{ color: "inherit", textDecoration: "none" }}><span className="cross" aria-hidden="true" />DocInsight Health</a>
      <div><h1>{heading}</h1><p>{text}</p></div>
      <div className="auth-cats">{Object.entries(CATS).map(([k, c]) => <span key={k} className={`cat-${k}`}><span className="swatch" />{c.label}</span>)}</div>
    </aside>
  );
}
