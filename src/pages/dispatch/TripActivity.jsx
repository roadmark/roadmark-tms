import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Empty, ErrorNote } from '../../components/ui';
import { money, d } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';

const GROUPS = [
  { id: 'driver', label: 'Driver' },
  { id: 'truck', label: 'Truck' },
  { id: 'trailer', label: 'Trailer' },
  { id: 'customer', label: 'Customer' },
  { id: 'dispatcher', label: 'Dispatcher' },
];

export default function TripActivity() {
  const { companyId } = useAuth();
  const now = new Date();
  const [start, setStart] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
  const [by, setBy] = useState('driver');
  const [expanded, setExpanded] = useState({});

  const q = useQuery({
    queryKey: ['trip-activity', companyId, start, end],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('loads')
        .select(`id, load_number, status, dispatcher_id, freight_amount, driver_rate,
                 loaded_miles, empty_miles, total_miles, pickup_time, delivery_time,
                 pickup_location, delivery_location,
                 driver:drivers!loads_driver_id_fkey(id, full_name),
                 truck:trucks(id, unit_number), trailer:trailers(id, unit_number),
                 customer:customers(id, name)`)
        .eq('company_id', companyId)
        .gte('pickup_time', `${start}T00:00:00`).lte('pickup_time', `${end}T23:59:59`)
        .not('status', 'in', '("cancelled")')
        .order('pickup_time', { ascending: false });
      if (error) throw error;

      const { data: members } = await supabase.from('company_members')
        .select('user_id, profiles(full_name, email)').eq('company_id', companyId);
      const nameOf = Object.fromEntries((members || [])
        .map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || '—']));
      return { loads: data, nameOf };
    },
  });

  const groups = useMemo(() => {
    const loads = q.data?.loads || [];
    const nameOf = q.data?.nameOf || {};
    const keyOf = (l) => {
      if (by === 'driver') return [l.driver?.id || 'none', l.driver?.full_name || 'Unassigned'];
      if (by === 'truck') return [l.truck?.id || 'none', l.truck?.unit_number || 'No truck'];
      if (by === 'trailer') return [l.trailer?.id || 'none', l.trailer?.unit_number || 'No trailer'];
      if (by === 'customer') return [l.customer?.id || 'none', l.customer?.name || 'No customer'];
      return [l.dispatcher_id || 'none', l.dispatcher_id ? nameOf[l.dispatcher_id] : 'No dispatcher'];
    };
    const m = new Map();
    for (const l of loads) {
      const [k, label] = keyOf(l);
      if (!m.has(k)) m.set(k, { k, label, loads: [] });
      m.get(k).loads.push(l);
    }
    return [...m.values()].map((g) => {
      const gross = g.loads.reduce((a, l) => a + Number(l.freight_amount || 0), 0);
      const pay = g.loads.reduce((a, l) => a + Number(l.driver_rate || 0), 0);
      const loaded = g.loads.reduce((a, l) => a + Number(l.loaded_miles || 0), 0);
      const empty = g.loads.reduce((a, l) => a + Number(l.empty_miles || 0), 0);
      const miles = loaded + empty;
      return { ...g, gross, pay, diff: gross - pay, loaded, empty, miles,
        rpm: miles ? gross / miles : 0, driverRpm: miles ? pay / miles : 0,
        deadhead: miles ? empty / miles * 100 : 0 };
    }).sort((a, b) => b.gross - a.gross);
  }, [q.data, by]);

  const t = groups.reduce((a, g) => ({
    gross: a.gross + g.gross, pay: a.pay + g.pay, miles: a.miles + g.miles,
    loaded: a.loaded + g.loaded, empty: a.empty + g.empty, n: a.n + g.loads.length,
  }), { gross: 0, pay: 0, miles: 0, loaded: 0, empty: 0, n: 0 });

  return (
    <>
      <div className="page-head">
        <h2>Trip activity</h2>
        <input type="date" className="company-switch" value={start} onChange={(e) => setStart(e.target.value)} />
        <input type="date" className="company-switch" value={end} onChange={(e) => setEnd(e.target.value)} />
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={() => downloadCsv(`trip_activity_${by}.csv`,
          groups.map((g) => ({
            [by]: g.label, loads: g.loads.length, gross: g.gross.toFixed(2),
            driver_pay: g.pay.toFixed(2), difference: g.diff.toFixed(2),
            loaded_miles: g.loaded, empty_miles: g.empty, total_miles: g.miles,
            rpm: g.rpm.toFixed(2), deadhead_pct: g.deadhead.toFixed(1),
          })))}>Export CSV</button>
      </div>

      <div className="filter-row">
        {GROUPS.map((g) => (
          <span key={g.id} className={`chip gray ${by === g.id ? 'on' : ''}`} onClick={() => setBy(g.id)}>
            by {g.label}
          </span>
        ))}
      </div>

      <ErrorNote error={q.error} />
      <div className="card">
        <div className="card-pad small muted" style={{ paddingBottom: 8 }}>
          {t.n} loads · gross <b className="num">{money(t.gross)}</b> ·
          driver pay <b className="num">{money(t.pay)}</b> ·
          difference <b className="num">{money(t.gross - t.pay)}</b> ·
          {Math.round(t.miles).toLocaleString()} mi ·
          avg <b className="num">${(t.miles ? t.gross / t.miles : 0).toFixed(2)}</b>/mi ·
          deadhead {(t.miles ? t.empty / t.miles * 100 : 0).toFixed(1)}%
        </div>
        <table className="data">
          <thead><tr>
            <th>{GROUPS.find((g) => g.id === by)?.label}</th><th>Loads</th>
            <th>Loaded</th><th>Empty</th><th>Total mi</th>
            <th>Gross</th><th>Driver pay</th><th>Difference</th><th>$/mi</th><th>Deadhead</th>
          </tr></thead>
          <tbody>
            {groups.map((g) => (
              <>
                <tr key={g.k} onClick={() => setExpanded((e) => ({ ...e, [g.k]: !e[g.k] }))}>
                  <td style={{ fontWeight: 600 }}>{expanded[g.k] ? '▾' : '▸'} {g.label}</td>
                  <td className="num">{g.loads.length}</td>
                  <td className="num">{g.loaded.toLocaleString()}</td>
                  <td className="num">{g.empty.toLocaleString()}</td>
                  <td className="num">{g.miles.toLocaleString()}</td>
                  <td className="num">{money(g.gross)}</td>
                  <td className="num">{money(g.pay)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(g.diff)}</td>
                  <td className="num">${g.rpm.toFixed(2)}</td>
                  <td className="num">{g.deadhead.toFixed(1)}%</td>
                </tr>
                {expanded[g.k] && g.loads.map((l) => (
                  <tr key={l.id} className="norow" style={{ background: '#fbfbf9' }}>
                    <td className="small" style={{ paddingLeft: 26 }}>
                      #{l.load_number} · {l.pickup_location} → {l.delivery_location}
                    </td>
                    <td className="small">{d(l.pickup_time)}</td>
                    <td className="num small">{l.loaded_miles}</td>
                    <td className="num small">{l.empty_miles}</td>
                    <td className="num small">{l.total_miles}</td>
                    <td className="num small">{money(l.freight_amount)}</td>
                    <td className="num small">{money(l.driver_rate)}</td>
                    <td className="num small">{money(Number(l.freight_amount) - Number(l.driver_rate))}</td>
                    <td className="num small">
                      {l.total_miles ? `$${(Number(l.freight_amount) / l.total_miles).toFixed(2)}` : '—'}
                    </td>
                    <td></td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && <Empty head="No activity in this period" sub="Adjust the dates above." />}
      </div>
    </>
  );
}
