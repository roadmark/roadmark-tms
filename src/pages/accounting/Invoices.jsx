import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { money, d } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';

const BILLABLE = ['delivered', 'invoiced', 'payment_pending', 'completed'];

export default function Invoices() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [gen, setGen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const editable = canEdit('accounting');

  const invoices = useQuery({
    queryKey: ['invoices', companyId, statusFilter],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('invoices')
        .select(`id, invoice_number, invoice_date, amount, balance, status, sent_at, paid_at,
                 load:loads(load_number, customer_load_id, delivery_location,
                            customer:customers(name))`)
        .eq('company_id', companyId).order('invoice_date', { ascending: false }).limit(200);
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const rows = invoices.data || [];
  const outstanding = rows.filter((r) => !['paid', 'void'].includes(r.status))
    .reduce((a, r) => a + Number(r.balance || 0), 0);
  const billed = rows.reduce((a, r) => a + Number(r.amount || 0), 0);

  // aging buckets on open balances
  const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
  rows.filter((r) => !['paid', 'void'].includes(r.status)).forEach((r) => {
    const days = Math.floor((Date.now() - new Date(r.invoice_date)) / 86400000);
    const b = Number(r.balance || 0);
    if (days <= 30) aging.current += b; else if (days <= 60) aging.d30 += b;
    else if (days <= 90) aging.d60 += b; else aging.d90 += b;
  });

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat label="Outstanding" v={outstanding} big />
        <Stat label="0–30 days" v={aging.current} />
        <Stat label="31–60 days" v={aging.d30} />
        <Stat label="61+ days" v={aging.d60 + aging.d90} tone={aging.d60 + aging.d90 > 0 ? 'var(--danger)' : undefined} />
      </div>

      <div className="filter-row">
        {['', 'draft', 'sent', 'factored', 'partial', 'paid', 'short_paid', 'void'].map((s) => (
          <span key={s || 'all'} className={`chip gray ${statusFilter === s ? 'on' : ''}`}
            onClick={() => setStatusFilter(s)}>{s || 'all'}</span>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => downloadCsv('invoices.csv', rows.map((r) => ({
          invoice: r.invoice_number, date: r.invoice_date, customer: r.load?.customer?.name || '',
          load: r.load?.load_number || '', amount: r.amount, balance: r.balance, status: r.status,
        })))}>Export CSV</button>
        {editable && <button className="btn btn-primary" onClick={() => setGen(true)}>Invoice delivered loads</button>}
      </div>

      <ErrorNote error={invoices.error} />
      <div className="card">
        <table className="data">
          <thead><tr>
            <th>Invoice</th><th>Date</th><th>Customer</th><th>Load</th><th>Broker ref</th>
            <th>Amount</th><th>Balance</th><th>Status</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setOpenId(r.id)}>
                <td className="num">{r.invoice_number}</td>
                <td>{d(r.invoice_date)}</td>
                <td>{r.load?.customer?.name || '—'}</td>
                <td className="num">#{r.load?.load_number ?? '—'}</td>
                <td className="small">{r.load?.customer_load_id || '—'}</td>
                <td className="num">{money(r.amount)}</td>
                <td className="num" style={{ color: Number(r.balance) > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                  {money(r.balance)}
                </td>
                <td><Chip value={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <Empty head="No invoices yet"
            sub='Click "Invoice delivered loads" — every delivered load without an invoice is listed, ready to bill.' />
        )}
      </div>

      {gen && <GenerateDrawer onClose={() => setGen(false)}
        onDone={() => { setGen(false); qc.invalidateQueries({ queryKey: ['invoices'] }); }} />}
      {openId && <InvoiceDrawer id={openId} onClose={() => setOpenId(null)}
        onChanged={() => qc.invalidateQueries()} />}
    </>
  );
}

function Stat({ label, v, big, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num" style={{ fontSize: big ? 28 : 22, color: tone }}>{money(v)}</div>
    </div>
  );
}

/* ---------------- generate invoices from delivered loads ---------------- */

function GenerateDrawer({ onClose, onDone }) {
  const { companyId, user } = useAuth();
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loads = useQuery({
    queryKey: ['uninvoiced', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data: existing } = await supabase.from('invoices')
        .select('load_id').eq('company_id', companyId).not('load_id', 'is', null);
      const taken = new Set((existing || []).map((r) => r.load_id));
      const { data, error } = await supabase.from('loads')
        .select('id, load_number, customer_load_id, delivery_time, delivery_location, freight_amount, status, customer:customers(name, payment_terms_days)')
        .eq('company_id', companyId).in('status', BILLABLE)
        .order('delivery_time', { ascending: false }).limit(200);
      if (error) throw error;
      return data.filter((l) => !taken.has(l.id) && Number(l.freight_amount) > 0);
    },
  });

  const all = loads.data || [];
  const chosen = all.filter((l) => picked[l.id]);
  const total = chosen.reduce((a, l) => a + Number(l.freight_amount || 0), 0);

  const create = async () => {
    try {
      setBusy(true); setError(null);
      for (const l of chosen) {
        const { error: e } = await supabase.from('invoices').insert({
          company_id: companyId, load_id: l.id,
          invoice_number: `INV-${l.load_number}`,
          invoice_date: new Date().toISOString().slice(0, 10),
          amount: Number(l.freight_amount), balance: Number(l.freight_amount),
          status: 'draft', created_by: user?.id,
        });
        if (e) throw e;
        // move the load along its lifecycle
        if (l.status === 'delivered') {
          await supabase.from('loads').update({ status: 'invoiced' }).eq('id', l.id);
        }
      }
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Drawer title="Invoice delivered loads" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={create}>
          {busy ? 'Creating…' : `Create ${chosen.length} invoice${chosen.length === 1 ? '' : 's'} · ${money(total)}`}
        </button>
      </>}>
      <ErrorNote error={error || loads.error} />
      <p className="muted small">One invoice per load, numbered from the load number. Loads still
        marked “delivered” move to “invoiced” automatically.</p>
      {all.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className="btn btn-ghost" onClick={() => setPicked(Object.fromEntries(all.map((l) => [l.id, true])))}>Select all</button>
          <button className="btn btn-ghost" onClick={() => setPicked({})}>Clear</button>
        </div>
      )}
      {all.map((l) => (
        <label key={l.id} className="feed-item" style={{ padding: '9px 2px', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!picked[l.id]}
            onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.checked }))} />
          <div style={{ flex: 1 }}>
            <div className="feed-title">#{l.load_number} — {l.customer?.name || 'No customer'}</div>
            <div className="feed-meta">
              {l.delivery_location || '—'} · delivered {d(l.delivery_time)}
              {l.customer_load_id ? ` · ref ${l.customer_load_id}` : ''}
              {l.customer?.payment_terms_days ? ` · net ${l.customer.payment_terms_days}` : ''}
            </div>
          </div>
          <div className="num">{money(l.freight_amount)}</div>
        </label>
      ))}
      {all.length === 0 && !loads.isFetching && (
        <Empty head="Nothing to invoice" sub="Every delivered load already has an invoice." />
      )}
    </Drawer>
  );
}

