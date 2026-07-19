import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Empty, ErrorNote } from '../../components/ui';
import { ago } from '../../lib/format';
import DeptFeed from '../../components/DeptFeed';

export default function TrackTrace() {
  const { companyId } = useAuth();
  const locations = useQuery({
    queryKey: ['locations', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_unit_latest_location')
        .select('*').eq('company_id', companyId);
      if (error) throw error;
      if (!data.length) return [];
      const ids = data.map((r) => r.truck_id);
      const { data: trucks, error: e2 } = await supabase.from('trucks')
        .select('id, unit_number').in('id', ids);
      if (e2) throw e2;
      const byId = Object.fromEntries(trucks.map((t) => [t.id, t.unit_number]));
      return data.map((r) => ({ ...r, unit_number: byId[r.truck_id] }));
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>Track &amp; Trace</h2>
        <div className="spacer" />
        <span className="small muted">Live map + ELD sync connect in Phase 10</span>
      </div>
      <ErrorNote error={locations.error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr><th>Truck</th><th>Last position</th><th>Speed</th><th>Engine</th><th>Source</th><th>Updated</th></tr></thead>
          <tbody>
            {(locations.data || []).map((r) => (
              <tr key={r.truck_id} className="norow">
                <td className="num" style={{ fontWeight: 700 }}>{r.unit_number}</td>
                <td>{r.address_text || `${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}`}</td>
                <td className="num">{r.speed_mph != null ? `${r.speed_mph} mph` : '—'}</td>
                <td>{r.engine_state || '—'}</td>
                <td>{r.provider || r.source}</td>
                <td>{ago(r.located_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {locations.data?.length === 0 && (
          <Empty head="No ELD positions yet"
            sub="Connect Samsara / Motive tokens (build plan, Phase 10) and trucks appear here and on the live map, refreshed every 2 minutes." />
        )}
      </div>
      <DeptFeed dept="tracking" />
    </>
  );
}
