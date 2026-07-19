import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../app/AuthProvider';
import { statusFor } from '../pages/safety/Compliance';

/** Compliance codes for a set of entities, grouped by entity id.
    Returns { [entityId]: [{code, live}] } */
export function useComplianceChips(entityType) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ['compliance-chips', companyId, entityType],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('compliance_items')
        .select('entity_id, expiry_date, type:compliance_types(code)')
        .eq('company_id', companyId).eq('entity_type', entityType);
      if (error) throw error;
      const m = {};
      for (const c of data) {
        (m[c.entity_id] ||= []).push({ code: c.type?.code || '?', live: statusFor(c.expiry_date) });
      }
      for (const k of Object.keys(m)) {
        const rank = { expired: 0, missing: 1, expiring: 2, valid: 3 };
        m[k].sort((a, b) => rank[a.live] - rank[b.live] || a.code.localeCompare(b.code));
      }
      return m;
    },
  });
}

const TONE = { expired: 'red', expiring: 'orange', missing: 'gray', valid: 'gray' };

export function ComplianceChips({ items, max = 6 }) {
  if (!items?.length) return <span className="muted small">—</span>;
  const bad = items.filter((i) => i.live !== 'valid');
  const show = [...bad, ...items.filter((i) => i.live === 'valid')].slice(0, max);
  const rest = items.length - show.length;
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
      {show.map((i, n) => (
        <span key={n} className={`chip ${TONE[i.live]} nodot`}
          style={{ padding: '1px 5px', fontSize: 9.5 }} title={i.live}>{i.code}</span>
      ))}
      {rest > 0 && <span className="muted" style={{ fontSize: 10 }}>+{rest}</span>}
      {bad.length > 0 && (
        <span className="chip red nodot" style={{ padding: '1px 5px', fontSize: 9.5 }}>
          x{bad.length}
        </span>
      )}
    </span>
  );
}

/** Document type counts per load, for the RC / POD / BOL chips. */
export function useLoadDocChips() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ['load-doc-chips', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('documents')
        .select('entity_id, doc_type').eq('company_id', companyId).eq('entity_type', 'load');
      if (error) throw error;
      const m = {};
      for (const d of data) {
        m[d.entity_id] ||= {};
        m[d.entity_id][d.doc_type] = (m[d.entity_id][d.doc_type] || 0) + 1;
      }
      return m;
    },
  });
}

const DOC_LABEL = { rate_con: 'RC', pod: 'POD', bol: 'BOL', lumper: 'LMP', invoice: 'INV' };
const DOC_TONE = { rate_con: 'blue', pod: 'green', bol: 'amber', lumper: 'purple', invoice: 'gray' };

export function DocChips({ docs }) {
  const keys = Object.keys(docs || {}).filter((k) => DOC_LABEL[k]);
  if (!keys.length) return <span className="muted small">—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {keys.map((k) => (
        <span key={k} className={`chip ${DOC_TONE[k]} nodot`} style={{ padding: '1px 5px', fontSize: 9.5 }}>
          {DOC_LABEL[k]}{docs[k] > 1 ? ` ${docs[k]}` : ''}
        </span>
      ))}
    </span>
  );
}

/** The "Status: Active 271 96%" strip above a list. */
export function CountBar({ groups, active, onPick }) {
  return (
    <div className="countbar">
      {groups.map((g) => {
        const total = g.rows.reduce((a, r) => a + r.n, 0) || 1;
        return (
          <div className="group" key={g.label}>
            <div className="group-label">{g.label}</div>
            {g.rows.filter((r) => r.n > 0).map((r) => (
              <div key={r.key} className={`row ${active?.[g.field] === r.key ? 'on' : ''}`}
                onClick={() => onPick?.(g.field, active?.[g.field] === r.key ? '' : r.key)}>
                {r.color && <span className="swatch" style={{ background: r.color }} />}
                <span>{r.label}</span>
                <span className="n">{r.n}</span>
                <span className="pct">{Math.round((r.n / total) * 100)}%</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
