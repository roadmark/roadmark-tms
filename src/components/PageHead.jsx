/** Roadmark's page header: big title, inline stat line, actions on the right. */
export default function PageHead({ title, stats = [], children }) {
  return (
    <div className="page-head">
      <h2>{title}</h2>
      {stats.length > 0 && (
        <div className="head-stats">
          {stats.map((s, i) => (
            <span key={i}>
              {i > 0 && <span className="sep"> · </span>}
              <b>{s.v}</b> {s.l}
            </span>
          ))}
        </div>
      )}
      <div className="spacer" />
      {children}
    </div>
  );
}

/** Filter pills with counts — "No driver · 62". */
export function Pills({ options, value, onChange }) {
  return (
    <div className="pill-row">
      {options.map((o) => (
        <button key={o.id ?? 'all'} className={`pill ${value === o.id ? 'on' : ''}`}
          onClick={() => onChange(o.id)}>
          {o.label}
          {o.n !== undefined && <span className="n">{o.n.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}
