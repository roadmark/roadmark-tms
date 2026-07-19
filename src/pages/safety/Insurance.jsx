import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { money, d } from '../../lib/format';
import { statusFor } from './Compliance';

const POLICY_TYPES = [
  ['auto_liability', 'Auto Liability (AL)'],
  ['cargo', 'Cargo (CA)'],
  ['physical_damage', 'Physical Damage (PD)'],
  ['general_liability', 'General Liability (GL)'],
  ['bobtail_ntl', 'Bobtail / Non-trucking (BO)'],
  ['workers_comp', 'Workers Comp (WC)'],
  ['occupational_accident', 'Occupational Accident (Occ)'],
  ['trailer_interchange', 'Trailer Interchange (TI)'],
  ['other', 'Other (OT)'],
];
const LABEL = Object.fromEntries(POLICY_TYPES);

export default function Insurance() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);
  const editable = canEdit('safety');

  const policies = useQuery({
    queryKey: ['policies', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('insurance_policies')
        .select('*').eq('company_id', companyId).order('policy_type');
      if (error) throw error;
      return data;
    },
  });

  const counts = useQuery({
    queryKey: ['enrollment-counts', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('insurance_enrollments')
        .select('policy_id, monthly_cost, charged_to_driver').eq('company_id', companyId).is('removed_date', null);
      if (error) throw error;
      const m = {};
      data.forEach((e) => {
        m[e.policy_id] ||= { n: 0, monthly: 0, driverPaid: 0 };
        m[e.policy_id].n += 1;
        m[e.policy_id].monthly += Number(e.monthly_cost || 0);
        if (e.charged_to_driver) m[e.policy_id].driverPaid += 1;
      });
      return m;
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>Insurance</h2>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add policy</button>}
      </div>
      <ErrorNote error={policies.error} />
      <div className="card">
        <table className="data">
          <thead><tr>
            <th>Type</th><th>Policy #</th><th>Insurer</th><th>Status</th>
            <th>Term</th><th>Units on policy</th><th>Monthly</th><th>Premium</th>
          </tr></thead>
          <tbody>
            {(policies.data || []).map((p) => {
              const c = counts.data?.[p.id];
              const live = p.status === 'cancelled' ? 'cancelled' : statusFor(p.end_date);
              return (
                <tr key={p.id} onClick={() => editable && setOpen(p)}>
                  <td style={{ fontWeight: 600 }}>{LABEL[p.policy_type] || p.policy_type}</td>
                  <td className="small">{p.policy_number}</td>
                  <td>{p.insurer || '—'}</td>
                  <td><Chip value={live === 'valid' ? 'active' : live} /></td>
                  <td className="small">{d(p.start_date)} – {d(p.end_date)}</td>
                  <td className="num">{c?.n || 0}{c?.driverPaid ? ` (${c.driverPaid} driver-paid)` : ''}</td>
                  <td className="num">{money(c?.monthly || 0)}</td>
                  <td className="num">{money(p.premium_total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {policies.data?.length === 0 && (
          <Empty head="No policies yet"
            sub="Add your AL, Cargo, Physical Damage, Occupational Accident policies and enroll the units and drivers they cover." />
        )}
      </div>

      {open && <PolicyDrawer row={open === 'new' ? null : open} onClose={() => setOpen(null)}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['policies'] }); qc.invalidateQueries({ queryKey: ['enrollment-counts'] }); }} />}
    </>
  );
}

function PolicyDrawer({ row, onClose, onSaved }) {
  const { companyId, user } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({
    policy_type: row?.policy_type || 'auto_liability',
    policy_number: row?.policy_number || '',
    insurer: row?.insurer || '',
    start_date: row?.start_date || '',
    end_date: row?.end_date || '',
    premium_total: row?.premium_total ?? '',
    installment_amount: row?.installment_amount ?? '',
    coverage_limit: row?.coverage_limit ?? '',
    deductible: row?.deductible ?? '',
    coverage_basis: row?.coverage_basis || 'per_unit',
    status: row?.status || 'active',
    agent_name: row?.agent_name || '',
    agent_phone: row?.agent_phone || '',
    notes: row?.notes || '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      if (!f.policy_number.trim()) throw new Error('Policy number is required.');
      const payload = {
        company_id: companyId, ...f,
        premium_total: f.premium_total === '' ? null : Number(f.premium_total),
        installment_amount: f.installment_amount === '' ? null : Number(f.installment_amount),
        coverage_limit: f.coverage_limit === '' ? null : Number(f.coverage_limit),
        deductible: f.deductible === '' ? null : Number(f.deductible),
        start_date: f.start_date || null, end_date: f.end_date || null,
      };
      if (row) {
        const { error } = await supabase.from('insurance_policies').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('insurance_policies')
          .insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Drawer title={row ? `Policy ${row.policy_number}` : 'Add policy'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save policy'}
        </button>
      </>}>
      <ErrorNote error={save.error} />
      <Field label="Coverage type">
        <select value={f.policy_type} onChange={set('policy_type')}>
          {POLICY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <div className="frow">
        <Field label="Policy number"><input value={f.policy_number} onChange={set('policy_number')} /></Field>
        <Field label="Insurer"><input value={f.insurer} onChange={set('insurer')} /></Field>
      </div>
      <div className="frow">
        <Field label="Start date"><input type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="End date"><input type="date" value={f.end_date} onChange={set('end_date')} /></Field>
      </div>
      <div className="frow">
        <Field label="Premium total ($)"><input type="number" step="0.01" value={f.premium_total} onChange={set('premium_total')} /></Field>
        <Field label="Monthly installment ($)"><input type="number" step="0.01" value={f.installment_amount} onChange={set('installment_amount')} /></Field>
      </div>
      <div className="frow">
        <Field label="Coverage limit ($)"><input type="number" step="0.01" value={f.coverage_limit} onChange={set('coverage_limit')} /></Field>
        <Field label="Deductible ($)"><input type="number" step="0.01" value={f.deductible} onChange={set('deductible')} /></Field>
      </div>
      <div className="frow">
        <Field label="Basis">
          <select value={f.coverage_basis} onChange={set('coverage_basis')}>
            <option value="per_unit">per unit</option><option value="blanket">blanket</option>
          </select>
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {['active', 'expired_soon', 'expired', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Agent"><input value={f.agent_name} onChange={set('agent_name')} /></Field>
        <Field label="Agent phone"><input value={f.agent_phone} onChange={set('agent_phone')} /></Field>
      </div>
      <Field label="Notes"><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>

      {row && <Enrollments policyId={row.id} onChanged={() => qc.invalidateQueries({ queryKey: ['enrollment-counts'] })} />}
      {!row && <p className="small muted">Save the policy, then reopen it to enroll trucks, trailers and drivers.</p>}
    </Drawer>
  );
}

function Enrollments({ policyId, onChanged }) {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ entity_type: 'truck', entity_id: '', monthly_cost: '', charged_to_driver: false });
  const editable = canEdit('safety');

  const list = useQuery({
    queryKey: ['enrollments', policyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('insurance_enrollments')
        .select(`id, entity_type, monthly_cost, charged_to_driver, added_date, removed_date,
                 truck:trucks(unit_number), trailer:trailers(unit_number), driver:drivers(full_name)`)
        .eq('policy_id', policyId).is('removed_date', null).order('added_date');
      if (error) throw error;
      return data;
    },
  });

  const opts = useQuery({
    queryKey: ['enroll-options', companyId],
    queryFn: async () => {
      const [t, tr, dr] = await Promise.all([
        supabase.from('trucks').select('id, unit_number').eq('company_id', companyId).order('unit_number'),
        supabase.from('trailers').select('id, unit_number').eq('company_id', companyId).order('unit_number'),
        supabase.from('drivers').select('id, full_name').eq('company_id', companyId).order('full_name'),
      ]);
      return { trucks: t.data || [], trailers: tr.data || [], drivers: dr.data || [] };
    },
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['enrollments', policyId] }); onChanged?.(); };

  const add = useMutation({
    mutationFn: async () => {
      if (!n.entity_id) throw new Error('Pick what to enroll.');
      const row = {
        policy_id: policyId, company_id: companyId, entity_type: n.entity_type,
        truck_id: n.entity_type === 'truck' ? n.entity_id : null,
        trailer_id: n.entity_type === 'trailer' ? n.entity_id : null,
        driver_id: n.entity_type === 'driver' ? n.entity_id : null,
        monthly_cost: n.monthly_cost === '' ? null : Number(n.monthly_cost),
        charged_to_driver: n.charged_to_driver,
      };
      const { error } = await supabase.from('insurance_enrollments').insert(row);
      if (error) throw error;
    },
    onSuccess: () => { setAdding(false); setN({ entity_type: 'truck', entity_id: '', monthly_cost: '', charged_to_driver: false }); refresh(); },
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('insurance_enrollments')
        .update({ removed_date: new Date().toISOString().slice(0, 10) }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const choices = n.entity_type === 'truck' ? opts.data?.trucks
    : n.entity_type === 'trailer' ? opts.data?.trailers : opts.data?.drivers;
  const labelOf = (x) => x.unit_number || x.full_name;

  return (
    <>
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '14px 0' }} />
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, margin: '0 0 8px' }}>Enrolled on this policy</h3>
      <ErrorNote error={list.error || add.error || remove.error} />
      {(list.data || []).map((e) => (
        <div key={e.id} className="feed-item" style={{ padding: '7px 2px' }}>
          <span className="chip gray">{e.entity_type}</span>
          <div style={{ flex: 1 }} className="small">
            {e.truck?.unit_number || e.trailer?.unit_number || e.driver?.full_name || '—'}
            {e.charged_to_driver && <span className="chip orange" style={{ marginLeft: 6 }}>driver-paid</span>}
          </div>
          <span className="num small">{e.monthly_cost ? money(e.monthly_cost) + '/mo' : '—'}</span>
          {editable && <button className="btn btn-ghost" onClick={() => remove.mutate(e.id)}>Remove</button>}
        </div>
      ))}
      {list.data?.length === 0 && <p className="small muted">Nothing enrolled yet.</p>}

      {editable && !adding && <button className="btn btn-ghost" onClick={() => setAdding(true)}>+ Enroll</button>}
      {adding && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 8 }}>
          <div className="frow">
            <Field label="What">
              <select value={n.entity_type}
                onChange={(e) => setN((p) => ({ ...p, entity_type: e.target.value, entity_id: '' }))}>
                <option value="truck">truck</option><option value="trailer">trailer</option><option value="driver">driver</option>
              </select>
            </Field>
            <Field label="Which">
              <select value={n.entity_id} onChange={(e) => setN((p) => ({ ...p, entity_id: e.target.value }))}>
                <option value="">—</option>
                {(choices || []).map((x) => <option key={x.id} value={x.id}>{labelOf(x)}</option>)}
              </select>
            </Field>
          </div>
          <div className="frow">
            <Field label="Monthly cost ($)">
              <input type="number" step="0.01" value={n.monthly_cost}
                onChange={(e) => setN((p) => ({ ...p, monthly_cost: e.target.value }))} />
            </Field>
            <Field label="Charged to driver?">
              <select value={n.charged_to_driver ? 'yes' : 'no'}
                onChange={(e) => setN((p) => ({ ...p, charged_to_driver: e.target.value === 'yes' }))}>
                <option value="no">No — company pays</option>
                <option value="yes">Yes — deduct from driver</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={add.isPending} onClick={() => add.mutate()}>Enroll</button>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Driver-paid coverages become a recurring deduction in the full build — for now
            add the schedule under Accounting.
          </p>
        </div>
      )}
    </>
  );
}
