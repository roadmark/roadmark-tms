import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Empty, ErrorNote, Chip } from '../../components/ui';
import { ago, dt } from '../../lib/format';
import FleetMap from '../../components/FleetMap';
import DeptFeed from '../../components/DeptFeed';

export default function TrackTrace() {
  const { companyId } = useAuth();
  const [selected, setSelected] = useState(null);

  const fleet = useQuery({
    queryKey: ['fleet-positions', companyId],
    enabled: !!companyId,
    refetchInterval: 60_000,           // refresh every minute
    queryFn: async () => {
      const { data: locs, error } = await supabase.from('v_unit_latest_location')
        .select('*').eq('company_id', companyId);
      if (error) throw error;

      const { data: trucks } = await supabase.from('trucks')
        .select('id, unit_number, status').eq('company_id', companyId);
      const { data: assigns } = await supabase.from('assignments')
        .select('truck_id, driver:drivers(full_name)').eq('company_id', companyId).is('ended_at', null);
      const { data: loads } = await supabase.from('loads')
        .select('id, load_number, truck_id, status, delivery_location, delivery_time')
        .eq('company_id', companyId).eq('status', 'in_progress');

      const truckById = Object.fromEntries((trucks || []).map((t) => [t.id, t]));
      const driverOf = Object.fromEntries((assigns || []).filter((a) => a.truck_id)
        .map((a) => [a.truck_id, a.driver?.full_name]));
      const loadOf = Object.fromEntries((loads || []).filter((l) => l.truck_id).map((l) => [l.truck_id, l]));

      const positioned = (locs || []).map((r) => ({
        ...r,
        unit_number: truckById[r.truck_id]?.unit_number,
        driver_name: driverOf[r.truck_id],
        load: loadOf[r.truck_id],
      }));
      const positionedIds = new Set(positioned.map((p) => p.truck_id));
      const silent = (trucks || []).filter((t) => !positionedIds.has(t.id))
        .map((t) => ({ truck_id: t.id, unit_number: t.unit_number, status: t.status,
                       driver_name: driverOf[t.id], load: loadOf[t.id] }));
      return { positioned, silent };
    },
  });

  const conns = useQuery({
    queryKey: ['telematics-connections', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('telematics_connections')
        .select('id, provider, label, status, last_sync_at, last_error').eq('company_id', companyId);
      if (error) throw error;
      return data;
    },
  });

  const positioned = fleet.data?.positioned || [];
  const silent = fleet.data?.silent || [];
  const moving = positioned.filter((p) => Number(p.speed_mph) > 5).length;
  const stale = positioned.filter((p) => (Date.now() - new Date(p.located_at)) > 24 * 3600 * 1000).length;

  return (
    <>
      <div className="page-head">
        <h2>Track &amp; Trace</h2>
        <div className="spacer" />
        <span className="small muted">
          {positioned.length} reporting · {moving} moving
          {stale > 0 && ` · ${stale} silent >24h`}
        </span>
        <button className="btn btn-ghost" onClick={() => fleet.refetch()}>Refresh</button>
      </div>
      <ErrorNote error={fleet.error} />

      {(conns.data || []).some((c) => c.status === 'error') && (
        <div className="error-note">
          An ELD connection is reporting an error:{' '}
          {(conns.data || []).filter((c) => c.status === 'error').map((c) => `${c.label} — ${c.last_error}`).join(' · ')}
          {' '}Fix it under Admin → Company &amp; Users → Integrations.
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <FleetMap trucks={positioned} onSelect={setSelected} />
      </div>

      {selected && (
        <div className="card card-pad" style={{ marginBottom: 16, borderLeft: '3px solid var(--tracking)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Truck {selected.unit_number}</h3>
            <span className="muted small">{selected.driver_name || 'No driver assigned'}</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {selected.address_text || `${selected.lat?.toFixed(4)}, ${selected.lng?.toFixed(4)}`} ·{' '}
            {Number(selected.speed_mph) || 0} mph · {selected.engine_state || '—'} · {ago(selected.located_at)}
          </div>
          {selected.load && (
            <div className="small" style={{ marginTop: 4 }}>
              On load #{selected.load.load_number} → {selected.load.delivery_location} (due {dt(selected.load.delivery_time)})
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <a className="btn btn-primary"
              href={`https://roadmark.app/?lat=${selected.lat}&lng=${selected.lng}&zoom=11&intent=breakdown`}
              target="_blank" rel="noopener noreferrer">Help driver — open Roadmark</a>
            <a className="btn btn-ghost"
              href={`https://www.google.com/maps?q=${selected.lat},${selected.lng}`}
              target="_blank" rel="noopener noreferrer">Open in Maps</a>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr><th>Truck</th><th>Driver</th><th>Position</th><th>Speed</th><th>Engine</th><th>On load</th><th>Last ping</th></tr></thead>
          <tbody>
            {positioned.map((r) => (
              <tr key={r.truck_id} onClick={() => setSelected(r)}>
                <td className="num" style={{ fontWeight: 700 }}>{r.unit_number || '—'}</td>
                <td>{r.driver_name || '—'}</td>
                <td className="small">{r.address_text || `${r.lat?.toFixed(3)}, ${r.lng?.toFixed(3)}`}</td>
                <td className="num">{Number(r.speed_mph) || 0} mph</td>
                <td>{r.engine_state || '—'}</td>
                <td className="num">{r.load ? `#${r.load.load_number}` : '—'}</td>
                <td className="small">{ago(r.located_at)}</td>
              </tr>
            ))}
            {silent.map((r) => (
              <tr key={r.truck_id} className="norow">
                <td className="num" style={{ fontWeight: 700 }}>{r.unit_number}</td>
                <td>{r.driver_name || '—'}</td>
                <td className="small muted">No ELD position</td>
                <td>—</td><td>—</td>
                <td className="num">{r.load ? `#${r.load.load_number}` : '—'}</td>
                <td><Chip value="pending" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {positioned.length === 0 && silent.length === 0 && (
          <Empty head="No trucks yet" sub="Add trucks under Fleet, then connect an ELD provider in Admin → Integrations." />
        )}
        {positioned.length === 0 && silent.length > 0 && (
          <div className="card-pad small muted">
            No live positions yet. Connect Samsara or Motive under Admin → Integrations and the
            map fills in within a couple of minutes.
          </div>
        )}
      </div>

      <DeptFeed dept="tracking" />
    </>
  );
}
