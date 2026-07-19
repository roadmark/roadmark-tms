import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Drawer, Field, Empty, ErrorNote, Chip } from '../../components/ui';
import { DRIVER_STATUSES, DRIVER_TYPES, PAY_TYPES } from '../../data/enums';
import DeptFeed from '../../components/DeptFeed';

export default function Drivers() {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);

  const drivers = useQuery({
    queryKey: ['drivers', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('drivers')
        .select('id, full_name, email, phone, status, driver_type, cdl_number, cdl_state, pay_rate_type, pay_rate, hire_date, note')
        .eq('company_id', companyId).order('full_name');
      if (error) throw error;
      return data;
    },
  });

  const editable = canEdit('safety');

  return (
    <>
      <div className="page-head">
        <h2>Drivers</h2>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add driver</button>}
      </div>
      <ErrorNote error={drivers.error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Phone</th><th>CDL</th><th>Pay</th></tr></thead>
          <tbody>
            {(drivers.data || []).map((d) => (
              <tr key={d.id} onClick={() => editable && setOpen(d)}>
                <td style={{ fontWeight: 600 }}>{d.full_name}</td>
                <td><Chip value={d.status} /></td>
                <td>{d.driver_type}</td>
                <td>{d.phone || '—'}</td>
                <td>{d.cdl_number ? `${d.cdl_number} (${d.cdl_state || '—'})` : '—'}</td>
                <td className="num">
                  {d.pay_rate_type === 'percentage' ? `${Math.round(d.pay_rate * 100)}%`
                    : d.pay_rate_type === 'flat' ? 'flat'
                    : `$${d.pay_rate}/mi`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {drivers.data?.length === 0 && <Empty head="No drivers yet" sub="Safety adds drivers here; dispatch assigns them to trucks." />}
      </div>

      <DeptFeed dept="safety" title="Safety — assistant activity" />

      {open && <DriverDrawer row={open === 'new' ? null : open} onClose={() => setOpen(null)}
        companyId={companyId} userId={user?.id}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['drivers'] }); }} />}
    </>
  );
}

function DriverDrawer({ row, onClose, onSaved, companyId, userId }) {
  const [f, setF] = useState({
    full_name: row?.full_name || '', email: row?.email || '', phone: row?.phone || '',
    status: row?.status || 'applicant', driver_type: row?.driver_type || 'company',
    cdl_number: row?.cdl_number || '', cdl_state: row?.cdl_state || '',
    pay_rate_type: row?.pay_rate_type || 'percentage', pay_rate: row?.pay_rate ?? 0.88,
    hire_date: row?.hire_date || '', note: row?.note || '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...f, company_id: companyId,
        pay_rate: Number(f.pay_rate) || 0,
        hire_date: f.hire_date || null,
      };
      if (row) {
        const { error } = await supabase.from('drivers').update({ ...payload, updated_by: userId }).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('drivers').insert({ ...payload, created_by: userId });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Drawer title={row ? row.full_name : 'Add driver'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending || !f.full_name} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save driver'}
        </button>
      </>}>
      <ErrorNote error={save.error} />
      <Field label="Full name"><input value={f.full_name} onChange={set('full_name')} /></Field>
      <div className="frow">
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={f.driver_type} onChange={set('driver_type')}>
            {DRIVER_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
      </div>
      <div className="frow">
        <Field label="CDL number"><input value={f.cdl_number} onChange={set('cdl_number')} /></Field>
        <Field label="CDL state"><input value={f.cdl_state} onChange={set('cdl_state')} maxLength={2} placeholder="IL" /></Field>
      </div>
      <div className="frow">
        <Field label="Pay type">
          <select value={f.pay_rate_type} onChange={set('pay_rate_type')}>
            {PAY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={f.pay_rate_type === 'percentage' ? 'Rate (0.88 = 88%)' : 'Rate ($)'}>
          <input type="number" step="0.01" value={f.pay_rate} onChange={set('pay_rate')} />
        </Field>
      </div>
      <Field label="Hire date"><input type="date" value={f.hire_date} onChange={set('hire_date')} /></Field>
      <Field label="Note"><textarea rows={3} value={f.note} onChange={set('note')} /></Field>
      <p className="small muted">
        SSN, DOB and banking live in the restricted private file (Phase 3); compliance
        documents (MED, MVR, CDL scans…) attach there with expiry tracking.
      </p>
    </Drawer>
  );
}
