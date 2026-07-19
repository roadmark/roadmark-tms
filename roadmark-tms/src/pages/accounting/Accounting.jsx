import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Empty, ErrorNote, Chip } from '../../components/ui';
import { money, d } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import DeptFeed from '../../components/DeptFeed';
import ImportWizard from './ImportWizard';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'toll', label: 'Tolls' },
  { id: 'deductions', label: 'Deductions' },
];

export default function Accounting() {
  const { companyId, canEdit } = useAuth();
  const [tab, setTab] = useState('overview');
  const [importKind, setImportKind] = useState(null);
  const editable = canEdit('accounting');

  return (
    <>
      <div className="page-head">
        <h2>Accounting</h2>
        {TABS.map((t) => (
          <button key={t.id} className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <div className="spacer" />
        {editable && tab === 'fuel' && (
          <button className="btn btn-primary" onClick={() => setImportKind('fuel')}>Import fuel CSV</button>
        )}
        {editable && tab === 'toll' && (
          <button className="btn btn-primary" onClick={() => setImportKind('toll')}>Import toll CSV</button>
        )}
      </div>

      {tab === 'overview' && <Overview companyId={companyId} />}
      {tab === 'fuel' && <Charges kind="fuel" companyId={companyId} editable={editable} />}
      {tab === 'toll' && <Charges kind="toll" companyId={companyId} editable={editable} />}
      {tab === 'deductions' && <Deductions companyId={companyId} />}

      <div style={{ marginTop: 16 }}><DeptFeed dept="accounting" /></div>

      {importKind && (
        <ImportWizard kind={importKind} onClose={() => setImportKind(null)}
          onDone={() => setTab(importKind)} />
      )}
    </>
  );
}

/* ---------------- overview ---------------- */

function Overview({ companyId }) {
  const balances = useQuery({
    queryKey: ['balances', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_driver_balances')
        .select('*').eq('company_id', companyId).eq('status', 'active');
      if (error) throw error;
      const sum = (k) => data.reduce((a, r) => a + Number(r[k] || 0), 0);
      return {
        rows: data,
        totals: {
          credits: sum('credits_open'), fuel: sum('fuel_open'), tolls: sum('tolls_open'),
          deductions: sum('deductions_open'), scheduled: sum('scheduled_open'),
          balance_due: sum('balance_due_open'),
        },
      };
    },
  });
  const t = balances.data?.totals;
  const rows = (balances.data?.rows || []).filter((r) =>
    Number(r.fuel_open) || Number(r.tolls_open) || Number(r.deductions_open) ||
    Number(r.scheduled_open) || Number(r.credits_open) || Number(r.balance_due_open));

  return (
    <>
      <ErrorNote error={balances.error} />
      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        <Money label="Credit (open)" v={t?.credits} />
        <Money label="Fuel (open)" v={t?.fuel} />
        <Money label="Tolls (open)" v={t?.tolls} />
        <Money label="Deductions (open)" v={t?.deductions} />
        <Money label="Scheduled deductions" v={t?.scheduled} />
        <Money label="Balance due" v={t?.balance_due} />
      </div>
      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 4 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>Open balances by driver</h3>
        </div>
        <table className="data">
          <thead><tr><th>Driver</th><th>Credits</th><th>Fuel</th><th>Tolls</th><th>Deductions</th><th>Scheduled</th><th>Balance due</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driver_id} className="norow">
                <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                <td className="num">{money(r.credits_open)}</td>
                <td className="num">{money(r.fuel_open)}</td>
                <td className="num">{money(r.tolls_open)}</td>
                <td className="num">{money(r.deductions_open)}</td>
                <td className="num">{money(r.scheduled_open)}</td>
                <td className="num">{money(r.balance_due_open)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty head="No open balances" sub="Import fuel and toll statements, or add deductions, and they collect here." />}
      </div>
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

/* ---------------- fuel / toll tables ---------------- */

function Charges({ kind, companyId, editable }) {
  const table = kind === 'fuel' ? 'fuel_transactions' : 'toll_transactions';
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');

  const rows = useQuery({
    queryKey: [table, companyId, status],
    enabled: !!companyId,
    queryFn: async () => {
      const cols = kind === 'fuel'
        ? `id, issued_date, transaction_id, card_number, city, state, product, quantity,
           amount, fee, total, discount, charge_to, status, driver_id, truck_id,
           suggested_driver_id, suggested_truck_id,
           driver:drivers!fuel_transactions_driver_id_fkey(full_name),
           truck:trucks!fuel_transactions_truck_id_fkey(unit_number),
           sdriver:drivers!fuel_transactions_suggested_driver_id_fkey(full_name),
           struck:trucks!fuel_transactions_suggested_truck_id_fkey(unit_number)`
        : `id, issued_date, transaction_id, tag_number, license_plate, plaza_name,
           amount, charge_to, status, driver_id, truck_id,
           suggested_driver_id, suggested_truck_id,
           driver:drivers!toll_transactions_driver_id_fkey(full_name),
           truck:trucks!toll_transactions_truck_id_fkey(unit_number),
           sdriver:drivers!toll_transactions_suggested_driver_id_fkey(full_name),
           struck:trucks!toll_transactions_suggested_truck_id_fkey(unit_number)`;
      let q = supabase.from(table).select(cols).eq('company_id', companyId)
        .order('issued_date', { ascending: false }).limit(300);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const drivers = useQuery({
    queryKey: ['drivers-min', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('drivers')
        .select('id, full_name').eq('company_id', companyId).order('full_name');
      if (error) throw error;
      return data;
    },
  });

  const setDriver = useMutation({
    mutationFn: async ({ id, driver_id }) => {
      const { error } = await supabase.from(table).update({ driver_id: driver_id || null }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  const acceptAll = useMutation({
    mutationFn: async () => {
      const pending = (rows.data || []).filter((r) => !r.driver_id && r.suggested_driver_id);
      for (const r of pending) {
        const { error } = await supabase.from(table)
          .update({ driver_id: r.suggested_driver_id, truck_id: r.truck_id || r.suggested_truck_id })
          .eq('id', r.id);
        if (error) throw error;
      }
      return pending.length;
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  const unmatched = (rows.data || []).filter((r) => !r.driver_id).length;
  const suggestable = (rows.data || []).filter((r) => !r.driver_id && r.suggested_driver_id).length;
  const total = (rows.data || []).reduce((a, r) => a + Number(kind === 'fuel' ? r.total : r.amount || 0), 0);

  return (
    <>
      <ErrorNote error={rows.error || setDriver.error || acceptAll.error} />
      <div className="filter-row">
        {['open', 'closed', 'rejected', ''].map((s) => (
          <span key={s || 'all'} className={`chip gray ${status === s ? 'on' : ''}`}
            onClick={() => setStatus(s)}>{s || 'all'}</span>
        ))}
        <div style={{ flex: 1 }} />
        {editable && suggestable > 0 && (
          <button className="btn btn-primary" disabled={acceptAll.isPending} onClick={() => acceptAll.mutate()}>
            Accept {suggestable} suggested driver{suggestable > 1 ? 's' : ''}
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => downloadCsv(`${kind}_export.csv`,
          (rows.data || []).map((r) => ({
            date: r.issued_date, transaction_id: r.transaction_id,
            driver: r.driver?.full_name || '', truck: r.truck?.unit_number || '',
            amount: kind === 'fuel' ? r.total : r.amount, status: r.status,
          })))}>Export CSV</button>
      </div>

      <div className="card">
        <div className="card-pad small muted" style={{ paddingBottom: 8 }}>
          {rows.data?.length || 0} rows · total <b className="num">{money(total)}</b>
          {unmatched > 0 && <> · <span style={{ color: 'var(--danger)' }}>{unmatched} without a driver</span></>}
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Date</th><th>Transaction</th>
              {kind === 'fuel' ? <><th>Card</th><th>Location</th><th>Product</th><th>Qty</th></>
                : <><th>Tag</th><th>Plate</th><th>Plaza</th></>}
              <th>Amount</th><th>Truck</th><th>Driver</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows.data || []).map((r) => (
              <tr key={r.id} className="norow">
                <td>{d(r.issued_date)}</td>
                <td className="small">{r.transaction_id || '—'}</td>
                {kind === 'fuel' ? (
                  <>
                    <td className="small">{r.card_number || '—'}</td>
                    <td className="small">{[r.city, r.state].filter(Boolean).join(', ') || '—'}</td>
                    <td>{r.product || '—'}</td>
                    <td className="num">{r.quantity || '—'}</td>
                  </>
                ) : (
                  <>
                    <td className="small">{r.tag_number || '—'}</td>
                    <td className="small">{r.license_plate || '—'}</td>
                    <td className="small">{r.plaza_name || '—'}</td>
                  </>
                )}
                <td className="num">{money(kind === 'fuel' ? r.total : r.amount)}</td>
                <td className="num">{r.truck?.unit_number || r.struck?.unit_number || '—'}</td>
                <td>
                  {editable ? (
                    <select value={r.driver_id || ''} style={{ padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6, maxWidth: 160 }}
                      onChange={(e) => setDriver.mutate({ id: r.id, driver_id: e.target.value })}>
                      <option value="">
                        {r.sdriver?.full_name ? `— (suggest: ${r.sdriver.full_name})` : '—'}
                      </option>
                      {(drivers.data || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                    </select>
                  ) : (r.driver?.full_name || '—')}
                </td>
                <td><Chip value={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data?.length === 0 && (
          <Empty head={`No ${kind} charges`}
            sub={`Click "Import ${kind} CSV" and drop the statement your provider emails you.`} />
        )}
      </div>
    </>
  );
}

/* ---------------- deductions ---------------- */

function Deductions({ companyId }) {
  const rows = useQuery({
    queryKey: ['deductions', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('deductions')
        .select('id, issued_date, category, description, total, status, charge_to, driver:drivers(full_name)')
        .eq('company_id', companyId).order('issued_date', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <ErrorNote error={rows.error} />
      <div className="card">
        <table className="data">
          <thead><tr><th>Driver</th><th>Issued</th><th>Category</th><th>Description</th><th>Charge to</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            {(rows.data || []).map((x) => (
              <tr key={x.id} className="norow">
                <td>{x.driver?.full_name || '—'}</td>
                <td>{d(x.issued_date)}</td>
                <td>{x.category}</td>
                <td className="small">{x.description || '—'}</td>
                <td>{x.charge_to === 'driver' ? 'On Driver' : 'On Company'}</td>
                <td><Chip value={x.status} /></td>
                <td className="num">{money(x.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data?.length === 0 && <Empty head="No deductions yet" sub="Repair invoices with On Driver tasks create these automatically." />}
      </div>
    </>
  );
}
