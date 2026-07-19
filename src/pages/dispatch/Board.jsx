import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Empty, ErrorNote } from '../../components/ui';
import { money, dt, d, title } from '../../lib/format';
import { LOAD_STATUSES } from '../../data/enums';

const DAY = 86400000;
const startOfDay = (x) => { const t = new Date(x); t.setHours(0, 0, 0, 0); return t; };
const addDays = (x, n) => new Date(startOfDay(x).getTime() + n * DAY);
const fmtDay = (x) => x.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() + ' ' + x.getDate();

/* bar colour by load status, in the Roadmark palette */
const BAR = {
  in_progress:     { bg: 'var(--info-soft)',   line: 'var(--info)' },
  scheduled:       { bg: 'var(--accent-soft)', line: 'var(--accent)' },
  delivered:       { bg: 'var(--ok-soft)',     line: 'var(--ok)' },
  invoiced:        { bg: 'var(--ok-soft)',     line: 'var(--ok)' },
  payment_pending: { bg: 'var(--warn-soft)',   line: 'var(--warn)' },
  completed:       { bg: 'var(--ok-soft)',     line: 'var(--ok)' },
  cancelled:       { bg: 'var(--neutral-soft)', line: 'var(--text-3)' },
  tonu:            { bg: 'var(--danger-soft)', line: 'var(--danger)' },
};
const stateOf = (loc) => (loc || '').split(',').pop()?.trim().slice(0, 2).toUpperCase() || '—';
const cityOf = (loc) => (loc || '').split(',')[0]?.trim() || '';

