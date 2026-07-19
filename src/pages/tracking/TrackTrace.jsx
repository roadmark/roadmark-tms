import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { ago, dt, title } from '../../lib/format';
import FleetMap, { PLACE_STYLE } from '../../components/FleetMap';
import DeptFeed from '../../components/DeptFeed';

const DIRECTORY = ['repair_shop', 'mobile_repair', 'dealer', 'tire_shop', 'towing', 'truck_stop', 'parking', 'weigh_station'];
const OURS = ['yard', 'customer_facility', 'dropped_trailer', 'dropped_truck', 'hazard', 'other'];

export default function LiveMap() {
  const { companyId, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [place, setPlace] = useState(null);
  const [dropMode, setDropMode] = useState(false);
  const [newPin, setNewPin] = useState(null);
  const [layers, setLayers] = useState({ trucks: true, directory: true, ours: true, preferredOnly: false });
  const [syncMsg, setSyncMsg] = useState(null);

  const fleet = useQuery({
    queryKey: ['fleet-positions', companyId],
    enabled: !!companyId,
    refetchInterval: 60_000,
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
      const driverOf = Object.fromEntries((assigns || []).filter((a) => a.truck_id).map((a) => [a.truck_id, a.driver?.full_name]));
      const loadOf = Object.fromEntries((loads || []).filter((l) => l.truck_id).map((l) => [l.truck_id, l]));
      const positioned = (locs || []).map((r) => ({
        ...r, unit_number: truckById[r.truck_id]?.unit_number,
        driver_name: driverOf[r.truck_id], load: loadOf[r.truck_id],
      }));
      const seen = new Set(positioned.map((p) => p.truck_id));
      const silent = (trucks || []).filter((t) => !seen.has(t.id))
        .map((t) => ({ truck_id: t.id, unit_number: t.unit_number, status: t.status,
          driver_name: driverOf[t.id], load: loadOf[t.id] }));
      return { positioned, silent };
    },
  });

  const places = useQuery({
    queryKey: ['map-places', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('map_places')
        .select('*').or(`company_id.is.null,company_id.eq.${companyId}`)
        .neq('status', 'archived').limit(6000);
      if (error) throw error;
      return data;
    },
  });

  const syncState = useQuery({
    queryKey: ['map-sync-state'],
    queryFn: async () => {
      const { data } = await supabase.from('map_sync_state').select('*').eq('source', 'roadmark').maybeSingle();
      return data;
    },
  });

  const runSync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('map-sync', { body: {} });
      if (error) throw new Error(error.message || 'map-sync failed — is it deployed?');
      return data;
    },
    onSuccess: (d) => { setSyncMsg(JSON.stringify(d)); qc.invalidateQueries(); },
    onError: (e) => setSyncMsg(e.message),
  });

  const shown = useMemo(() => {
    let list = places.data || [];
    list = list.filter((p) => {
      const isOurs = !!p.company_id;
      if (isOurs && !layers.ours) return false;
      if (!isOurs && !layers.directory) return false;
      if (!isOurs && layers.preferredOnly && !p.preferred) return false;
      if (p.blacklisted && !layers.ours) return false;
      return true;
    });
    return list;
  }, [places.data, layers]);

  const positioned = fleet.data?.positioned || [];
  const silent = fleet.data?.silent || [];
  const moving = positioned.filter((p) => Number(p.speed_mph) > 5).length;
  const ourPins = (places.data || []).filter((p) => p.company_id);

  return (
    <>
      <div className="page-head">
        <h2>Live map</h2>
        <div className="spacer" />
        <span className="small muted">
          {positioned.length} trucks reporting · {moving} moving · {(places.data || []).length} pins
        </span>
        <button className={`btn ${dropMode ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setDropMode((v) => !v)}>
          {dropMode ? '✛ Click the map…' : '+ Drop a pin'}
        </button>
        <button className="btn btn-ghost" onClick={() => fleet.refetch()}>Refresh</button>
      </div>

      <div className="filter-row">
        <Toggle on={layers.trucks} set={(v) => setLayers((l) => ({ ...l, trucks: v }))} label="Trucks" />
        <Toggle on={layers.directory} set={(v) => setLayers((l) => ({ ...l, directory: v }))} label="Roadmark directory" />
        <Toggle on={layers.ours} set={(v) => setLayers((l) => ({ ...l, ours: v }))} label="Our pins" />
        <Toggle on={layers.preferredOnly} set={(v) => setLayers((l) => ({ ...l, preferredOnly: v }))} label="Preferred only" />
        <div style={{ flex: 1 }} />
        <span className="small muted">
          Directory synced {syncState.data?.last_synced_at ? ago(syncState.data.last_synced_at) : 'never'}
        </span>
        {isAdmin() && (
          <button className="btn btn-ghost" disabled={runSync.isPending} onClick={() => runSync.mutate()}>
            {runSync.isPending ? 'Syncing…' : 'Sync Roadmark'}
          </button>
        )}
      </div>
      {syncMsg && <div className="card card-pad small" style={{ marginBottom: 10 }}>{syncMsg}</div>}
      {syncState.data?.last_error && (
        <div className="error-note">Last sync error: {syncState.data.last_error}</div>
      )}
      <ErrorNote error={fleet.error || places.error} />

      <div style={{ marginBottom: 14 }}>
        <FleetMap
          trucks={layers.trucks ? positioned : []}
          places={shown}
          onSelectTruck={setSelected}
          onSelectPlace={setPlace}
          dropMode={dropMode}
          onDropPin={(coords) => { setNewPin(coords); setDropMode(false); }}
        />
      </div>

      <div className="filter-row" style={{ marginBottom: 16 }}>
        {[...DIRECTORY, ...OURS].map((k) => {
          const st = PLACE_STYLE[k];
          const n = (places.data || []).filter((p) => p.kind === k).length;
          if (!n) return null;
          return (
            <span key={k} className="chip gray nodot" style={{ gap: 6 }}>
              <span>{st.icon}</span>{st.label} <b>{n}</b>
            </span>
          );
        })}
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
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn btn-primary"
              href={`https://roadmark.app/?lat=${selected.lat}&lng=${selected.lng}&zoom=11&intent=breakdown`}
              target="_blank" rel="noopener noreferrer">Help driver — open Roadmark</a>
            <a className="btn btn-ghost"
              href={`https://www.google.com/maps?q=${selected.lat},${selected.lng}`}
              target="_blank" rel="noopener noreferrer">Open in Maps</a>
            <button className="btn btn-ghost"
              onClick={() => setNewPin({ lat: selected.lat, lng: selected.lng, truck_id: selected.truck_id })}>
              Drop a pin here
            </button>
          </div>
        </div>
      )}

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 4 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>Fleet</h3>
          </div>
          <table className="data">
            <thead><tr><th>Truck</th><th>Driver</th><th>Position</th><th>Speed</th><th>Last ping</th></tr></thead>
            <tbody>
              {positioned.map((r) => (
                <tr key={r.truck_id} onClick={() => setSelected(r)}>
                  <td className="num" style={{ fontWeight: 700 }}>{r.unit_number || '—'}</td>
                  <td className="small">{r.driver_name || '—'}</td>
                  <td className="small">{r.address_text || `${r.lat?.toFixed(2)}, ${r.lng?.toFixed(2)}`}</td>
                  <td className="num">{Number(r.speed_mph) || 0}</td>
                  <td className="small">{ago(r.located_at)}</td>
                </tr>
              ))}
              {silent.map((r) => (
                <tr key={r.truck_id} className="norow">
                  <td className="num" style={{ fontWeight: 700 }}>{r.unit_number}</td>
                  <td className="small">{r.driver_name || '—'}</td>
                  <td className="small muted" colSpan={2}>No ELD position</td>
                  <td><Chip value="pending" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {positioned.length === 0 && silent.length === 0 && <Empty head="No trucks yet" sub="Add trucks under Fleet." />}
        </div>

        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 4, display: 'flex', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>Our pins</h3>
            <div style={{ flex: 1 }} />
            <span className="small muted">{ourPins.length}</span>
          </div>
          <table className="data">
            <thead><tr><th>Pin</th><th>Kind</th><th>Where</th><th>Added</th></tr></thead>
            <tbody>
              {ourPins.map((p) => (
                <tr key={p.id} onClick={() => setPlace(p)}>
                  <td style={{ fontWeight: 600 }}>
                    {PLACE_STYLE[p.kind]?.icon} {p.name}
                    {p.share_to_roadmark && <span className="chip amber nodot" style={{ marginLeft: 6 }}>shared</span>}
                  </td>
                  <td className="small">{PLACE_STYLE[p.kind]?.label}</td>
                  <td className="small">{[p.city, p.state].filter(Boolean).join(', ') || `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`}</td>
                  <td className="small">{ago(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ourPins.length === 0 && (
            <Empty head="No pins of your own yet"
              sub='Click "Drop a pin" and then the map — mark a dropped trailer, your yard, or a shop your drivers rate.' />
          )}
        </div>
      </div>

      <DeptFeed dept="tracking" />

      {newPin && <PinDrawer coords={newPin} onClose={() => setNewPin(null)}
        onSaved={() => { setNewPin(null); qc.invalidateQueries({ queryKey: ['map-places'] }); }} />}
      {place && <PlaceDrawer place={place} onClose={() => setPlace(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ['map-places'] })} />}
    </>
  );
}

function Toggle({ on, set, label }) {
  return (
    <span className={`chip ${on ? 'amber' : 'gray'}`} style={{ cursor: 'pointer' }}
      onClick={() => set(!on)}>{label}</span>
  );
}

/* ---------------- drop a pin ---------------- */

function PinDrawer({ coords, onClose, onSaved }) {
  const { companyId, user } = useAuth();
  const [f, setF] = useState({
    kind: 'dropped_trailer', name: '', note: '', trailer_id: '', truck_id: coords.truck_id || '',
    load_id: '', expected_until: '', share_to_roadmark: false,
    address: '', city: '', state: '', phone: '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const opts = useQuery({
    queryKey: ['pin-options', companyId],
    queryFn: async () => {
      const [t, tr] = await Promise.all([
        supabase.from('trucks').select('id, unit_number').eq('company_id', companyId).order('unit_number'),
        supabase.from('trailers').select('id, unit_number').eq('company_id', companyId).order('unit_number'),
      ]);
      return { trucks: t.data || [], trailers: tr.data || [] };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error('Give the pin a name.');
      const { error } = await supabase.from('map_places').insert({
        company_id: companyId, source: 'tms', kind: f.kind,
        name: f.name.trim(), lat: coords.lat, lng: coords.lng,
        note: f.note || null, address: f.address || null, city: f.city || null,
        state: f.state || null, phone: f.phone || null,
        truck_id: f.truck_id || null, trailer_id: f.trailer_id || null,
        expected_until: f.expected_until ? new Date(f.expected_until).toISOString() : null,
        share_to_roadmark: f.share_to_roadmark, created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: onSaved,
  });

  const isEquipment = ['dropped_trailer', 'dropped_truck'].includes(f.kind);

  return (
    <Drawer title="Drop a pin" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save pin'}
        </button>
      </>}>
      <ErrorNote error={save.error} />
      <p className="small muted">
        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — everyone in your company sees this pin
        on the map straight away.
      </p>
      <Field label="What is it">
        <select value={f.kind} onChange={set('kind')}>
          {[...OURS, 'repair_shop', 'parking', 'truck_stop'].map((k) =>
            <option key={k} value={k}>{PLACE_STYLE[k]?.label || k}</option>)}
        </select>
      </Field>
      <Field label="Name"><input value={f.name} onChange={set('name')}
        placeholder={f.kind === 'dropped_trailer' ? 'Trailer D50065 at Pilot #442' : 'Name'} /></Field>

      {isEquipment && (
        <div className="frow">
          <Field label="Trailer">
            <select value={f.trailer_id} onChange={set('trailer_id')}>
              <option value="">—</option>
              {(opts.data?.trailers || []).map((t) => <option key={t.id} value={t.id}>{t.unit_number}</option>)}
            </select>
          </Field>
          <Field label="Truck">
            <select value={f.truck_id} onChange={set('truck_id')}>
              <option value="">—</option>
              {(opts.data?.trucks || []).map((t) => <option key={t.id} value={t.id}>{t.unit_number}</option>)}
            </select>
          </Field>
        </div>
      )}
      {isEquipment && (
        <Field label="Expected to sit until">
          <input type="datetime-local" value={f.expected_until} onChange={set('expected_until')} />
        </Field>
      )}

      <Field label="Note"><textarea rows={3} value={f.note} onChange={set('note')}
        placeholder="Anything the next person needs to know — gate code, who to ask for, cost per night…" /></Field>

      <div className="frow">
        <Field label="City"><input value={f.city} onChange={set('city')} /></Field>
        <Field label="State"><input value={f.state} onChange={set('state')} maxLength={2} /></Field>
      </div>
      <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.share_to_roadmark}
          onChange={(e) => setF((p) => ({ ...p, share_to_roadmark: e.target.checked }))} />
        <span className="small">
          <b>Share with Roadmark</b> — submits it to the public directory as a user submission
          so drivers on Roadmark see it too. Leave off for anything private (yards, dropped
          equipment, customer docks).
        </span>
      </label>
    </Drawer>
  );
}

/* ---------------- a place ---------------- */

function PlaceDrawer({ place: p, onClose, onChanged }) {
  const { companyId, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const isOurs = !!p.company_id;
  const st = PLACE_STYLE[p.kind] || PLACE_STYLE.other;

  const note = useQuery({
    queryKey: ['place-note', p.id, companyId],
    enabled: !isOurs,
    queryFn: async () => {
      const { data } = await supabase.from('place_notes')
        .select('*').eq('place_id', p.id).eq('company_id', companyId).maybeSingle();
      return data;
    },
  });

  const [n, setN] = useState({ preferred: false, blacklisted: false, negotiated_rate: '', note: '' });
  const loaded = note.data && n.note === '' && !n.preferred && !n.blacklisted && !n.negotiated_rate;
  if (loaded && note.data) {
    // hydrate once from the saved note
    setTimeout(() => setN({
      preferred: note.data.preferred, blacklisted: note.data.blacklisted,
      negotiated_rate: note.data.negotiated_rate || '', note: note.data.note || '',
    }), 0);
  }

  const saveNote = async () => {
    try {
      setBusy(true); setErr(null);
      const { error } = await supabase.from('place_notes').upsert({
        company_id: companyId, place_id: p.id,
        preferred: n.preferred, blacklisted: n.blacklisted,
        negotiated_rate: n.negotiated_rate || null, note: n.note || null,
        updated_by: user?.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,place_id' });
      if (error) throw error;
      onChanged?.();
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const resolve = async () => {
    try {
      setBusy(true);
      const { error } = await supabase.from('map_places').update({ status: 'resolved' }).eq('id', p.id);
      if (error) throw error;
      onChanged?.(); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Drawer title={`${st.icon} ${p.name}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <div style={{ flex: 1 }} />
        {isOurs
          ? <button className="btn btn-ghost" disabled={busy} onClick={resolve}>Mark resolved</button>
          : <button className="btn btn-primary" disabled={busy} onClick={saveNote}>Save our notes</button>}
      </>}>
      <ErrorNote error={err} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="chip gray nodot">{st.label}</span>
        <span className="chip gray nodot">{isOurs ? 'Our pin' : 'Roadmark directory'}</span>
        {p.share_to_roadmark && <span className="chip amber">shared to Roadmark</span>}
      </div>
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div className="small">{[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ') || '—'}</div>
        {p.phone && <div className="small">{p.phone}</div>}
        {p.website && <div className="small"><a href={p.website} target="_blank" rel="noopener noreferrer">{p.website}</a></div>}
        {p.hours && <div className="small muted">{p.hours}</div>}
        {p.rating && <div className="small">★ {p.rating} {p.reviews_count ? `(${p.reviews_count})` : ''}</div>}
        <div className="small muted" style={{ marginTop: 5 }}>{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</div>
        <a className="btn btn-ghost" style={{ marginTop: 8 }}
          href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer">
          Directions
        </a>
      </div>

      {p.note && <><div className="nav-section" style={{ padding: '0 0 4px' }}>Note</div><p className="small">{p.note}</p></>}

      {!isOurs && (
        <>
          <div className="nav-section" style={{ padding: '10px 0 4px' }}>Our notes on this shop</div>
          <p className="small muted">Private to your company — it never leaves the TMS.</p>
          <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
            <span className={`chip ${n.preferred ? 'green' : 'gray'}`} style={{ cursor: 'pointer' }}
              onClick={() => setN((x) => ({ ...x, preferred: !x.preferred, blacklisted: false }))}>Preferred</span>
            <span className={`chip ${n.blacklisted ? 'red' : 'gray'}`} style={{ cursor: 'pointer' }}
              onClick={() => setN((x) => ({ ...x, blacklisted: !x.blacklisted, preferred: false }))}>Do not use</span>
          </div>
          <Field label="Negotiated rate">
            <input value={n.negotiated_rate} onChange={(e) => setN((x) => ({ ...x, negotiated_rate: e.target.value }))}
              placeholder="$95/hr labour, ask for Mike" />
          </Field>
          <Field label="Note">
            <textarea rows={3} value={n.note} onChange={(e) => setN((x) => ({ ...x, note: e.target.value }))} />
          </Field>
        </>
      )}

      {isOurs && p.expected_until && (
        <p className="small muted">Expected to sit until {dt(p.expected_until)}.</p>
      )}
    </Drawer>
  );
}
