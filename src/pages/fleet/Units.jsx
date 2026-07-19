import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Drawer, Field, Empty, ErrorNote, Chip } from '../../components/ui';
import { UNIT_STATUSES, OWNERSHIP, TRUCK_TYPES, TRAILER_TYPES } from '../../data/enums';
import DeptFeed from '../../components/DeptFeed';
import ImportWizard from '../accounting/ImportWizard';

export default function Units({ kind }) {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState(kind || 'trucks');
  const [open, setOpen] = useState(null);
  const [importing, setImporting] = useState(false);
  const table = tab; // 'trucks' | 'trailers'

  const units = useQuery({
    queryKey: [table, companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const typeCol = table === 'trucks' ? 'truck_type' : 'trailer_type';
      const { data, error } = await supabase.from(table)
        .select(`id, unit_number, vin, make, model, year, ${typeCol}, ownership, status, plate, plate_state, leasor, note`)
        .eq('company_id', companyId).order('unit_number');
      if (error) throw error;
      return data;
    },
  });

  const editable = canEdit('fleet');
  const typeCol = table === 'trucks' ? 'truck_type' : 'trailer_type';

  return (
    <>
      <div className="page-head">
        <h2>{tab === 'trucks' ? 'Trucks' : 'Trailers'}</h2>
        {!kind && (
          <div className="seg">
            <button className={tab === 'trucks' ? 'on' : ''} onClick={() => setTab('trucks')}>Trucks</button>
            <button className={tab === 'trailers' ? 'on' : ''} onClick={() => setTab('trailers')}>Trailers</button>
          </div>
        )}
        <div className="spacer" />
        {editable && <button className="btn btn-ghost" onClick={() => setImporting(true)}>Import CSV</button>}
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add {tab.slice(0, -1)}</button>}
      </div>
      <ErrorNote error={units.error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr><th>Unit #</th><th>Status</th><th>Type</th><th>Ownership</th><th>VIN</th><th>Plate</th><th>Leasor</th></tr></thead>
          <tbody>
            {(units.data || []).map((u) => (
              <tr key={u.id} onClick={() => editable && setOpen(u)}>
                <td className="num" style={{ fontWeight: 700 }}>{u.unit_number}</td>
                <td><Chip value={u.status} /></td>
                <td>{u[typeCol]}</td>
                <td>{u.ownership}</td>
                <td className="small">{u.vin || '—'}</td>
                <td>{u.plate ? `${u.plate} (${u.plate_state || '—'})` : '—'}</td>
                <td>{u.leasor || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {units.data?.length === 0 && <Empty head={`No ${tab} yet`} sub="Fleet adds units here; dispatch assigns drivers to them." />}
      </div>
      <DeptFeed dept="fleet" />
      {importing && <ImportWizard kind={table} onClose={() => setImporting(false)}
        onDone={() => qc.invalidateQueries({ queryKey: [table] })} />}
      {open && <UnitDrawer table={table} row={open === 'new' ? null : open} onClose={() => setOpen(null)}
        companyId={companyId} userId={user?.id}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: [table] }); }} />}
    </>
  );
}

function UnitDrawer({ table, row, onClose, onSaved, companyId, userId }) {
  const typeCol = table === 'trucks' ? 'truck_type' : 'trailer_type';
  const types = table === 'trucks' ? TRUCK_TYPES : TRAILER_TYPES;
  const [f, setF] = useState({
    unit_number: row?.unit_number || '', vin: row?.vin || '', make: row?.make || '',
    model: row?.model || '', year: row?.year || '', [typeCol]: row?.[typeCol] || types[0],
    ownership: row?.ownership || 'company', status: row?.status || 'active',
    plate: row?.plate || '', plate_state: row?.plate_state || '', leasor: row?.leasor || '',
    note: row?.note || '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...f, company_id: companyId, year: f.year ? Number(f.year) : null };
      if (row) {
        const { error } = await supabase.from(table).update({ ...payload, updated_by: userId }).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table).insert({ ...payload, created_by: userId });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Drawer title={row ? `Unit ${row.unit_number}` : `Add ${table.slice(0, -1)}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending || !f.unit_number} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save unit'}
        </button>
      </>}>
      <ErrorNote error={save.error} />
      <div className="frow">
        <Field label="Unit #"><input value={f.unit_number} onChange={set('unit_number')} /></Field>
        <Field label="VIN"><input value={f.vin} onChange={set('vin')} /></Field>
      </div>
      <div className="frow">
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {UNIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Ownership">
          <select value={f.ownership} onChange={set('ownership')}>
            {OWNERSHIP.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Type">
          <select value={f[typeCol]} onChange={set(typeCol)}>
            {types.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Year"><input type="number" value={f.year} onChange={set('year')} /></Field>
      </div>
      <div className="frow">
        <Field label="Make"><input value={f.make} onChange={set('make')} /></Field>
        <Field label="Model"><input value={f.model} onChange={set('model')} /></Field>
      </div>
      <div className="frow">
        <Field label="Plate"><input value={f.plate} onChange={set('plate')} /></Field>
        <Field label="Plate state"><input value={f.plate_state} onChange={set('plate_state')} maxLength={2} /></Field>
      </div>
      <Field label="Leasor"><input value={f.leasor} onChange={set('leasor')} /></Field>
      <Field label="Note"><textarea rows={3} value={f.note} onChange={set('note')} /></Field>
    </Drawer>
  );
}
