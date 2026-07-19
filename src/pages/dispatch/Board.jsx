import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Empty, ErrorNote } from '../../components/ui';
import { money, dt } from '../../lib/format';

/** Sunday-ending week containing today */
function thisWeek() {
  const end = new Date();
  end.setDate(end.getDate() + (7 - end.getDay()) % 7);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const f = (x) => x.toISOString().slice(0, 10);
  return { start: f(start), end: f(end) };
}

export default function Board() {
  const { companyId } = useAuth();
  const w = thisWeek();
  const [start, setStart] = useState(w.start);
  const [end, setEnd] = useState(w.end);

  const data = useQuery({
    queryKey: ['board', companyId, start, end],
    enabled: !!companyId,
    queryFn: async () => {
      const { data: loads, error } = await supabase.from('loads')
        .select(`id, load_number, status, dispatcher_id, driver_id, freight_amount, driver_rate,
                 loaded_miles, empty_miles, total_miles, pickup_time, delivery_time,
                 pickup_location, delivery_location,
                 driver:drivers!loads_driver_id_fkey(full_name),
                 truck:trucks(unit_number), trailer:trailers(trailer_type),
                 customer:customers(name)`)
        .eq('company_id', companyId)
        .gte('pickup_time', `${start}T00:00:00`).lte('pickup_time', `${end}T23:59:59`)
        .order('pickup_time');
      if (error) throw error;

      const { data: members } = await supabase.from('company_members')
        .select('user_id, profiles(full_name, email)').eq('company_id', companyId);
      const nameOf = Object.fromEntries((members || [])
        .map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || 'Unassigned']));

      const groups = new Map();
      for (const l of loads) {
        const key = l.dispatcher_id || 'none';
        if (!groups.has(key)) groups.set(key, { key, name: l.dispatcher_id ? (nameOf[l.dispatcher_id] || 'Unknown') : 'No dispatcher', loads: [] });
        groups.get(key).loads.push(l);
      }
      return [...groups.values()].map((g) => {
        const live = g.loads.filter((l) => !['cancelled'].includes(l.status));
        const gross = live.reduce((a, l) => a + Number(l.freight_amount || 0), 0);
        const pay = live.reduce((a, l) => a + Number(l.driver_rate || 0), 0);
        const miles = live.reduce((a, l) => a + Number(l.total_miles || 0), 0);
        const loaded = live.reduce((a, l) => a + Number(l.loaded_miles || 0), 0);
        const drivers = new Set(live.map((l) => l.driver_id).filter(Boolean));
        const byTrailer = {};
        live.forEach((l) => {
          const t = l.trailer?.trailer_type || 'other';
          byTrailer[t] ||= { gross: 0, miles: 0, n: 0 };
          byTrailer[t].gross += Number(l.freight_amount || 0);
          byTrailer[t].miles += Number(l.total_miles || 0);
          byTrailer[t].n += 1;
        });
        return {
          ...g, gross, pay, margin: gross - pay, miles, loaded,
          drivers: drivers.size, count: live.length,
          rpm: miles ? gross / miles : 0,
          rpmLoaded: loaded ? gross / loaded : 0,
          mpl: live.length ? miles / live.length : 0,
          gpd: drivers.size ? gross / drivers.size : 0,
          mpd: drivers.size ? miles / drivers.size : 0,
          deadheadPct: miles ? (miles - loaded) / miles * 100 : 0,
          byTrailer,
        };
      }).sort((a, b) => b.gross - a.gross);
    },
  });

  const totals = useMemo(() => {
    const g = data.data || [];
    const gross = g.reduce((a, x) => a + x.gross, 0);
    const miles = g.reduce((a, x) => a + x.miles, 0);
    const pay = g.reduce((a, x) => a + x.pay, 0);
    return { gross, miles, pay, margin: gross - pay, rpm: miles ? gross / miles : 0,
      count: g.reduce((a, x) => a + x.count, 0) };
  }, [data.data]);

  return (
    <>
      <div className="page-head">
        <h2>Dispatch board</h2>
        <input type="date" className="company-switch" value={start} onChange={(e) => setStart(e.target.value)} />
        <input type="date" className="company-switch" value={end} onChange={(e) => setEnd(e.target.value)} />
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={() => { const n = thisWeek(); setStart(n.start); setEnd(n.end); }}>
          This week
        </button>
      </div>
      <ErrorNote error={data.error} />

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <Kpi label="Gross" v={money(totals.gross)} />
        <Kpi label="Margin after driver pay" v={money(totals.margin)} />
        <Kpi label="Total miles" v={Math.round(totals.miles).toLocaleString()} />
        <Kpi label="Rate per mile" v={`$${totals.rpm.toFixed(2)}`} />
      </div>

      {(data.data || []).map((g) => (
        <div className="card" key={g.key} style={{ marginBottom: 14 }}>
          <div className="card-pad" style={{ paddingBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16 }}>{g.name}</h3>
              <span className="small muted">{g.count} loads · {g.drivers} drivers covered</span>
              <div style={{ flex: 1 }} />
              <b className="num" style={{ fontSize: 17 }}>{money(g.gross)}</b>
            </div>
            <div className="grid cols-4" style={{ marginTop: 10, gap: 10 }}>
              <Mini label="RPM (total)" v={`$${g.rpm.toFixed(2)}`} />
              <Mini label="RPM (loaded)" v={`$${g.rpmLoaded.toFixed(2)}`} />
              <Mini label="Miles / load" v={Math.round(g.mpl).toLocaleString()} />
              <Mini label="Deadhead" v={`${g.deadheadPct.toFixed(1)}%`} />
              <Mini label="Gross / driver" v={money(g.gpd)} />
              <Mini label="Miles / driver" v={Math.round(g.mpd).toLocaleString()} />
              <Mini label="Driver pay" v={money(g.pay)} />
              <Mini label="Margin" v={money(g.margin)} />
            </div>
            {Object.keys(g.byTrailer).length > 1 && (
              <div className="small muted" style={{ marginTop: 8 }}>
                By equipment:{' '}
                {Object.entries(g.byTrailer).map(([t, v]) =>
                  `${t.replace('_', ' ')} ${v.n} @ $${(v.miles ? v.gross / v.miles : 0).toFixed(2)}/mi`).join(' · ')}
              </div>
            )}
          </div>
          <table className="data">
            <thead><tr>
              <th>#</th><th>Status</th><th>Driver</th><th>Truck</th><th>Customer</th>
              <th>Route</th><th>Miles</th><th>Rate</th><th>$/mi</th>
            </tr></thead>
            <tbody>
              {g.loads.map((l) => (
                <tr key={l.id} className="norow">
                  <td className="num">{l.load_number}</td>
                  <td><Chip value={l.status} /></td>
                  <td>{l.driver?.full_name || '—'}</td>
                  <td className="num">{l.truck?.unit_number || '—'}</td>
                  <td className="small">{l.customer?.name || '—'}</td>
                  <td className="small">
                    {l.pickup_location} → {l.delivery_location}
                    <div className="muted">{dt(l.pickup_time)}</div>
                  </td>
                  <td className="num">{l.total_miles}</td>
                  <td className="num">{money(l.freight_amount)}</td>
                  <td className="num">
                    {l.total_miles ? `$${(Number(l.freight_amount) / l.total_miles).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {data.data?.length === 0 && (
        <div className="card">
          <Empty head="No loads in this period"
            sub="Pick a different date range, or create loads and assign a dispatcher to see the board fill in." />
        </div>
      )}
    </>
  );
}

function Kpi({ label, v }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num" style={{ fontSize: 26 }}>{v}</div>
    </div>
  );
}
function Mini({ label, v }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 10px' }}>
      <div className="label" style={{ fontSize: 11 }}>{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>{v}</div>
    </div>
  );
}
