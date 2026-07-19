import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { money } from '../../lib/format';

export default function Vendors() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);
  const editable = canEdit('maintenance') || canEdit('fleet');

  const vendors = useQuery({
    queryKey: ['vendors', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [v, m] = await Promise.all([
        supabase.from('vendors').select('*').eq('company_id', companyId).order('name'),
        supabase.from('maintenance_invoices').select('vendor_id, total').eq('company_id', companyId),
      ]);
      if (v.error) throw v.error;
      const stats = {};
      (m.data || []).forEach((x) => {
        if (!x.vendor_id) return;
        stats[x.vendor_id] ||= { n: 0, total: 0 };
        stats[x.vendor_id].n += 1;
        stats[x.vendor_id].total += Number(x.total || 0);
      });
      return (v.data || []).map((x) => ({ ...x, stats: stats[x.id] || { n: 0, total: 0 } }));
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>Maintenance vendors</h2>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add vendor</button>}
      </div>
      <ErrorNote error={vendors.error} />
      <div className="card">
        <table className="data">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>City</th><th>State</th><th>Invoices</th><th>Total spend</th></tr></thead>
          <tbody>
            {(vendors.data || []).map((v) => (
              <tr key={v.id} onClick={() => editable && setOpen(v)}>
                <td style={{ fontWeight: 600 }}>{v.name}</td>
                <td>{v.phone || '—'}</td>
                <td className="small">{v.email || '—'}</td>
                <td>{v.city || '—'}</td>
                <td>{v.state || '—'}</td>
                <td className="num">{v.stats.n}</td>
                <td className="num">{money(v.stats.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {vendors.data?.length === 0 && (
          <Empty head="No vendors yet" sub="Shops are also created automatically when you scan a repair invoice." />
        )}
      </div>
      {open && <VendorDrawer row={open === 'new' ? null : open} onClose={() => setOpen(null)}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['vendors'] }); }} />}
    </>
  );
}

function VendorDrawer({ row, onClose, onSaved }) {
  const { companyId } = useAuth();
  const [f, setF] = useState({
    name: row?.name || '', phone: row?.phone || '', email: row?.email || '',
    address: row?.address || '', city: row?.city || '', state: row?.state || '', notes: row?.notes || '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error('Name is required.');
      const payload = { ...f, company_id: companyId };
      if (row) {
        const { error } = await supabase.from('vendors').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vendors').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });
  return (
    <Drawer title={row ? row.name : 'Add vendor'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save vendor</button>
      </>}>
      <ErrorNote error={save.error} />
      <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
      <div className="frow">
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
      </div>
      <Field label="Address"><input value={f.address} onChange={set('address')} /></Field>
      <div className="frow">
        <Field label="City"><input value={f.city} onChange={set('city')} /></Field>
        <Field label="State"><input value={f.state} onChange={set('state')} maxLength={2} /></Field>
      </div>
      <Field label="Notes"><textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
    </Drawer>
  );
}
