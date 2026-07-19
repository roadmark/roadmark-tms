import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../app/AuthProvider';

/** Topbar search across loads, drivers, units and customers. */
export default function GlobalSearch() {
  const { companyId } = useAuth();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setRes(null); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!companyId || term.length < 2) { setRes(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      const like = `%${term}%`;
      const asNum = /^\d+$/.test(term) ? Number(term) : null;
      const [loads, drivers, trucks, trailers, customers] = await Promise.all([
        supabase.from('loads')
          .select('id, load_number, customer_load_id, pickup_location, delivery_location, status')
          .eq('company_id', companyId)
          .or(`customer_load_id.ilike.${like}${asNum !== null ? `,load_number.eq.${asNum}` : ''}`)
          .limit(5),
        supabase.from('drivers').select('id, full_name, phone, status')
          .eq('company_id', companyId).ilike('full_name', like).limit(5),
        supabase.from('trucks').select('id, unit_number, vin, status')
          .eq('company_id', companyId).or(`unit_number.ilike.${like},vin.ilike.${like}`).limit(5),
        supabase.from('trailers').select('id, unit_number, vin, status')
          .eq('company_id', companyId).or(`unit_number.ilike.${like},vin.ilike.${like}`).limit(5),
        supabase.from('customers').select('id, name, mc_number')
          .eq('company_id', companyId).or(`name.ilike.${like},mc_number.ilike.${like}`).limit(5),
      ]);
      setBusy(false);
      setRes({
        loads: loads.data || [], drivers: drivers.data || [], trucks: trucks.data || [],
        trailers: trailers.data || [], customers: customers.data || [],
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, companyId]);

  const go = (path) => { setQ(''); setRes(null); nav(path); };
  const total = res ? Object.values(res).reduce((a, x) => a + x.length, 0) : 0;

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search load #, driver, unit, VIN, customer…"
        aria-label="Search"
        className="searchbox" 
      />
      {res && (
        <div className="card" style={{ position: 'absolute', top: 40, right: 0, width: 380,
          zIndex: 40, maxHeight: 420, overflowY: 'auto' }}>
          {total === 0 && <div className="card-pad small muted">{busy ? 'Searching…' : 'Nothing found'}</div>}
          <Section title="Loads" rows={res.loads} render={(l) => (
            <>
              <b>#{l.load_number}</b> {l.customer_load_id ? `· ${l.customer_load_id}` : ''}
              <div className="small muted">{l.pickup_location} → {l.delivery_location} · {l.status}</div>
            </>
          )} onPick={() => go('/dispatch/loads')} />
          <Section title="Drivers" rows={res.drivers} render={(x) => (
            <><b>{x.full_name}</b><div className="small muted">{x.phone || '—'} · {x.status}</div></>
          )} onPick={() => go('/safety/drivers')} />
          <Section title="Trucks" rows={res.trucks} render={(x) => (
            <><b>{x.unit_number}</b><div className="small muted">{x.vin || '—'} · {x.status}</div></>
          )} onPick={() => go('/fleet/units')} />
          <Section title="Trailers" rows={res.trailers} render={(x) => (
            <><b>{x.unit_number}</b><div className="small muted">{x.vin || '—'} · {x.status}</div></>
          )} onPick={() => go('/fleet/units')} />
          <Section title="Customers" rows={res.customers} render={(x) => (
            <><b>{x.name}</b><div className="small muted">{x.mc_number || '—'}</div></>
          )} onPick={() => go('/dispatch/customers')} />
        </div>
      )}
    </div>
  );
}

function Section({ title, rows, render, onPick }) {
  if (!rows.length) return null;
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="nav-section" style={{ padding: '8px 14px 2px', color: 'var(--text-3)' }}>{title}</div>
      {rows.map((r) => (
        <div key={r.id} onClick={onPick}
          style={{ padding: '7px 14px', cursor: 'pointer' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
          {render(r)}
        </div>
      ))}
    </div>
  );
}
