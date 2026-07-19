import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Empty, ErrorNote, Chip } from '../../components/ui';
import { money, d } from '../../lib/format';
import DeptFeed from '../../components/DeptFeed';

export default function Accounting() {
  const { companyId } = useAuth();

  const balances = useQuery({
    queryKey: ['balances', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_driver_balances')
        .select('*').eq('company_id', companyId).eq('status', 'active');
      if (error) throw error;
      const sum = (k) => data.reduce((a, r) => a + Number(r[k] || 0), 0);
      return {
        rows: data.filter((r) =>
          Number(r.fuel_open) || Number(r.tolls_open) || Number(r.deductions_open) ||
          Number(r.scheduled_open) || Number(r.credits_open) || Number(r.balance_due_open)),
        totals: {
          credits: sum('credits_open'), fuel: sum('fuel_open'), tolls: sum('tolls_open'),
          deductions: sum('deductions_open'), scheduled: sum('scheduled_open'),
          balance_due: sum('balance_due_open'),
        },
      };
    },
  });

  const deductions = useQuery({
    queryKey: ['deductions', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('deductions')
        .select('id, issued_date, category, description, total, status, charge_to, driver:drivers(full_name)')
        .eq('company_id', companyId).order('issued_date', { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const t = balances.data?.totals;
  return (
    <>
      <div className="page-head">
        <h2>Settlements overview</h2>
        <div className="spacer" />
        <span className="small muted">Full settlements run, fuel/toll import, payroll — Phases 7–9</span>
      </div>
      <ErrorNote error={balances.error || deductions.error} />
      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        <Money label="Credit (open)" v={t?.credits} />
        <Money label="Fuel (open)" v={t?.fuel} />
        <Money label="Tolls (open)" v={t?.tolls} />
        <Money label="Deductions (open)" v={t?.deductions} />
        <Money label="Scheduled deductions" v={t?.scheduled} />
        <Money label="Balance due" v={t?.balance_due} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <h2 style={{ fontSize: 16, margin: 0, fontFamily: 'var(--font-display)' }}>Recent deductions</h2>
        </div>
        <table className="data">
          <thead><tr><th>Driver</th><th>Issued</th><th>Category</th><th>Description</th><th>Charge to</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            {(deductions.data || []).map((x) => (
              <tr key={x.id} className="norow">
                <td>{x.driver?.full_name || '—'}</td>
                <td>{d(x.issued_date)}</td>
                <td>{x.category}</td>
                <td>{x.description || '—'}</td>
                <td>{x.charge_to === 'driver' ? 'On Driver' : 'On Company'}</td>
                <td><Chip value={x.status} /></td>
                <td className="num">{money(x.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {deductions.data?.length === 0 && <Empty head="No deductions yet" sub="Fuel, tolls, repairs and other charges collect here and flow into weekly settlements." />}
      </div>

      <DeptFeed dept="accounting" />
    </>
  );
}

function Money({ label, v }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num" style={{ fontSize: 24 }}>{v === undefined ? '·' : money(v)}</div>
    </div>
  );
}
