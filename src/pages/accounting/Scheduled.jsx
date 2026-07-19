import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Empty, ErrorNote } from '../../components/ui';
import { money, d } from '../../lib/format';

/** Scheduled deductions, credits and balance-due tables. kind = scheduled | credit | balance */
export default function Scheduled({ kind }) {
  const { companyId } = useAuth();
  const cfg = {
    scheduled: { table: 'recurring_deduction_runs', title: 'Scheduled deductions' },
    credit: { table: 'credits', title: 'Credits' },
    balance: { table: 'balance_dues', title: 'Balance due' },
  }[kind];

  const rows = useQuery({
    queryKey: [cfg.table, companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const sel = kind === 'scheduled'
        ? 'id, run_date, period_start, period_end, amount, status, driver:drivers(full_name), recurring_deduction:recurring_deductions(name)'
        : kind === 'credit'
          ? 'id, issued_date, category, description, amount, status, driver:drivers(full_name)'
          : 'id, issued_date, description, amount, status, driver:drivers(full_name)';
      const order = kind === 'scheduled' ? 'run_date' : 'issued_date';
      const { data, error } = await supabase.from(cfg.table).select(sel)
        .eq('company_id', companyId).order(order, { ascending: false }).limit(300);
      if (error) throw error;
      return data;
    },
  });

  const total = (rows.data || []).reduce((a, r) => a + Number(r.amount || 0), 0);

  return (
    <>
      <ErrorNote error={rows.error} />
      <div className="card">
        <div className="card-pad small muted" style={{ paddingBottom: 8 }}>
          {cfg.title} · {rows.data?.length || 0} rows · total <b className="num">{money(total)}</b>
        </div>
        <table className="data">
          <thead><tr>
            <th>Driver</th><th>{kind === 'scheduled' ? 'Run date' : 'Issued'}</th>
            <th>{kind === 'scheduled' ? 'Schedule' : kind === 'credit' ? 'Category' : 'Description'}</th>
            {kind === 'scheduled' && <th>Period</th>}
            {kind === 'credit' && <th>Description</th>}
            <th>Status</th><th>Amount</th>
          </tr></thead>
          <tbody>
            {(rows.data || []).map((r) => (
              <tr key={r.id} className="norow">
                <td>{r.driver?.full_name || '—'}</td>
                <td>{d(r.run_date || r.issued_date)}</td>
                <td>{r.recurring_deduction?.name || r.category || r.description || '—'}</td>
                {kind === 'scheduled' && <td className="small">{d(r.period_start)} – {d(r.period_end)}</td>}
                {kind === 'credit' && <td className="small">{r.description || '—'}</td>}
                <td><Chip value={r.status} /></td>
                <td className="num">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data?.length === 0 && <Empty head={`No ${cfg.title.toLowerCase()}`} sub="Nothing recorded yet." />}
      </div>
    </>
  );
}
