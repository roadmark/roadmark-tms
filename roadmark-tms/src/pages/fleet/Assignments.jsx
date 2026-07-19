import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { d, ago } from '../../lib/format';

export default function Assignments() {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const active = useQuery({
    queryKey: ['assignments', companyId, 'active'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('assignments')
        .select(`id, started_at, note,
                 driver:drivers(id, full_name, status),
                 truck:trucks(id, unit_number),
                 trailer:trailers(id, unit_number)`)
        .eq('company_id', companyId).is('ended_at', null)
        .order('started_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const history = useQuery({
    queryKey: ['assignments', companyId, 'history'],
    enabled: !!companyId && showHistory,
    queryFn: async () => {
      const { data, error } = await supabase.from('assignments')
        .select(`id, started_at, ended_at, note,
                 driver:drivers(full_name), truck:trucks(unit_number), trailer:trailers(unit_number)`)
        .eq('company_id', companyId).not('ended_at', 'is', null)
        .order('ended_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const endIt = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('assignments')
        .update({ ended_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });

  const editable = canEdit('fleet') || canEdit('dispatch');

  return (
    <>
      <div className="page-head">
        <h2>Assignments</h2>
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={() => setShowHistory((s) => !s)}>
          {showHistory ? 'Hide history' : 'Show history'}
        </button>
        {editable && <button className="btn btn-primary" onClick={() => setOpen(true)}>New assignment</button>}
      </div>
      <ErrorNote error={active.error || endIt.error} />

      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr><th>Driver</th><th>Truck</th><th>Trailer</th><th>Since</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {(active.data || []).map((a) => (
              <tr key={a.id} className="norow">
                <td style={{ fontWeight: 600 }}>{a.driver?.full_name || '—'}</td>
                <td className="num">{a.truck?.unit_number || '—'}</td>
                <td className="num">{a.trailer?.unit_number || '—'}</td>
                <td>{d(a.started_at)} <span className="small muted">({ago(a.started_at)})</span></td>
                <td className="small">{a.note || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {editable && (
                    <button className="btn btn-ghost" disabled={endIt.isPending}
                      onClick={() => { if (confirm('End this assignment? History is kept.')) endIt.mutate(a.id); }}>
                      End
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {active.data?.length === 0 && (
          <Empty head="No active assignments"
            sub="Pair a driver with a truck and trailer — new loads then fill equipment in automatically." />
        )}
      </div>

      {showHistory && (
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 4 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>Past assignments</h3>
          </div>
          <table className="data">
            <thead><tr><th>Driver</th><th>Truck</th><th>Trailer</th><th>From</th><th>To</th></tr></thead>
            <tbody>
              {(history.data || []).map((a) => (
                <tr key={a.id} className="norow">
                  <td>{a.driver?.full_name || '—'}</td>
                  <td className="num">{a.truck?.unit_number || '—'}</td>
                  <td className="num">{a.trailer?.unit_number || '—'}</td>
                  <td>{d(a.started_at)}</td>
                  <td>{d(a.ended_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data?.length === 0 && <Empty head="No past assignments yet" sub="Ended assignments are kept here permanently." />}
        </div>
      )}

      {open && <AssignDrawer onClose={() => setOpen(false)} companyId={companyId} userId={user?.id}
        onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['assignments'] }); }} />}
    </>
  );
}

function AssignDrawer({ onClose, onSaved, companyId, userId }) {
  const [f, setF] = useState({ driver_id: '', truck_id: '', trailer_id: '', note: '' });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  // only show people/equipment that are not already actively assigned
  const opts = useQuery({
    queryKey: ['assign-options', companyId],
    queryFn: async () => {
      const [dr, t, tr, act] = await Promise.all([
        supabase.from('drivers').select('id, full_name').eq('company_id', companyId)
          .in('status', ['active', 'ready', 'approved']).order('full_name'),
        supabase.from('trucks').select('id, unit_number').eq('company_id', companyId)
          .in('status', ['active', 'ready']).order('unit_number'),
        supabase.from('trailers').select('id, unit_number').eq('company_id', companyId)
          .in('status', ['active', 'ready']).order('unit_number'),
        supabase.from('assignments').select('driver_id, truck_id, trailer_id')
          .eq('company_id', companyId).is('ended_at', null),
      ]);
      for (const r of [dr, t, tr, act]) if (r.error) throw r.error;
      const usedD = new Set(act.data.map((a) => a.driver_id).filter(Boolean));
      const usedT = new Set(act.data.map((a) => a.truck_id).filter(Boolean));
      const usedR = new Set(act.data.map((a) => a.trailer_id).filter(Boolean));
      return {
        drivers: dr.data.filter((x) => !usedD.has(x.id)),
        trucks: t.data.filter((x) => !usedT.has(x.id)),
        trailers: tr.data.filter((x) => !usedR.has(x.id)),
      };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.driver_id && !f.truck_id && !f.trailer_id) throw new Error('Pick at least a driver and a truck.');
      const { error } = await supabase.from('assignments').insert({
        company_id: companyId,
        driver_id: f.driver_id || null,
        truck_id: f.truck_id || null,
        trailer_id: f.trailer_id || null,
        note: f.note || null,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: onSaved,
  });

  const o = opts.data;
  return (
    <Drawer title="New assignment" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Assign'}
        </button>
      </>}>
      <ErrorNote error={save.error || opts.error} />
      <p className="muted small">Only unassigned drivers and equipment are listed — one active
        assignment per driver, truck, and trailer. Ending an assignment keeps the history.</p>
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
      <Field label="Trailer">
        <select value={f.trailer_id} onChange={set('trailer_id')}>
          <option value="">—</option>
          {(o?.trailers || []).map((x) => <option key={x.id} value={x.id}>{x.unit_number}</option>)}
        </select>
      </Field>
      <Field label="Note"><input value={f.note} onChange={set('note')} placeholder="e.g. swapped trailer at Joliet yard" /></Field>
    </Drawer>
  );
}