export default function Board() {
  const { companyId } = useAuth();
  const [days, setDays] = useState(7);
  const [anchor, setAnchor] = useState(() => addDays(new Date(), -2));
  const [q, setQ] = useState('');
  const [fDispatcher, setFDispatcher] = useState('');
  const [fDriverType, setFDriverType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [peek, setPeek] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [copied, setCopied] = useState(null);

  const rangeStart = startOfDay(anchor);
  const rangeEnd = addDays(rangeStart, days);
  const dayCols = Array.from({ length: days }, (_, i) => addDays(rangeStart, i));

  const data = useQuery({
    queryKey: ['board', companyId, rangeStart.toISOString(), days],
    enabled: !!companyId,
    queryFn: async () => {
      const [driversRes, loadsRes, membersRes, assignRes] = await Promise.all([
        supabase.from('drivers')
          .select('id, full_name, email, phone, status, driver_type, dispatcher_id')
          .eq('company_id', companyId).in('status', ['active', 'ready']).order('full_name'),
        supabase.from('loads')
          .select(`id, load_number, status, customer_load_id, driver_id, dispatcher_id,
                   pickup_time, delivery_time, pickup_location, delivery_location,
                   loaded_miles, empty_miles, total_miles, freight_amount, driver_rate,
                   weight_lbs, notes, customer:customers(name),
                   truck:trucks(unit_number, truck_type), trailer:trailers(unit_number, trailer_type)`)
          .eq('company_id', companyId)
          .lt('pickup_time', rangeEnd.toISOString())
          .gt('delivery_time', rangeStart.toISOString()),
        supabase.from('company_members')
          .select('user_id, profiles(full_name, email)').eq('company_id', companyId),
        supabase.from('assignments')
          .select('driver_id, truck:trucks(unit_number, truck_type), trailer:trailers(unit_number, trailer_type)')
          .eq('company_id', companyId).is('ended_at', null),
      ]);
      for (const r of [driversRes, loadsRes, membersRes, assignRes]) if (r.error) throw r.error;

      const nameOf = Object.fromEntries((membersRes.data || [])
        .map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email?.split('@')[0] || 'user']));
      const rigOf = Object.fromEntries((assignRes.data || []).map((a) => [a.driver_id, a]));
      return { drivers: driversRes.data, loads: loadsRes.data, nameOf, rigOf };
    },
  });

  const rows = useMemo(() => {
    if (!data.data) return [];
    const { drivers, loads, nameOf, rigOf } = data.data;
    const term = q.trim().toLowerCase();

    const byDriver = new Map();
    for (const l of loads) {
      if (fStatus && l.status !== fStatus) continue;
      if (!l.driver_id) continue;
      if (!byDriver.has(l.driver_id)) byDriver.set(l.driver_id, []);
      byDriver.get(l.driver_id).push(l);
    }

    return drivers
      .filter((dr) => !fDispatcher || dr.dispatcher_id === fDispatcher)
      .filter((dr) => !fDriverType || dr.driver_type === fDriverType)
      .filter((dr) => {
        if (!term) return true;
        const rig = rigOf[dr.id];
        return [dr.full_name, dr.email, dr.phone, rig?.truck?.unit_number, rig?.trailer?.unit_number]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
      })
      .map((dr) => {
        const list = (byDriver.get(dr.id) || [])
          .sort((a, b) => new Date(a.pickup_time) - new Date(b.pickup_time));

        // lay the bars out in lanes so overlaps stack instead of colliding
        const lanes = [];
        const placed = list.map((l) => {
          const s = Math.max(0, Math.floor((startOfDay(l.pickup_time) - rangeStart) / DAY));
          const e = Math.min(days - 1, Math.floor((startOfDay(l.delivery_time) - rangeStart) / DAY));
          const span = Math.max(1, e - s + 1);
          let lane = lanes.findIndex((end) => end < s);
          if (lane === -1) { lanes.push(s + span - 1); lane = lanes.length - 1; }
          else lanes[lane] = s + span - 1;
          return { load: l, col: s + 1, span, lane };
        });

        const gross = list.reduce((a, l) => a + Number(l.freight_amount || 0), 0);
        const pay = list.reduce((a, l) => a + Number(l.driver_rate || 0), 0);
        const miles = list.reduce((a, l) => a + Number(l.total_miles || 0), 0);
        return {
          driver: dr, rig: rigOf[dr.id], dispatcher: nameOf[dr.dispatcher_id],
          placed, loads: list, lanes: Math.max(1, lanes.length),
          gross, pay, miles, rpm: miles ? gross / miles : 0,
        };
      });
  }, [data.data, q, fDispatcher, fDriverType, fStatus, rangeStart, days]);

  const totals = useMemo(() => {
    const all = rows.flatMap((r) => r.loads);
    const gross = all.reduce((a, l) => a + Number(l.freight_amount || 0), 0);
    const pay = all.reduce((a, l) => a + Number(l.driver_rate || 0), 0);
    const loaded = all.reduce((a, l) => a + Number(l.loaded_miles || 0), 0);
    const empty = all.reduce((a, l) => a + Number(l.empty_miles || 0), 0);
    const miles = loaded + empty;
    const covered = rows.filter((r) => r.loads.length).length;
    const byType = {};
    for (const l of all) {
      const t = l.trailer?.trailer_type || 'other';
      byType[t] ||= { gross: 0, miles: 0 };
      byType[t].gross += Number(l.freight_amount || 0);
      byType[t].miles += Number(l.total_miles || 0);
    }
    return {
      drivers: rows.length, covered, loads: all.length,
      dispatchers: new Set(rows.map((r) => r.driver.dispatcher_id).filter(Boolean)).size,
      gross, pay, diff: gross - pay,
      pct: gross ? (pay / gross) * 100 : 0,
      miles, loaded, empty,
      rpm: miles ? gross / miles : 0,
      rpmLoaded: loaded ? gross / loaded : 0,
      mpl: all.length ? miles / all.length : 0,
      gpd: covered ? gross / covered : 0,
      mpd: covered ? miles / covered : 0,
      byType,
    };
  }, [rows]);

  const dispatchers = useMemo(() => {
    const m = data.data?.nameOf || {};
    const ids = new Set((data.data?.drivers || []).map((x) => x.dispatcher_id).filter(Boolean));
    return [...ids].map((id) => ({ id, name: m[id] || 'user' }));
  }, [data.data]);

  const copyDriver = (r) => {
    const txt = [r.driver.full_name, r.driver.email, r.driver.phone,
      r.rig?.truck?.unit_number && `Truck ${r.rig.truck.unit_number}`,
      r.rig?.trailer?.unit_number && `Trailer ${r.rig.trailer.unit_number}`]
      .filter(Boolean).join('\n');
    navigator.clipboard?.writeText(txt);
    setCopied(r.driver.id);
    setTimeout(() => setCopied(null), 1400);
  };

  // grid template shared by the header and every row
  const gridCols = `300px repeat(${days}, minmax(132px, 1fr)) 120px`;
  const now = new Date();
  const nowOffset = now >= rangeStart && now < rangeEnd
    ? ((now - rangeStart) / DAY) : null;

  return (
    <>
      {/* ---------- KPI strip ---------- */}
      <div className="board-kpis">
        <div className="kpi-box">
          <Line l="Total drivers" v={totals.drivers} />
          <Line l="Covered drivers" v={totals.covered} tone="var(--ok)" />
          <Line l="Total loads" v={totals.loads} />
          <Line l="Dispatchers" v={totals.dispatchers} />
        </div>
        <div className="kpi-box">
          <Line l="Gross" v={money(totals.gross)} />
          <Line l="Driver pay" v={`${money(totals.pay)} (${totals.pct.toFixed(2)}%)`} />
          <Line l="Difference" v={money(totals.diff)} tone="var(--ok)" />
        </div>
        <div className="kpi-box">
          <Line l="Total miles" v={Math.round(totals.miles).toLocaleString() + 'mi'} />
          <Line l="Empty miles" v={Math.round(totals.empty).toLocaleString() + 'mi'} />
          <Line l="Loaded miles" v={Math.round(totals.loaded).toLocaleString() + 'mi'} />
        </div>
        <div className="kpi-box">
          <Line l="RPM" v={`$${totals.rpm.toFixed(2)}/mi ($${totals.rpmLoaded.toFixed(2)} loaded)`} />
          <Line l="MPL" v={Math.round(totals.mpl).toLocaleString() + 'mi'} />
          <Line l="GPD" v={money(totals.gpd)} />
          <Line l="MPD" v={Math.round(totals.mpd).toLocaleString() + 'mi'} />
        </div>
        <div className="kpi-box">
          {Object.entries(totals.byType).length === 0 && <Line l="Equipment" v="—" />}
          {Object.entries(totals.byType).map(([t, v]) => (
            <Line key={t} l={title(t)}
              v={`$${(v.miles ? v.gross / v.miles : 0).toFixed(2)}/mi (${totals.gross ? (v.gross / totals.gross * 100).toFixed(1) : 0}%)`} />
          ))}
        </div>
      </div>

      {/* ---------- filters ---------- */}
      <div className="filter-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver, truck, trailer…"
          style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid var(--line)',
            background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, width: 240 }} />
        <select className="company-switch" value={fDispatcher} onChange={(e) => setFDispatcher(e.target.value)}>
          <option value="">All dispatchers</option>
          {dispatchers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select className="company-switch" value={fDriverType} onChange={(e) => setFDriverType(e.target.value)}>
          <option value="">All driver types</option>
          {['company', 'owner', 'rent', 'lease_to_buy', 'contractor'].map((x) =>
            <option key={x} value={x}>{title(x)}</option>)}
        </select>
        <select className="company-switch" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All load statuses</option>
          {LOAD_STATUSES.map((x) => <option key={x} value={x}>{title(x)}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <div className="seg">
          {[5, 7, 10, 14].map((n) => (
            <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n}d</button>
          ))}
        </div>
      </div>

      <ErrorNote error={data.error} />

      {/* ---------- week nav ---------- */}
      <div className="board-nav">
        <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, -days))}>‹‹</button>
        <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, -1))}>‹</button>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>
          {d(rangeStart)} – {d(addDays(rangeStart, days - 1))}
        </b>
        <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, 1))}>›</button>
        <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, days))}>››</button>
        <button className="btn btn-ghost" onClick={() => setAnchor(addDays(new Date(), -2))}>Today</button>
        <div style={{ flex: 1 }} />
        <span className="small muted">{rows.length} drivers · {totals.loads} loads in view</span>
      </div>

      {/* ---------- the board ---------- */}
      <div className="board-scroll">
        <div className="board-head" style={{ gridTemplateColumns: gridCols }}>
          <div className="board-cell-head">Driver</div>
          {dayCols.map((x, i) => {
            const isToday = startOfDay(new Date()).getTime() === x.getTime();
            const weekend = [0, 6].includes(x.getDay());
            return (
              <div key={i} className={`board-cell-head day ${isToday ? 'today' : ''} ${weekend ? 'weekend' : ''}`}>
                {fmtDay(x)}
              </div>
            );
          })}
          <div className="board-cell-head">Notes</div>
        </div>

        <div className="board-body" style={{ position: 'relative' }}>
          {nowOffset !== null && (
            <div className="now-line" style={{
              left: `calc(300px + (100% - 420px) * ${nowOffset / days})`,
            }} />
          )}

          {rows.map((r) => (
            <div key={r.driver.id} className="board-row" style={{ gridTemplateColumns: gridCols }}>
              {/* driver cell */}
              <div className="driver-cell">
                <div className="dc-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dc-name">{r.driver.full_name}</div>
                    <div className="dc-email">{r.driver.email}</div>
                  </div>
                  <button className="icon-btn dc-copy" title="Copy driver details"
                    onClick={() => copyDriver(r)}>{copied === r.driver.id ? '✓' : '⧉'}</button>
                </div>
                <div className="dc-grid">
                  <div className="dc-info">
                    <div className="dc-line"><span className="chip green nodot">{title(r.driver.status)}</span></div>
                    <div className="dc-line dc-type">{title(r.driver.driver_type)}</div>
                    <div className="dc-line">{r.driver.phone || '—'}</div>
                    <div className="dc-line muted">{r.dispatcher || 'No dispatcher'}</div>
                    <div className="dc-line">
                      <b>{r.rig?.truck?.unit_number || '—'}</b>
                      <span className="muted small"> {r.rig?.truck?.truck_type ? title(r.rig.truck.truck_type) : ''}</span>
                    </div>
                    <div className="dc-line">
                      <b>{r.rig?.trailer?.unit_number || '—'}</b>
                      <span className="muted small"> {r.rig?.trailer?.trailer_type ? title(r.rig.trailer.trailer_type) : ''}</span>
                    </div>
                  </div>
                  <div className="dc-stats">
                    <Stat l="Gross" v={money(r.gross)} />
                    <Stat l="Driver rate" v={money(r.pay)} />
                    <Stat l="Total miles" v={Math.round(r.miles).toLocaleString() + 'mi'} />
                    <Stat l="RPM" v={`$${r.rpm.toFixed(2)}`} />
                  </div>
                </div>
                <button className="dc-expand" onClick={() =>
                  setExpanded((e) => ({ ...e, [r.driver.id]: !e[r.driver.id] }))}>
                  {expanded[r.driver.id] ? '▴ less' : '▾ all loads'}
                </button>
                {expanded[r.driver.id] && (
                  <div className="dc-loads">
                    {r.loads.map((l) => (
                      <div key={l.id} className="dc-load" onClick={() => setPeek(l)}>
                        <b>#{l.load_number}</b> {l.pickup_location} → {l.delivery_location}
                        <div className="muted">{money(l.freight_amount)} · {l.total_miles}mi · {title(l.status)}</div>
                      </div>
                    ))}
                    {r.loads.length === 0 && <div className="muted small">No loads in this range</div>}
                  </div>
                )}
              </div>

              {/* timeline lanes */}
              <div className="lane-area" style={{
                gridColumn: `2 / span ${days}`,
                gridTemplateColumns: `repeat(${days}, minmax(132px, 1fr))`,
                gridTemplateRows: `repeat(${r.lanes}, auto)`,
              }}>
                {dayCols.map((x, i) => (
                  <div key={'g' + i} className={`lane-grid ${[0, 6].includes(x.getDay()) ? 'weekend' : ''}`}
                    style={{ gridColumn: i + 1, gridRow: `1 / span ${r.lanes}` }} />
                ))}
                {r.placed.map(({ load: l, col, span, lane }) => {
                  const c = BAR[l.status] || BAR.scheduled;
                  const rpm = l.total_miles ? Number(l.freight_amount) / l.total_miles : 0;
                  const diff = Number(l.freight_amount || 0) - Number(l.driver_rate || 0);
                  return (
                    <div key={l.id} className="load-bar"
                      style={{ gridColumn: `${col} / span ${span}`, gridRow: lane + 1,
                        background: c.bg, borderColor: c.line }}
                      onClick={() => setPeek(l)}>
                      <div className="lb-top">
                        <b className="lb-num">#{l.load_number}</b>
                        <span className="lb-ref">{l.customer_load_id}</span>
                        <div style={{ flex: 1 }} />
                        <span className="lb-dot" style={{ background: c.line }} />
                      </div>
                      <div className="lb-route">
                        <div className="lb-end">
                          <b>{stateOf(l.pickup_location)}</b>
                          <span>{cityOf(l.pickup_location)}</span>
                        </div>
                        <div className="lb-line" style={{ background: c.line }}>
                          <span className="lb-cap" style={{ background: c.line }} />
                          <span className="lb-cap right" style={{ background: c.line }} />
                        </div>
                        <div className="lb-end right">
                          <b>{stateOf(l.delivery_location)}</b>
                          <span>{cityOf(l.delivery_location)}</span>
                        </div>
                      </div>
                      <div className="lb-foot">
                        <span className="lb-tag">{l.empty_miles}mi</span>
                        <span className="lb-tag">{Number(l.loaded_miles).toLocaleString()}mi</span>
                        <div style={{ flex: 1 }} />
                        {l.weight_lbs && <span className="lb-tag red">{Number(l.weight_lbs).toLocaleString()} lbs</span>}
                      </div>
                      <div className="lb-foot">
                        <span className="lb-tag strong">{money(l.freight_amount)}</span>
                        <span className="lb-tag green">{money(diff)}</span>
                        <div style={{ flex: 1 }} />
                        <span className="lb-tag amber">{rpm.toFixed(2)}$/mi</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* notes column */}
              <div className="notes-cell">
                {r.loads.map((l) => (
                  <div key={l.id} className="note-num" onClick={() => setPeek(l)}>
                    #{l.load_number}
                    {l.notes ? <span className="muted small"> · {l.notes.slice(0, 22)}</span> : ''}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {rows.length === 0 && (
            <div className="card"><Empty head="No drivers match"
              sub="Adjust the filters, move the date range, or assign drivers to trucks under Fleet → Assignments." /></div>
          )}
        </div>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        Times shown in your local timezone. Click a load bar for details, or the ⧉ on a driver to copy their contact block.
      </div>

      {peek && <LoadPeek load={peek} onClose={() => setPeek(null)} />}
    </>
  );
}

function Line({ l, v, tone }) {
  return (
    <div className="kpi-line">
      <span>{l}</span><div style={{ flex: 1 }} />
      <b style={{ color: tone }}>{v}</b>
    </div>
  );
}
function Stat({ l, v }) {
  return (
    <div className="dc-stat">
      <div className="dc-stat-l">{l}</div>
      <div className="dc-stat-v num">{v}</div>
    </div>
  );
}

function LoadPeek({ load: l, onClose }) {
  const rpm = l.total_miles ? Number(l.freight_amount) / l.total_miles : 0;
  return (
    <Drawer title={`Load #${l.load_number}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <div style={{ flex: 1 }} />
        <a className="btn btn-primary" href="/dispatch/loads">Open in Loads</a>
      </>}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Chip value={l.status} />
        <span className="small muted">{l.customer?.name} · {l.customer_load_id}</span>
      </div>
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800 }}>
              {stateOf(l.pickup_location)}
            </div>
            <div className="small muted">{cityOf(l.pickup_location)}</div>
            <div className="small muted">{dt(l.pickup_time)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800 }}>
              {stateOf(l.delivery_location)}
            </div>
            <div className="small muted">{cityOf(l.delivery_location)}</div>
            <div className="small muted">{dt(l.delivery_time)}</div>
          </div>
        </div>
      </div>
      <div className="grid cols-2" style={{ gap: 8 }}>
        <Info l="Freight" v={money(l.freight_amount)} />
        <Info l="Driver rate" v={money(l.driver_rate)} />
        <Info l="Difference" v={money(Number(l.freight_amount) - Number(l.driver_rate))} />
        <Info l="Rate per mile" v={`$${rpm.toFixed(2)}`} />
        <Info l="Loaded miles" v={Number(l.loaded_miles).toLocaleString()} />
        <Info l="Empty miles" v={Number(l.empty_miles).toLocaleString()} />
        <Info l="Weight" v={l.weight_lbs ? Number(l.weight_lbs).toLocaleString() + ' lbs' : '—'} />
        <Info l="Truck / trailer" v={`${l.truck?.unit_number || '—'} / ${l.trailer?.unit_number || '—'}`} />
      </div>
      {l.notes && (
        <>
          <div className="nav-section" style={{ padding: '14px 0 4px' }}>Notes</div>
          <div className="small">{l.notes}</div>
        </>
      )}
    </Drawer>
  );
}
function Info({ l, v }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px' }}>
      <div className="dc-stat-l">{l}</div>
      <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>{v}</div>
    </div>
  );
}
