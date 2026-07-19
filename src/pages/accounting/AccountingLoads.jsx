import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Empty, ErrorNote } from '../../components/ui';
import { money, dt, d } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';

const CARDS = [
  { id: '', label: 'All loads' },
  { id: 'delivered', label: 'Ready for invoicing' },
  { id: 'in_progress', label: 'Open deliveries' },
  { id: 'payment_pending', label: 'Payment pending' },
  { id: 'completed', label: 'Completed' },
];

export default function AccountingLoads() {
  const { companyId } = useAuth();
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');

  const loads = useQuery({
    queryKey: ['acct-loads', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('loads')
        .select(`id, load_number, status, customer_load_id, pickup_time, delivery_time,
                 pickup_location, delivery_location, loaded_miles, empty_miles, total_miles,
                 freight_amount, driver_rate, accounting_note,
                 customer:customers(name), truck:trucks(unit_number), trailer:trailers(unit_number),
                 driver:drivers!loads_driver_id_fkey(full_name),
                 invoice:invoices(invoice_number, amount, balance, status, invoice_date)`)
        .eq('company_id', companyId)
        .order('load_number', { ascending: false }).limit(500);
      if (error) throw error;
      return data.map((l) => ({ ...l, invoice: Array.isArray(l.invoice) ? l.invoice[0] : l.invoice }));
    },
  });

  const rows = useMemo(() => {
    let list = loads.data || [];
    if (tab) list = list.filter((l) => l.status === tab);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((l) =>
      [l.load_number, l.customer_load_id, l.customer?.name, l.driver?.full_name, l.pickup_location, l.delivery_location]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(t)));
    return list;
  }, [loads.data, tab, q]);

  const counts = useMemo(() => {
    const all = loads.data || [];
    const sum = (list) => list.reduce((a, l) => a + Number(l.freight_amount || 0), 0);
    return Object.fromEntries(CARDS.map((c) => {
      const list = c.id ? all.filter((l) => l.status === c.id) : all;
      return [c.id || 'all', { n: list.length, v: sum(list) }];
    }));
  }, [loads.data]);

  const totals = rows.reduce((a, l) => ({
    loaded: a.loaded + Number(l.loaded_miles || 0),
    empty: a.empty + Number(l.empty_miles || 0),
    miles: a.miles + Number(l.total_miles || 0),
    gross: a.gross + Number(l.freight_amount || 0),
    pay: a.pay + Number(l.driver_rate || 0),
    balance: a.balance + Number(l.invoice?.balance || 0),
  }), { loaded: 0, empty: 0, miles: 0, gross: 0, pay: 0, balance: 0 });

  return (
    <>
      <div className="grid cols-5" style={{ marginBottom: 14 }}>
        {CARDS.map((c) => {
          const k = counts[c.id || 'all'] || { n: 0, v: 0 };
          const on = tab === c.id;
          return (
            <div key={c.id || 'all'} className="card stat"
              style={{ cursor: 'pointer', borderColor: on ? 'var(--accent)' : undefined,
                background: on ? 'var(--accent-soft)' : undefined }}
              onClick={() => setTab(c.id)}>
              <div className="label">{c.label}</div>
              <div className="value num" style={{ fontSize: 22 }}>{k.n}</div>
              <div className="sub num">{money(k.v)}</div>
            </div>
          );
        })}
      </div>

      <div className="filter-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search load, ref, customer, driver…"
          style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid var(--line)',
            background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, width: 280 }} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => downloadCsv('accounting_loads.csv', rows.map((l) => ({
          load: l.load_number, status: l.status, customer: l.customer?.name || '',
          ref: l.customer_load_id || '', driver: l.driver?.full_name || '',
          pickup: l.pickup_location, delivery: l.delivery_location,
          loaded_miles: l.loaded_miles, empty_miles: l.empty_miles, total_miles: l.total_miles,
          freight: l.freight_amount, driver_rate: l.driver_rate,
          difference: Number(l.freight_amount) - Number(l.driver_rate),
          invoice: l.invoice?.invoice_number || '', invoice_balance: l.invoice?.balance ?? '',
        })))}>Export CSV</button>
      </div>

      <ErrorNote error={loads.error} />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead><tr>
            <th>#</th><th>Status</th><th>Truck</th><th>Trailer</th><th>Customer</th><th>Ref</th>
            <th>Pickup</th><th>Delivery</th>
            <th>Loaded</th><th>Empty</th><th>Total mi</th>
            <th>$/total</th><th>$/loaded</th>
            <th>Freight</th><th>Driver rate</th><th>Difference</th>
            <th>Invoice</th><th>Balance</th><th>Note</th>
          </tr></thead>
          <tbody>
            {rows.map((l) => {
              const rpm = l.total_miles ? Number(l.freight_amount) / l.total_miles : 0;
              const rpml = l.loaded_miles ? Number(l.freight_amount) / l.loaded_miles : 0;
              const diff = Number(l.freight_amount || 0) - Number(l.driver_rate || 0);
              return (
                <tr key={l.id} className="norow">
                  <td className="num">{l.load_number}</td>
                  <td><Chip value={l.status} /></td>
                  <td className="num">{l.truck?.unit_number || '—'}</td>
                  <td className="num">{l.trailer?.unit_number || '—'}</td>
                  <td className="small">{l.customer?.name || '—'}</td>
                  <td className="small">{l.customer_load_id || '—'}</td>
                  <td className="small">{l.pickup_location}<div className="muted">{dt(l.pickup_time)}</div></td>
                  <td className="small">{l.delivery_location}<div className="muted">{dt(l.delivery_time)}</div></td>
                  <td className="num">{Number(l.loaded_miles).toLocaleString()}</td>
                  <td className="num" style={{ color: l.empty_miles > 200 ? 'var(--danger)' : undefined }}>
                    {Number(l.empty_miles).toLocaleString()}
                  </td>
                  <td className="num">{Number(l.total_miles).toLocaleString()}</td>
                  <td className="num" style={{ color: rpm < 2.2 ? 'var(--danger)' : 'var(--ok)' }}>${rpm.toFixed(2)}</td>
                  <td className="num">${rpml.toFixed(2)}</td>
                  <td className="num">{money(l.freight_amount)}</td>
                  <td className="num">{money(l.driver_rate)}</td>
                  <td className="num" style={{ color: 'var(--ok)' }}>{money(diff)}</td>
                  <td className="small">{l.invoice?.invoice_number || '—'}</td>
                  <td className="num" style={{ color: Number(l.invoice?.balance) > 0 ? 'var(--danger)' : undefined }}>
                    {l.invoice ? money(l.invoice.balance) : '—'}
                  </td>
                  <td className="small muted">{l.accounting_note || '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <td colSpan={8}>Σ {rows.length} loads</td>
            <td className="num">{Math.round(totals.loaded).toLocaleString()}</td>
            <td className="num">{Math.round(totals.empty).toLocaleString()}</td>
            <td className="num">{Math.round(totals.miles).toLocaleString()}</td>
            <td className="num">${(totals.miles ? totals.gross / totals.miles : 0).toFixed(2)}</td>
            <td className="num">${(totals.loaded ? totals.gross / totals.loaded : 0).toFixed(2)}</td>
            <td className="num">{money(totals.gross)}</td>
            <td className="num">{money(totals.pay)}</td>
            <td className="num">{money(totals.gross - totals.pay)}</td>
            <td></td>
            <td className="num">{money(totals.balance)}</td>
            <td></td>
          </tr></tfoot>
        </table>
        {rows.length === 0 && <Empty head="No loads here" sub="Try another status card or clear the search." />}
      </div>
    </>
  );
}
