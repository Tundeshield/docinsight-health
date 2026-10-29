const fmtLimit = (v, unit) => (v == null ? `Unlimited ${unit}` : `${v.toLocaleString()} ${unit}`);
export default function PlanCards({ plans, current, busy, onChoose, onManage }) {
  return (
    <div className="plans">
      {Object.entries(plans || {}).map(([k, p]) => (
        <div key={k} className={`plan${current === k ? " current" : ""}`}>
          <h3>{p.name}</h3><div className="price">{p.priceLabel}</div><p className="muted" style={{ margin: 0 }}>{p.description}</p>
          <ul><li>{fmtLimit(p.limits.questions, "questions a month")}</li><li>{fmtLimit(p.limits.ocrPages, "scanned pages a month")}</li><li>{fmtLimit(p.limits.documents, "documents")}</li><li>Unlimited staff</li></ul>
          {current === k && onManage ? onManage
            : p.contactOnly ? <a className="btn" href={`mailto:${import.meta.env.VITE_CONTACT_EMAIL || ""}?subject=DocInsight%20Enterprise`}>Contact Avelon</a>
            : <button className="btn primary" onClick={() => onChoose(k)} disabled={!!busy || !p.available}>{busy === k ? "Opening checkout…" : p.available ? `Choose ${p.name}` : "Coming soon"}</button>}
        </div>
      ))}
    </div>
  );
}