/* ---------------- one invoice: status, payments ---------------- */

function InvoiceDrawer({ id, onClose, onChanged }) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState({ amount: '', short_pay: '', over_pay: '', method: 'ach', reference: '', paid_at: new Date().toISOString().slice(0, 10) });
  const editable = canEdit('accounting');

  const inv = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices')
        .select('*, load:loads(load_number, customer_load_id, pickup_location, delivery_location, customer:customers(name, billing_email, payment_terms_days))')
        .eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const payments = useQuery({
    queryKey: ['invoice-payments', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoice_payments')
        .select('*').eq('invoice_id', id).order('paid_at');
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['invoice', id] });
    qc.invalidateQueries({ queryKey: ['invoice-payments', id] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    onChanged?.();
  };

  const setStatus = async (status) => {
    try {
      setBusy(true);
      const patch = { status };
      if (status === 'sent') patch.sent_at = new Date().toISOString();
      await supabase.from('invoices').update(patch).eq('id', id);
      refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const addPayment = async () => {
    try {
      setBusy(true); setError(null);
      const amt = Number(pay.amount) || 0;
      if (amt <= 0) throw new Error('Enter the payment amount.');
      const { error: e } = await supabase.from('invoice_payments').insert({
        invoice_id: id, company_id: inv.data.company_id, amount: amt,
        short_pay: Number(pay.short_pay) || 0, over_pay: Number(pay.over_pay) || 0,
        method: pay.method || null, reference: pay.reference || null, paid_at: pay.paid_at,
      });
      if (e) throw e;
      const paidSoFar = (payments.data || []).reduce((a, p) => a + Number(p.amount) + Number(p.short_pay || 0), 0)
        + amt + (Number(pay.short_pay) || 0);
      const balance = Number((Number(inv.data.amount) - paidSoFar).toFixed(2));
      let status = inv.data.status;
      if (balance <= 0.009) status = (Number(pay.short_pay) || 0) > 0 ? 'short_paid' : (Number(pay.over_pay) || 0) > 0 ? 'over_paid' : 'paid';
      else status = 'partial';
      await supabase.from('invoices').update({
        balance: Math.max(balance, 0), status,
        paid_at: balance <= 0.009 ? pay.paid_at : null,
      }).eq('id', id);
      // when fully paid, close the load out
      if (balance <= 0.009 && inv.data.load_id) {
        await supabase.from('loads').update({ status: 'completed' }).eq('id', inv.data.load_id);
      }
      setPay({ amount: '', short_pay: '', over_pay: '', method: 'ach', reference: '', paid_at: new Date().toISOString().slice(0, 10) });
      refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const i = inv.data;
  const paid = (payments.data || []).reduce((a, p) => a + Number(p.amount), 0);

  return (
    <Drawer title={i ? `Invoice ${i.invoice_number}` : 'Invoice'} onClose={onClose}
      footer={<>
        <div style={{ flex: 1 }} />
        {editable && i?.status === 'draft' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => setStatus('sent')}>Mark sent</button>
        )}
        {editable && ['sent', 'partial'].includes(i?.status) && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setStatus('factored')}>Mark factored</button>
        )}
        {editable && i?.status !== 'void' && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setStatus('void')}>Void</button>
        )}
      </>}>
      <ErrorNote error={error || inv.error} />
      {i && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <Chip value={i.status} />
            <span className="small muted">Issued {d(i.invoice_date)}
              {i.load?.customer?.payment_terms_days ? ` · net ${i.load.customer.payment_terms_days}` : ''}</span>
          </div>
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontWeight: 600 }}>{i.load?.customer?.name || 'No customer'}</div>
            <div className="small muted">{i.load?.customer?.billing_email || 'No billing email on file'}</div>
            <div className="small" style={{ marginTop: 6 }}>
              Load #{i.load?.load_number} · {i.load?.pickup_location} → {i.load?.delivery_location}
              {i.load?.customer_load_id ? ` · ref ${i.load.customer_load_id}` : ''}
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '8px 0' }} />
            <div style={{ display: 'flex' }}>
              <span className="muted">Invoiced</span><div style={{ flex: 1 }} />
              <span className="num">{money(i.amount)}</span>
            </div>
            <div style={{ display: 'flex' }}>
              <span className="muted">Received</span><div style={{ flex: 1 }} />
              <span className="num">{money(paid)}</span>
            </div>
            <div style={{ display: 'flex', fontWeight: 700 }}>
              <span>Balance</span><div style={{ flex: 1 }} />
              <span className="num">{money(i.balance)}</span>
            </div>
          </div>

          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, margin: '0 0 6px' }}>Payments</h3>
          {(payments.data || []).map((p) => (
            <div key={p.id} className="feed-item" style={{ padding: '7px 2px' }}>
              <div style={{ flex: 1 }} className="small">
                {d(p.paid_at)} · {p.method || '—'} {p.reference ? `· ${p.reference}` : ''}
                {Number(p.short_pay) > 0 && <span className="chip red" style={{ marginLeft: 6 }}>short {money(p.short_pay)}</span>}
                {Number(p.over_pay) > 0 && <span className="chip green" style={{ marginLeft: 6 }}>over {money(p.over_pay)}</span>}
              </div>
              <div className="num">{money(p.amount)}</div>
            </div>
          ))}
          {payments.data?.length === 0 && <p className="small muted">Nothing received yet.</p>}

          {editable && i.status !== 'void' && Number(i.balance) > 0 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 10 }}>
              <div className="frow">
                <Field label="Amount received ($)">
                  <input type="number" step="0.01" value={pay.amount}
                    onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} />
                </Field>
                <Field label="Date">
                  <input type="date" value={pay.paid_at}
                    onChange={(e) => setPay((p) => ({ ...p, paid_at: e.target.value }))} />
                </Field>
              </div>
              <div className="frow">
                <Field label="Short pay ($)">
                  <input type="number" step="0.01" value={pay.short_pay}
                    onChange={(e) => setPay((p) => ({ ...p, short_pay: e.target.value }))} />
                </Field>
                <Field label="Over pay ($)">
                  <input type="number" step="0.01" value={pay.over_pay}
                    onChange={(e) => setPay((p) => ({ ...p, over_pay: e.target.value }))} />
                </Field>
              </div>
              <div className="frow">
                <Field label="Method">
                  <select value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>
                    {['ach', 'check', 'wire', 'factoring', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Reference">
                  <input value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} />
                </Field>
              </div>
              <button className="btn btn-primary" disabled={busy} onClick={addPayment}>Record payment</button>
              <p className="small muted" style={{ marginTop: 6 }}>
                A short pay closes the balance as “short paid”. Paying in full marks the load completed.
              </p>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
