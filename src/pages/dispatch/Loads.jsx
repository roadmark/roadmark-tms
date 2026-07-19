import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { LOAD_STATUSES } from '../../data/enums';
import { money, dt } from '../../lib/format';

const LOAD_COLS = `id, load_number, status, customer_load_id, pickup_time, delivery_time,
  pickup_location, delivery_location, loaded_miles, empty_miles, total_miles,
  freight_amount, driver_rate, weight_lbs, notes,
  customer:customers(id, name),
  driver:drivers!loads_driver_id_fkey(id, full_name),
  truck:trucks(id, unit_number),
  trailer:trailers(id, unit_number)`;

export default function Loads() {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(null); // null | 'new' | load row

  const loads = useQuery({
    queryKey: ['loads', companyId, statusFilter],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('loads').select(LOAD_COLS)
        .eq('company_id', companyId)
        .order('load_number', { ascending: false }).limit(100);
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const editable = canEdit('dispatch') || canEdit('accounting');

  return (
    <>
      <div className="page-head">
        <h2>Loads</h2>
        <select className="company-switch" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {LOAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>New load</button>}
      </div>
      <ErrorNote error={loads.error} />
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>#</th><th>Status</th><th>Customer</th><th>Ref</th><th>Pickup</th>
              <th>Delivery</th><th>Driver</th><th>Truck</th><th>Miles</th><th>Rate</th><th>Driver rate</th>
            </tr>
          </thead>
          <tbody>
            {(loads.data || []).map((l) => (
              <tr key={l.id} onClick={() => editable && setOpen(l)}>
                <td className="num">{l.load_number}</td>
                <td><Chip value={l.status} /></td>
                <td>{l.customer?.name || '—'}</td>
                <td>{l.customer_load_id || '—'}</td>
                <td>{l.pickup_location || '—'}<div className="small muted">{dt(l.pickup_time)}</div></td>
                <td>{l.delivery_location || '—'}<div className="small muted">{dt(l.delivery_time)}</div></td>
                <td>{l.driver?.full_name || '—'}</td>
                <td className="num">{l.truck?.unit_number || '—'}</td>
                <td className="num">{l.total_miles || 0}</td>
                <td className="num">{money(l.freight_amount)}</td>
                <td className="num">{money(l.driver_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loads.data?.length === 0 && <Empty head="No loads yet" sub='Click "New load" to create the first one.' />}
      </div>
      {open && <LoadDrawer load={open === 'new' ? null : open} onClose={() => setOpen(null)}
        companyId={companyId} userId={user?.id}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['loads'] }); }} />}
    </>
  );
}

function LoadDrawer({ load, onClose, onSaved, companyId, userId }) {
  const [f, setF] = useState(() => ({
    status: load?.status || 'scheduled',
    customer_id: load?.customer?.id || '',
    customer_load_id: load?.customer_load_id || '',
    driver_id: load?.driver?.id || '',
    truck_id: load?.truck?.id || '',
    trailer_id: load?.trailer?.id || '',
    pickup_location: load?.pickup_location || '',
    pickup_time: load?.pickup_time?.slice(0, 16) || '',
    delivery_location: load?.delivery_location || '',
    delivery_time: load?.delivery_time?.slice(0, 16) || '',
    loaded_miles: load?.loaded_miles ?? 0,
    empty_miles: load?.empty_miles ?? 0,
    freight_amount: load?.freight_amount ?? 0,
    driver_rate: load?.driver_rate ?? 0,
    weight_lbs: load?.weight_lbs ?? '',
    notes: load?.notes || '',
  }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const { companyId: cid } = useAuth();
  const opts = useQuery({
    queryKey: ['load-options', cid],
    queryFn: async () => {
      const [c, dr, t, tr] = await Promise.all([
        supabase.from('customers').select('id,name').eq('company_id', cid).order('name'),
        supabase.from('drivers').select('id,full_name').eq('company_id', cid).in('status', ['active','ready']).order('full_name'),
        supabase.from('trucks').select('id,unit_number').eq('company_id', cid).order('unit_number'),
        supabase.from('trailers').select('id,unit_number').eq('company_id', cid).order('unit_number'),
      ]);
      for (const r of [c, dr, t, tr]) if (r.error) throw r.error;
      return { customers: c.data, drivers: dr.data, trucks: t.data, trailers: tr.data };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        company_id: companyId,
        status: f.status,
        customer_id: f.customer_id || null,
        customer_load_id: f.customer_load_id || null,
        driver_id: f.driver_id || null,
        truck_id: f.truck_id || null,
        trailer_id: f.trailer_id || null,
        pickup_location: f.pickup_location || null,
        pickup_time: f.pickup_time ? new Date(f.pickup_time).toISOString() : null,
        delivery_location: f.delivery_location || null,
        delivery_time: f.delivery_time ? new Date(f.delivery_time).toISOString() : null,
        loaded_miles: Number(f.loaded_miles) || 0,
        empty_miles: Number(f.empty_miles) || 0,
        freight_amount: Number(f.freight_amount) || 0,
        driver_rate: Number(f.driver_rate) || 0,
        weight_lbs: f.weight_lbs ? Number(f.weight_lbs) : null,
        notes: f.notes || null,
      };
      if (load) {
        const { error } = await supabase.from('loads').update({ ...row, updated_by: userId }).eq('id', load.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('loads').insert({ ...row, created_by: userId });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  const o = opts.data;
  return (
    <Drawer title={load ? `Load #${load.load_number}` : 'New load'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : (load ? 'Save changes' : 'Create load')}
        </button>
      </>}>
      <ErrorNote error={save.error || opts.error} />
      <div className="frow">
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {LOAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Customer reference #">
          <input value={f.customer_load_id} onChange={set('customer_load_id')} placeholder="M-28143" />
        </Field>
      </div>
      <Field label="Customer (broker)">
        <select value={f.customer_id} onChange={set('customer_id')}>
          <option value="">—</option>
          {(o?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="frow">
        <Field label="Driver">
          <select value={f.driver_id} onChange={set('driver_id')}>
            <option value="">—</option>
            {(o?.drivers || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select>
        </Field>
        <Field label="Truck">
          <select value={f.truck_id} onChange={set('truck_id')}>
            <option value="">—</option>
            {(o?.trucks || []).map((x) => <option key={x.id} value={x.id}>{x.unit_number}</option>)}
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Trailer">
          <select value={f.trailer_id} onChange={set('trailer_id')}>
            <option value="">—</option>
            {(o?.trailers || []).map((x) => <option key={x.id} value={x.id}>{x.unit_number}</option>)}
          </select>
        </Field>
        <Field label="Weight (lbs)">
          <input type="number" value={f.weight_lbs} onChange={set('weight_lbs')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Pickup — city, state">
          <input value={f.pickup_location} onChange={set('pickup_location')} placeholder="Houston, TX" />
        </Field>
        <Field label="Pickup time">
          <input type="datetime-local" value={f.pickup_time} onChange={set('pickup_time')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Delivery — city, state">
          <input value={f.delivery_location} onChange={set('delivery_location')} placeholder="Rochester, NY" />
        </Field>
        <Field label="Delivery time">
          <input type="datetime-local" value={f.delivery_time} onChange={set('delivery_time')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Loaded miles">
          <input type="number" value={f.loaded_miles} onChange={set('loaded_miles')} />
        </Field>
        <Field label="Empty miles">
          <input type="number" value={f.empty_miles} onChange={set('empty_miles')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Freight amount ($)">
          <input type="number" step="0.01" value={f.freight_amount} onChange={set('freight_amount')} />
        </Field>
        <Field label="Driver rate ($)">
          <input type="number" step="0.01" value={f.driver_rate} onChange={set('driver_rate')} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} value={f.notes} onChange={set('notes')} />
      </Field>
      <p className="small muted">
        Full version adds multi-stop entry, FCFS/appointment windows, rate-con AI intake,
        and document chips — per the build plan (Phases 4–5).
      </p>
    </Drawer>
  );
}
