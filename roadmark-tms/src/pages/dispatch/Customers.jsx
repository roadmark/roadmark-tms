import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Drawer, Field, Empty, ErrorNote, Chip } from '../../components/ui';

export default function Customers() {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);

  const customers = useQuery({
    queryKey: ['customers', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('customers')
        .select('id, name, mc_number, phone, email, billing_email, payment_terms_days, factoring, status, notes')
        .eq('company_id', companyId).order('name');
      if (error) throw error;
      return data;
    },
  });

  const editable = canEdit('dispatch') || canEdit('accounting');

  return (
    <>
      <div className="page-head">
        <h2>Customers &amp; brokers</h2>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add customer</button>}
      </div>
      <ErrorNote error={customers.error} />
      <div className="card">
        <table className="data">
          <thead><tr><th>Name</th><th>MC #</th><th>Phone</th><th>Billing email</th><th>Terms</th><th>Status</th></tr></thead>
          <tbody>
            {(customers.data || []).map((c) => (
              <tr key={c.id} onClick={() => editable && setOpen(c)}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{c.mc_number || '—'}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.billing_email || c.email || '—'}</td>
                <td>{c.payment_terms_days ? `${c.payment_terms_days} days` : '—'}</td>
                <td><Chip value={c.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.data?.length === 0 && <Empty head="No customers yet" sub="Add the brokers and shippers you haul for." />}
      </div>
      {open && <CustomerDrawer row={open === 'new' ? null : open} onClose={() => setOpen(null)}
        companyId={companyId} userId={user?.id}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['customers'] }); }} />}
    </>
  );
}

function CustomerDrawer({ row, onClose, onSaved, companyId, userId }) {
  const [f, setF] = useState({
    name: row?.name || '', mc_number: row?.mc_number || '', phone: row?.phone || '',
    email: row?.email || '', billing_email: row?.billing_email || '',
    payment_terms_days: row?.payment_terms_days ?? 30, status: row?.status || 'active',
    notes: row?.notes || '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...f, payment_terms_days: Number(f.payment_terms_days) || 30, company_id: companyId };
      if (row) {
        const { error } = await supabase.from('customers').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('customers').insert({ ...payload, created_by: userId });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Drawer title={row ? row.name : 'Add customer'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending || !f.name} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save customer'}
        </button>
      </>}>
      <ErrorNote error={save.error} />
      <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
      <div className="frow">
        <Field label="MC #"><input value={f.mc_number} onChange={set('mc_number')} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
      </div>
      <div className="frow">
        <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
        <Field label="Billing email"><input value={f.billing_email} onChange={set('billing_email')} /></Field>
      </div>
      <div className="frow">
        <Field label="Payment terms (days)"><input type="number" value={f.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            <option value="active">active</option>
            <option value="on_hold">on_hold</option>
            <option value="do_not_use">do_not_use</option>
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
    </Drawer>
  );
}
