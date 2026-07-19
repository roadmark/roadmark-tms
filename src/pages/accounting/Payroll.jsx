import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { money, d, title } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';

const DEPTS = ['dispatch', 'accounting', 'safety', 'fleet', 'maintenance', 'tracking', 'admin', 'other'];
const SALARY_TYPES = ['monthly', 'weekly', 'biweekly', 'hourly', 'per_load', 'percentage'];

export default function Payroll() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState('runs');
  const [empOpen, setEmpOpen] = useState(null);
  const [runOpen, setRunOpen] = useState(false);
  const [openRunId, setOpenRunId] = useState(null);
  const editable = canEdit('accounting');

  const employees = useQuery({
    queryKey: ['employees', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('*').eq('company_id', companyId).order('full_name');
      if (error) throw error;
      return data;
    },
  });

  const runs = useQuery({
    queryKey: ['payroll-runs', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_runs')
        .select('*').eq('company_id', companyId).order('period_end', { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const monthlyCost = (employees.data || [])
    .filter((e) => e.status === 'active')
    .reduce((a, e) => {
      const n = Number(e.salary_amount || 0);
      if (e.salary_type === 'monthly') return a + n;
      if (e.salary_type === 'weekly') return a + n * 4.33;
      if (e.salary_type === 'biweekly') return a + n * 2.17;
      return a;
    }, 0);

  return (
    <>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="seg">
          <button className={view === 'runs' ? 'on' : ''} onClick={() => setView('runs')}>Payroll runs</button>
          <button className={view === 'staff' ? 'on' : ''} onClick={() => setView('staff')}>Office staff</button>
        </div>
        <div className="spacer" />
        {editable && view === 'staff' && <button className="btn btn-primary" onClick={() => setEmpOpen('new')}>Add employee</button>}
        {editable && view === 'runs' && <button className="btn btn-primary" onClick={() => setRunOpen(true)}>New payroll run</button>}
      </div>

      <ErrorNote error={employees.error || runs.error} />

      {view === 'staff' && (
        <>
          <div className="grid cols-3" style={{ marginBottom: 14 }}>
            <div className="card stat">
              <div className="label">Active staff</div>
              <div className="value num">{(employees.data || []).filter((e) => e.status === 'active').length}</div>
            </div>
            <div className="card stat">
              <div className="label">Fixed monthly cost</div>
              <div className="value num" style={{ fontSize: 24 }}>{money(monthlyCost)}</div>
              <div className="sub">excludes hourly / per-load / % agreements</div>
            </div>
          </div>
          <div className="card">
            <table className="data">
              <thead><tr><th>Name</th><th>Department</th><th>Position</th><th>Status</th><th>Agreement</th><th>Amount</th></tr></thead>
              <tbody>
                {(employees.data || []).map((e) => (
                  <tr key={e.id} onClick={() => editable && setEmpOpen(e)}>
                    <td style={{ fontWeight: 600 }}>{e.full_name}</td>
                    <td>{title(e.department)}</td>
                    <td>{e.position || '—'}</td>
                    <td><Chip value={e.status} /></td>
                    <td>{title(e.salary_type)}</td>
                    <td className="num">{money(e.salary_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {employees.data?.length === 0 && (
              <Empty head="No office staff yet"
                sub="Add dispatchers, accounting, safety and fleet staff with their pay agreements — payroll runs prefill from these." />
            )}
          </div>
        </>
      )}

      {view === 'runs' && (
        <div className="card">
          <table className="data">
            <thead><tr><th>Period</th><th>Status</th><th>Gross</th><th>Net</th><th>Created</th></tr></thead>
            <tbody>
              {(runs.data || []).map((r) => (
                <tr key={r.id} onClick={() => setOpenRunId(r.id)}>
                  <td>{d(r.period_start)} – {d(r.period_end)}</td>
                  <td><Chip value={r.status} /></td>
                  <td className="num">{money(r.total_gross)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(r.total_net)}</td>
                  <td className="small">{d(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.data?.length === 0 && (
            <Empty head="No payroll runs yet"
              sub='Click "New payroll run", pick the period, and every active employee is prefilled from their agreement.' />
          )}
        </div>
      )}

      {empOpen && <EmployeeDrawer row={empOpen === 'new' ? null : empOpen} onClose={() => setEmpOpen(null)}
        onSaved={() => { setEmpOpen(null); qc.invalidateQueries({ queryKey: ['employees'] }); }} />}
      {runOpen && <NewRunDrawer employees={(employees.data || []).filter((e) => e.status === 'active')}
        onClose={() => setRunOpen(false)}
        onDone={(id) => { setRunOpen(false); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); setOpenRunId(id); }} />}
      {openRunId && <RunDrawer id={openRunId} onClose={() => setOpenRunId(null)}
        onChanged={() => qc.invalidateQueries()} />}
    </>
  );
}

function EmployeeDrawer({ row, onClose, onSaved }) {
  const { companyId, user } = useAuth();
  const [f, setF] = useState({
    full_name: row?.full_name || '', email: row?.email || '', phone: row?.phone || '',
    department: row?.department || 'dispatch', position: row?.position || '',
    status: row?.status || 'active', salary_type: row?.salary_type || 'monthly',
    salary_amount: row?.salary_amount ?? '', salary_notes: row?.salary_notes || '',
    hire_date: row?.hire_date || '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      if (!f.full_name.trim()) throw new Error('Name is required.');
      const payload = {
        company_id: companyId, ...f,
        salary_amount: f.salary_amount === '' ? 0 : Number(f.salary_amount),
        hire_date: f.hire_date || null,
      };
      if (row) {
        const { error } = await supabase.from('employees').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employees').insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Drawer title={row ? row.full_name : 'Add employee'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save employee'}
        </button>
      </>}>
      <ErrorNote error={save.error} />
      <Field label="Full name"><input value={f.full_name} onChange={set('full_name')} /></Field>
      <div className="frow">
        <Field label="Department">
          <select value={f.department} onChange={set('department')}>
            {DEPTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Position"><input value={f.position} onChange={set('position')} placeholder="Dispatcher" /></Field>
      </div>
      <div className="frow">
        <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
      </div>
      <div className="frow">
        <Field label="Pay agreement">
          <select value={f.salary_type} onChange={set('salary_type')}>
            {SALARY_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Amount ($)"><input type="number" step="0.01" value={f.salary_amount} onChange={set('salary_amount')} /></Field>
      </div>
      <div className="frow">
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {['active', 'at_leave', 'terminated'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Hire date"><input type="date" value={f.hire_date} onChange={set('hire_date')} /></Field>
      </div>
      <Field label="Agreement notes">
        <textarea rows={2} value={f.salary_notes} onChange={set('salary_notes')}
          placeholder="e.g. 1% of gross on covered drivers, paid monthly" />
      </Field>
      <p className="small muted">Hourly, per-load and percentage agreements prefill as $0 on a
        payroll run — the note above is shown so you can enter the calculated figure.</p>
    </Drawer>
  );
}

function NewRunDrawer({ employees, onClose, onDone }) {
  const { companyId, user } = useAuth();
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [start, setStart] = useState(first);
  const [end, setEnd] = useState(last);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const baseFor = (e) => (['monthly'].includes(e.salary_type) ? Number(e.salary_amount || 0)
    : e.salary_type === 'weekly' ? Number(e.salary_amount || 0) * 4
    : e.salary_type === 'biweekly' ? Number(e.salary_amount || 0) * 2
    : 0);

  const create = async () => {
    try {
      setBusy(true); setError(null);
      const gross = employees.reduce((a, e) => a + baseFor(e), 0);
      const { data: run, error: rErr } = await supabase.from('payroll_runs').insert({
        company_id: companyId, period_start: start, period_end: end, status: 'draft',
        total_gross: gross, total_net: gross, created_by: user?.id,
      }).select('id').single();
      if (rErr) throw rErr;
      const lines = employees.map((e) => ({
        payroll_run_id: run.id, company_id: companyId, employee_id: e.id,
        base_amount: baseFor(e), bonus: 0, deduction: 0, reimbursement: 0, net: baseFor(e),
        notes: baseFor(e) === 0 ? (e.salary_notes || `${e.salary_type} — enter amount`) : null,
      }));
      if (lines.length) {
        const { error: lErr } = await supabase.from('payroll_lines').insert(lines);
        if (lErr) throw lErr;
      }
      onDone(run.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Drawer title="New payroll run" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !employees.length} onClick={create}>
          {busy ? 'Creating…' : `Create run for ${employees.length} staff`}
        </button>
      </>}>
      <ErrorNote error={error} />
      <div className="frow">
        <Field label="Period start"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Period end"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {employees.length === 0 && <Empty head="No active employees" sub="Add office staff first." />}
      {employees.map((e) => (
        <div key={e.id} className="feed-item" style={{ padding: '7px 2px' }}>
          <div style={{ flex: 1 }}>
            <div className="feed-title">{e.full_name}</div>
            <div className="feed-meta">{title(e.department)} · {title(e.salary_type)}</div>
          </div>
          <div className="num">{money(baseFor(e))}</div>
        </div>
      ))}
    </Drawer>
  );
}

function RunDrawer({ id, onClose, onChanged }) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const editable = canEdit('accounting');

  const run = useQuery({
    queryKey: ['payroll-run', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_runs').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const lines = useQuery({
    queryKey: ['payroll-lines', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_lines')
        .select('*, employee:employees(full_name, department, salary_type)')
        .eq('payroll_run_id', id);
      if (error) throw error;
      return data.sort((a, b) => (a.employee?.full_name || '').localeCompare(b.employee?.full_name || ''));
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll-run', id] });
    qc.invalidateQueries({ queryKey: ['payroll-lines', id] });
    qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    onChanged?.();
  };

  const saveLine = async (line, patch) => {
    try {
      setBusy(true);
      const merged = { ...line, ...patch };
      const net = Number(merged.base_amount || 0) + Number(merged.bonus || 0)
        + Number(merged.reimbursement || 0) - Number(merged.deduction || 0);
      await supabase.from('payroll_lines').update({ ...patch, net: Number(net.toFixed(2)) }).eq('id', line.id);
      const { data: all } = await supabase.from('payroll_lines')
        .select('base_amount, bonus, reimbursement, deduction, net').eq('payroll_run_id', id);
      const gross = (all || []).reduce((a, l) => a + Number(l.base_amount || 0) + Number(l.bonus || 0), 0);
      const totalNet = (all || []).reduce((a, l) => a + Number(l.net || 0), 0);
      await supabase.from('payroll_runs')
        .update({ total_gross: Number(gross.toFixed(2)), total_net: Number(totalNet.toFixed(2)) }).eq('id', id);
      refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const setStatus = async (status) => {
    try {
      setBusy(true);
      const patch = { status };
      await supabase.from('payroll_runs').update(patch).eq('id', id);
      if (status === 'paid') {
        await supabase.from('payroll_lines')
          .update({ paid_at: new Date().toISOString().slice(0, 10) }).eq('payroll_run_id', id);
      }
      refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const r = run.data;
  const locked = !editable || ['approved', 'paid', 'void'].includes(r?.status);

  return (
    <Drawer title={r ? `Payroll ${d(r.period_start)} – ${d(r.period_end)}` : 'Payroll'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={() => downloadCsv(`payroll_${r?.period_end}.csv`,
          (lines.data || []).map((l) => ({
            employee: l.employee?.full_name, department: l.employee?.department,
            base: l.base_amount, bonus: l.bonus, reimbursement: l.reimbursement,
            deduction: l.deduction, net: l.net,
          })))}>Export CSV</button>
        <div style={{ flex: 1 }} />
        {editable && r?.status === 'draft' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => setStatus('approved')}>Approve</button>
        )}
        {editable && r?.status === 'approved' && (
          <>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setStatus('draft')}>Reopen</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => setStatus('paid')}>Mark paid</button>
          </>
        )}
      </>}>
      <ErrorNote error={error || run.error || lines.error} />
      {r && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <Chip value={r.status} />
            <div style={{ flex: 1 }} />
            <span className="small muted">Gross {money(r.total_gross)}</span>
            <b className="num" style={{ fontSize: 16 }}>Net {money(r.total_net)}</b>
          </div>
          {(lines.data || []).map((l) => (
            <div key={l.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <b>{l.employee?.full_name}</b>
                <span className="small muted" style={{ marginLeft: 6 }}>{title(l.employee?.department)}</span>
                <div style={{ flex: 1 }} />
                <b className="num">{money(l.net)}</b>
              </div>
              {l.notes && <div className="small muted">{l.notes}</div>}
              <div className="frow" style={{ marginTop: 6 }}>
                <Field label="Base">
                  <input type="number" step="0.01" defaultValue={l.base_amount} disabled={locked}
                    onBlur={(e) => Number(e.target.value) !== Number(l.base_amount) && saveLine(l, { base_amount: Number(e.target.value) })} />
                </Field>
                <Field label="Bonus">
                  <input type="number" step="0.01" defaultValue={l.bonus} disabled={locked}
                    onBlur={(e) => Number(e.target.value) !== Number(l.bonus) && saveLine(l, { bonus: Number(e.target.value) })} />
                </Field>
              </div>
              <div className="frow">
                <Field label="Reimbursement">
                  <input type="number" step="0.01" defaultValue={l.reimbursement} disabled={locked}
                    onBlur={(e) => Number(e.target.value) !== Number(l.reimbursement) && saveLine(l, { reimbursement: Number(e.target.value) })} />
                </Field>
                <Field label="Deduction">
                  <input type="number" step="0.01" defaultValue={l.deduction} disabled={locked}
                    onBlur={(e) => Number(e.target.value) !== Number(l.deduction) && saveLine(l, { deduction: Number(e.target.value) })} />
                </Field>
              </div>
            </div>
          ))}
          {!locked && <p className="small muted">Edit a figure and click outside the box to save it —
            the net and run totals update immediately.</p>}
        </>
      )}
    </Drawer>
  );
}
