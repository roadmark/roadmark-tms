import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { money, d } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';

const LOAD_PAY_STATUSES = ['delivered', 'invoiced', 'payment_pending', 'completed'];

/** Sunday-ending week that contains today, as {start, end} yyyy-mm-dd */
function defaultPeriod() {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() - end.getDay()); // last Sunday
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const f = (x) => x.toISOString().slice(0, 10);
  return { start: f(start), end: f(end) };
}

export default function Settlements() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [runOpen, setRunOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const editable = canEdit('accounting');

  const list = useQuery({
    queryKey: ['settlements', companyId, statusFilter],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('settlements')
        .select(`id, statement_number, period_start, period_end, cutoff_date, status,
                 loads_total, credits_total, fuel_total, tolls_total, deductions_total,
                 scheduled_total, balance_forward, net_pay, paid_at,
                 driver:drivers(id, full_name)`)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(100);
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <div className="filter-row">
        {['', 'draft', 'approved', 'paid', 'void'].map((s) => (
          <span key={s || 'all'} className={`chip gray ${statusFilter === s ? 'on' : ''}`}
            onClick={() => setStatusFilter(s)}>{s || 'all'}</span>
        ))}
        <div style={{ flex: 1 }} />
        {editable && <button className="btn btn-primary" onClick={() => setRunOpen(true)}>New settlement run</button>}
      </div>
      <ErrorNote error={list.error} />

      <div className="card">
        <table className="data">
          <thead><tr>
            <th>Statement</th><th>Driver</th><th>Period</th><th>Status</th>
            <th>Loads</th><th>Credits</th><th>Fuel</th><th>Tolls</th>
            <th>Deductions</th><th>Scheduled</th><th>Fwd</th><th>Net pay</th>
          </tr></thead>
          <tbody>
            {(list.data || []).map((s) => (
              <tr key={s.id} onClick={() => setOpenId(s.id)}>
                <td className="num">#{s.statement_number}</td>
                <td style={{ fontWeight: 600 }}>{s.driver?.full_name}</td>
                <td className="small">{d(s.period_start)} – {d(s.period_end)}</td>
                <td><Chip value={s.status} /></td>
                <td className="num">{money(s.loads_total)}</td>
                <td className="num">{money(s.credits_total)}</td>
                <td className="num">{money(-s.fuel_total)}</td>
                <td className="num">{money(-s.tolls_total)}</td>
                <td className="num">{money(-s.deductions_total)}</td>
                <td className="num">{money(-s.scheduled_total)}</td>
                <td className="num">{money(-s.balance_forward)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(s.net_pay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && (
          <Empty head="No settlements yet"
            sub='Click "New settlement run", pick the week, and the app gathers every open item per driver.' />
        )}
      </div>

      {runOpen && <RunDrawer onClose={() => setRunOpen(false)}
        onDone={() => { setRunOpen(false); qc.invalidateQueries({ queryKey: ['settlements'] }); }} />}
      {openId && <SettlementDrawer id={openId} onClose={() => setOpenId(null)}
        onChanged={() => qc.invalidateQueries()} />}
    </>
  );
}

/* ---------------- the run: preview then create drafts ---------------- */

function RunDrawer({ onClose, onDone }) {
  const { companyId, user } = useAuth();
  const def = defaultPeriod();
  const [start, setStart] = useState(def.start);
  const [end, setEnd] = useState(def.end);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ['settle-preview', companyId, start, end],
    enabled: !!companyId && !!end,
    queryFn: async () => {
      const cut = end;
      const [drivers, loads, credits, fuel, tolls, deds, runs, bals] = await Promise.all([
        supabase.from('drivers').select('id, full_name, status').eq('company_id', companyId),
        supabase.from('loads')
          .select('id, load_number, driver_id, driver_rate, delivery_time, pickup_location, delivery_location')
          .eq('company_id', companyId).is('settlement_id', null)
          .in('status', LOAD_PAY_STATUSES).lte('delivery_time', `${cut}T23:59:59`),
        supabase.from('credits').select('id, driver_id, amount, description, issued_date, category')
          .eq('company_id', companyId).eq('status', 'open').lte('issued_date', cut),
        supabase.from('fuel_transactions').select('id, driver_id, total, issued_date, city, state, product')
          .eq('company_id', companyId).eq('status', 'open').eq('charge_to', 'driver').lte('issued_date', cut),
        supabase.from('toll_transactions').select('id, driver_id, amount, issued_date, plaza_name')
          .eq('company_id', companyId).eq('status', 'open').eq('charge_to', 'driver').lte('issued_date', cut),
        supabase.from('deductions').select('id, driver_id, total, issued_date, description, category')
          .eq('company_id', companyId).eq('status', 'open').eq('charge_to', 'driver').lte('issued_date', cut),
        supabase.from('recurring_deduction_runs')
          .select('id, driver_id, amount, run_date, recurring_deduction:recurring_deductions(name)')
          .eq('company_id', companyId).eq('status', 'open').lte('run_date', cut),
        supabase.from('balance_dues').select('id, driver_id, amount, description, issued_date')
          .eq('company_id', companyId).eq('status', 'open').lte('issued_date', cut),
      ]);
      for (const r of [drivers, loads, credits, fuel, tolls, deds, runs, bals]) if (r.error) throw r.error;

      const byDriver = new Map();
      const ensure = (id) => {
        if (!id) return null;
        if (!byDriver.has(id)) byDriver.set(id, {
          driver_id: id,
          name: drivers.data.find((x) => x.id === id)?.full_name || 'Unknown',
          loads: [], credits: [], fuel: [], tolls: [], deductions: [], scheduled: [], balance: [],
        });
        return byDriver.get(id);
      };
      loads.data.forEach((r) => ensure(r.driver_id)?.loads.push(r));
      credits.data.forEach((r) => ensure(r.driver_id)?.credits.push(r));
      fuel.data.forEach((r) => ensure(r.driver_id)?.fuel.push(r));
      tolls.data.forEach((r) => ensure(r.driver_id)?.tolls.push(r));
      deds.data.forEach((r) => ensure(r.driver_id)?.deductions.push(r));
      runs.data.forEach((r) => ensure(r.driver_id)?.scheduled.push(r));
      bals.data.forEach((r) => ensure(r.driver_id)?.balance.push(r));

      const sum = (arr, k) => arr.reduce((a, x) => a + Number(x[k] || 0), 0);
      return [...byDriver.values()].map((v) => {
        const loads_total = sum(v.loads, 'driver_rate');
        const credits_total = sum(v.credits, 'amount');
        const fuel_total = sum(v.fuel, 'total');
        const tolls_total = sum(v.tolls, 'amount');
        const deductions_total = sum(v.deductions, 'total');
        const scheduled_total = sum(v.scheduled, 'amount');
        const balance_forward = sum(v.balance, 'amount');
        const net = loads_total + credits_total - fuel_total - tolls_total
          - deductions_total - scheduled_total - balance_forward;
        return { ...v, loads_total, credits_total, fuel_total, tolls_total,
          deductions_total, scheduled_total, balance_forward, net };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const create = async () => {
    try {
      setBusy(true); setError(null);
      for (const p of preview.data || []) {
        // next statement number for this driver
        const { data: last } = await supabase.from('settlements')
          .select('statement_number').eq('company_id', companyId).eq('driver_id', p.driver_id)
          .order('statement_number', { ascending: false }).limit(1).maybeSingle();
        const statement_number = (last?.statement_number || 0) + 1;

        const { data: st, error: sErr } = await supabase.from('settlements').insert({
          company_id: companyId, driver_id: p.driver_id, statement_number,
          period_start: start, period_end: end, cutoff_date: end, status: 'draft',
          loads_total: p.loads_total, credits_total: p.credits_total,
          fuel_total: p.fuel_total, tolls_total: p.tolls_total,
          deductions_total: p.deductions_total, scheduled_total: p.scheduled_total,
          balance_forward: p.balance_forward, net_pay: Number(p.net.toFixed(2)),
          created_by: user?.id,
        }).select('id').single();
        if (sErr) throw sErr;

        const lines = [
          ...p.loads.map((r) => ({ line_type: 'load', ref_table: 'loads', ref_id: r.id,
            description: `Load #${r.load_number} ${r.pickup_location || ''} → ${r.delivery_location || ''}`,
            amount: Number(r.driver_rate || 0) })),
          ...p.credits.map((r) => ({ line_type: 'credit', ref_table: 'credits', ref_id: r.id,
            description: r.description || r.category, amount: Number(r.amount || 0) })),
          ...p.fuel.map((r) => ({ line_type: 'fuel', ref_table: 'fuel_transactions', ref_id: r.id,
            description: `Fuel ${r.product || ''} ${[r.city, r.state].filter(Boolean).join(', ')} ${r.issued_date}`,
            amount: -Number(r.total || 0) })),
          ...p.tolls.map((r) => ({ line_type: 'toll', ref_table: 'toll_transactions', ref_id: r.id,
            description: `Toll ${r.plaza_name || ''} ${r.issued_date}`, amount: -Number(r.amount || 0) })),
          ...p.deductions.map((r) => ({ line_type: 'deduction', ref_table: 'deductions', ref_id: r.id,
            description: r.description || r.category, amount: -Number(r.total || 0) })),
          ...p.scheduled.map((r) => ({ line_type: 'scheduled_deduction', ref_table: 'recurring_deduction_runs',
            ref_id: r.id, description: `${r.recurring_deduction?.name || 'Scheduled'} ${r.run_date}`,
            amount: -Number(r.amount || 0) })),
          ...p.balance.map((r) => ({ line_type: 'balance_forward', ref_table: 'balance_dues', ref_id: r.id,
            description: r.description || 'Balance forward', amount: -Number(r.amount || 0) })),
        ].map((l) => ({ ...l, settlement_id: st.id, company_id: companyId }));

        if (lines.length) {
          const { error: lErr } = await supabase.from('settlement_lines').insert(lines);
          if (lErr) throw lErr;
        }
      }
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const rows = preview.data || [];
  return (
    <Drawer title="New settlement run" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !rows.length} onClick={create}>
          {busy ? 'Creating…' : `Create ${rows.length} draft${rows.length === 1 ? '' : 's'}`}
        </button>
      </>}>
      <ErrorNote error={error || preview.error} />
      <p className="muted small">Everything still open on or before the cutoff is gathered —
        including older items missed in previous weeks. Nothing is charged or closed until
        you approve each statement.</p>
      <div className="frow">
        <Field label="Period start"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Period end / cutoff"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>

      {preview.isFetching && <p>Calculating…</p>}
      {!preview.isFetching && rows.length === 0 && (
        <Empty head="Nothing to settle" sub="No open loads or charges on or before this cutoff." />
      )}
      {rows.map((p) => (
        <div key={p.driver_id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <b>{p.name}</b>
            <div style={{ flex: 1 }} />
            <b className="num" style={{ fontSize: 16, color: p.net < 0 ? 'var(--danger)' : 'var(--ok)' }}>
              {money(p.net)}
            </b>
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {p.loads.length} loads {money(p.loads_total)}
            {p.credits_total > 0 && ` · credits ${money(p.credits_total)}`}
            {p.fuel_total > 0 && ` · fuel −${money(p.fuel_total)}`}
            {p.tolls_total > 0 && ` · tolls −${money(p.tolls_total)}`}
            {p.deductions_total > 0 && ` · deductions −${money(p.deductions_total)}`}
            {p.scheduled_total > 0 && ` · scheduled −${money(p.scheduled_total)}`}
            {p.balance_forward > 0 && ` · forward −${money(p.balance_forward)}`}
          </div>
          {p.net < 0 && (
            <div className="small" style={{ color: 'var(--danger)' }}>
              Negative — on approval this becomes a balance due carried to next week.
            </div>
          )}
        </div>
      ))}
    </Drawer>
  );
}

/* ---------------- one settlement: lines, approve, pay, void ---------------- */

const SOURCE_TABLE = {
  load: 'loads', credit: 'credits', fuel: 'fuel_transactions', toll: 'toll_transactions',
  deduction: 'deductions', scheduled_deduction: 'recurring_deduction_runs',
  balance_forward: 'balance_dues',
};

function SettlementDrawer({ id, onClose, onChanged }) {
  const { companyId, user, canEdit } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const editable = canEdit('accounting');

  const st = useQuery({
    queryKey: ['settlement', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('settlements')
        .select('*, driver:drivers(full_name, pay_rate_type, pay_rate)').eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const lines = useQuery({
    queryKey: ['settlement-lines', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('settlement_lines')
        .select('*').eq('settlement_id', id).order('line_type');
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settlement', id] });
    qc.invalidateQueries({ queryKey: ['settlement-lines', id] });
    qc.invalidateQueries({ queryKey: ['settlements'] });
    onChanged?.();
  };

  const recalc = async () => {
    const { data: ls } = await supabase.from('settlement_lines').select('line_type, amount').eq('settlement_id', id);
    const sum = (t) => (ls || []).filter((l) => l.line_type === t).reduce((a, l) => a + Number(l.amount), 0);
    const totals = {
      loads_total: sum('load'), credits_total: sum('credit'),
      fuel_total: -sum('fuel'), tolls_total: -sum('toll'),
      deductions_total: -sum('deduction'), scheduled_total: -sum('scheduled_deduction'),
      balance_forward: -sum('balance_forward'),
    };
    const net = (ls || []).reduce((a, l) => a + Number(l.amount), 0);
    await supabase.from('settlements').update({ ...totals, net_pay: Number(net.toFixed(2)) }).eq('id', id);
    refresh();
  };

  const removeLine = async (lineId) => {
    try {
      setBusy(true);
      const { error: e } = await supabase.from('settlement_lines').delete().eq('id', lineId);
      if (e) throw e;
      await recalc();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const approve = async () => {
    try {
      setBusy(true); setError(null);
      const ls = lines.data || [];
      // stamp + close every source row
      for (const l of ls) {
        const table = SOURCE_TABLE[l.line_type];
        if (!table || !l.ref_id) continue;
        if (table === 'loads') {
          await supabase.from('loads').update({ settlement_id: id }).eq('id', l.ref_id);
        } else if (table === 'balance_dues') {
          await supabase.from('balance_dues')
            .update({ status: 'closed', applied_settlement_id: id }).eq('id', l.ref_id);
        } else {
          await supabase.from(table).update({ status: 'closed', settlement_id: id }).eq('id', l.ref_id);
        }
      }
      const net = Number(st.data.net_pay || 0);
      if (net < 0) {
        const { error: bErr } = await supabase.from('balance_dues').insert({
          company_id: companyId, driver_id: st.data.driver_id,
          issued_date: st.data.period_end,
          description: `Statement ${st.data.statement_number}`,
          amount: Number(Math.abs(net).toFixed(2)), status: 'open',
          source_settlement_id: id, created_by: user?.id,
        });
        if (bErr) throw bErr;
        await supabase.from('settlements').update({ status: 'approved', net_pay: 0 }).eq('id', id);
      } else {
        await supabase.from('settlements').update({ status: 'approved' }).eq('id', id);
      }
      refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const markPaid = async () => {
    try {
      setBusy(true);
      await supabase.from('settlements').update({
        status: 'paid', paid_at: new Date().toISOString().slice(0, 10),
      }).eq('id', id);
      refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const voidIt = async () => {
    if (!confirm('Void this statement? Every line goes back to open so it can be settled again.')) return;
    try {
      setBusy(true);
      for (const l of (lines.data || [])) {
        const table = SOURCE_TABLE[l.line_type];
        if (!table || !l.ref_id) continue;
        if (table === 'loads') {
          await supabase.from('loads').update({ settlement_id: null }).eq('id', l.ref_id);
        } else if (table === 'balance_dues') {
          await supabase.from('balance_dues')
            .update({ status: 'open', applied_settlement_id: null }).eq('id', l.ref_id);
        } else {
          await supabase.from(table).update({ status: 'open', settlement_id: null }).eq('id', l.ref_id);
        }
      }
      // remove a balance due this statement created
      await supabase.from('balance_dues').delete().eq('source_settlement_id', id).eq('status', 'open');
      await supabase.from('settlements').update({ status: 'void' }).eq('id', id);
      refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const s = st.data;
  const grouped = {};
  for (const l of (lines.data || [])) (grouped[l.line_type] ||= []).push(l);
  const LABEL = {
    load: 'Loads', credit: 'Credits', fuel: 'Fuel', toll: 'Tolls',
    deduction: 'Deductions', scheduled_deduction: 'Scheduled deductions',
    balance_forward: 'Balance forward',
  };

  const exportCsv = () => downloadCsv(
    `statement_${s?.driver?.full_name?.replace(/\W+/g, '_')}_${s?.statement_number}.csv`,
    (lines.data || []).map((l) => ({
      type: l.line_type, description: l.description, amount: l.amount,
    })).concat([{ type: 'NET PAY', description: `${s?.period_start} – ${s?.period_end}`, amount: s?.net_pay }])
  );

  return (
    <Drawer
      title={s ? `Statement ${s.statement_number} — ${s.driver?.full_name}` : 'Statement'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={exportCsv}>Export CSV</button>
          <div style={{ flex: 1 }} />
          {editable && s?.status === 'draft' && (
            <button className="btn btn-primary" disabled={busy} onClick={approve}>Approve</button>
          )}
          {editable && s?.status === 'approved' && (
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={voidIt}>Void</button>
              <button className="btn btn-primary" disabled={busy} onClick={markPaid}>Mark paid</button>
            </>
          )}
          {editable && s?.status === 'paid' && (
            <button className="btn btn-ghost" disabled={busy} onClick={voidIt}>Void</button>
          )}
        </>
      }>
      <ErrorNote error={error || st.error || lines.error} />
      {s && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <Chip value={s.status} />
            <span className="small muted">{d(s.period_start)} – {d(s.period_end)} · cutoff {d(s.cutoff_date)}</span>
          </div>

          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
            <Row label="Loads" v={s.loads_total} />
            <Row label="Credits" v={s.credits_total} />
            <Row label="Fuel" v={-s.fuel_total} />
            <Row label="Tolls" v={-s.tolls_total} />
            <Row label="Deductions" v={-s.deductions_total} />
            <Row label="Scheduled deductions" v={-s.scheduled_total} />
            <Row label="Balance forward" v={-s.balance_forward} />
            <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '8px 0' }} />
            <div style={{ display: 'flex' }}>
              <b>Net pay</b><div style={{ flex: 1 }} />
              <b className="num" style={{ fontSize: 18 }}>{money(s.net_pay)}</b>
            </div>
            {s.status === 'draft' && s.net_pay < 0 && (
              <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>
                Negative — approving carries {money(Math.abs(s.net_pay))} to next week as balance due.
              </div>
            )}
          </div>

          {Object.keys(LABEL).filter((k) => grouped[k]?.length).map((k) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div className="nav-section" style={{ padding: '4px 0', color: 'var(--text-3)' }}>{LABEL[k]}</div>
              {grouped[k].map((l) => (
                <div key={l.id} className="feed-item" style={{ padding: '7px 2px' }}>
                  <div style={{ flex: 1 }} className="small">{l.description}</div>
                  <div className="num" style={{ color: Number(l.amount) < 0 ? 'var(--danger)' : 'var(--ok)' }}>
                    {money(l.amount)}
                  </div>
                  {editable && s.status === 'draft' && (
                    <button className="btn btn-ghost" disabled={busy}
                      title="Remove from this statement — the item stays open for next week"
                      onClick={() => removeLine(l.id)}>×</button>
                  )}
                </div>
              ))}
            </div>
          ))}

          {s.status === 'draft' && (
            <p className="small muted">Removing a line leaves that charge open — it simply
              lands on the next statement instead. Approving closes every line and stamps
              this statement on the source records.</p>
          )}
        </>
      )}
    </Drawer>
  );
}

function Row({ label, v }) {
  return (
    <div style={{ display: 'flex', fontSize: 13.5, padding: '2px 0' }}>
      <span className="muted">{label}</span>
      <div style={{ flex: 1 }} />
      <span className="num">{money(v)}</span>
    </div>
  );
}
