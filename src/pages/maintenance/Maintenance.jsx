import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Empty, ErrorNote, Chip } from '../../components/ui';
import { money, d } from '../../lib/format';
import DeptFeed from '../../components/DeptFeed';

export default function Maintenance() {
  const { companyId } = useAuth();
  const invoices = useQuery({
    queryKey: ['maintenance', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('maintenance_invoices')
        .select(`id, invoice_number, unit_type, in_date, out_date, status, total,
                 on_company_total, on_driver_total,
                 truck:trucks(unit_number), trailer:trailers(unit_number),
                 driver:drivers(full_name), vendor:vendors(name)`)
        .eq('company_id', companyId).order('in_date', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>Maintenance invoices</h2>
        <div className="spacer" />
        <span className="small muted">Full editor + AI invoice scan lands in Phase 6</span>
      </div>
      <ErrorNote error={invoices.error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr>
            <th>Invoice</th><th>Unit</th><th>Driver</th><th>Vendor</th><th>In date</th>
            <th>Status</th><th>Total</th><th>On company</th><th>On driver</th>
          </tr></thead>
          <tbody>
            {(invoices.data || []).map((m) => (
              <tr key={m.id} className="norow">
                <td className="num">{m.invoice_number || '—'}</td>
                <td className="num">{m.truck?.unit_number || m.trailer?.unit_number || '—'}</td>
                <td>{m.driver?.full_name || '—'}</td>
                <td>{m.vendor?.name || '—'}</td>
                <td>{d(m.in_date)}</td>
                <td><Chip value={m.status} /></td>
                <td className="num">{money(m.total)}</td>
                <td className="num">{money(m.on_company_total)}</td>
                <td className="num">{money(m.on_driver_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.data?.length === 0 && (
          <Empty head="No maintenance invoices yet"
            sub="In the full build, uploading a repair invoice pre-fills header + task lines via AI, splits costs On Company / On Driver, and creates driver deductions automatically." />
        )}
      </div>
      <DeptFeed dept="maintenance" />
    </>
  );
}
