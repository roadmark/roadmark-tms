import { STATUS_CHIP } from '../data/enums';
import { DEPT_COLORS } from '../data/permissions';
import { title } from '../lib/format';

export function Chip({ value }) {
  const c = STATUS_CHIP[value] || 'gray';
  return <span className={`chip ${c}`}>{title(value)}</span>;
}

export function DeptChip({ dept }) {
  return (
    <span className="chip gray dept-chip" style={{ borderLeftColor: DEPT_COLORS[dept] || 'var(--text-3)' }}>
      {title(dept)}
    </span>
  );
}

export function Drawer({ title: t, onClose, children, footer }) {
  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={t}>
        <div className="drawer-head">
          <h2>{t}</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Empty({ head, sub }) {
  return (
    <div className="empty">
      <b>{head}</b>
      {sub}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="error-note">{error.message || String(error)}</div>;
}
