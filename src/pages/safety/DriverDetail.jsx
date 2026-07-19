import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { uploadCompanyDoc, openDoc } from '../../lib/storage';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Field, Empty, ErrorNote, Drawer } from '../../components/ui';
import { money, d, dt, ago, title } from '../../lib/format';
import { statusFor } from './Compliance';

const TABS = ['overview', 'compliances', 'recurring deductions', 'loads', 'settlements'];
const mask = (v, keep = 4) => !v ? '—' : '•••• ' + String(v).slice(-keep);

export default function DriverDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState('overview');

  const driver = useQuery({
    queryKey: ['driver', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('drivers').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const compliances = useQuery({
    queryKey: ['driver-compliance', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('compliance_items')
        .select('*, type:compliance_types(code, name)')
        .eq('entity_type', 'driver').eq('entity_id', id).order('expiry_date', { nullsFirst: true });
      if (error) throw error;
      return data;
    },
  });

  const alerts = (compliances.data || []).filter((c) => statusFor(c.expiry_date) !== 'valid').length;
  const dr = driver.data;

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => nav('/safety/drivers')}>‹</button>
        <div>
          <h2 style={{ margin: 0 }}>{dr?.full_name || '…'}</h2>
          <div className="small muted">{dr?.email}</div>
        </div>
        {dr && <Chip value={dr.status} />}
        <div className="spacer" />
      </div>

      <div className="seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {title(t)}
            {t === 'compliances' && alerts > 0 && (
              <span className="chip red nodot" style={{ marginLeft: 6 }}>{alerts}</span>
            )}
          </button>
        ))}
      </div>

      <ErrorNote error={driver.error} />
      {tab === 'overview' && dr && <Overview driver={dr} />}
      {tab === 'compliances' && <Compliances rows={compliances.data} driverId={id} />}
      {tab === 'recurring deductions' && <Recurring driverId={id} />}
      {tab === 'loads' && <Loads driverId={id} />}
      {tab === 'settlements' && <Statements driverId={id} />}
    </>
  );
}

/* ---------------- overview ---------------- */

function Overview({ driver: dr }) {
  const { companyId } = useAuth();

  const priv = useQuery({
    queryKey: ['driver-private', dr.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('driver_private')
        .select('*').eq('driver_id', dr.id).maybeSingle();
      if (error) return null;   // not permitted for this role — that's fine
      return data;
    },
  });

  const rig = useQuery({
    queryKey: ['driver-rig', dr.id],
    queryFn: async () => {
      const { data } = await supabase.from('assignments')
        .select('id, started_at, truck:trucks(id, unit_number), trailer:trailers(id, unit_number)')
        .eq('driver_id', dr.id).is('ended_at', null).maybeSingle();
      return data;
    },
  });

  const lastLoad = useQuery({
    queryKey: ['driver-last-load', dr.id],
    queryFn: async () => {
      const { data } = await supabase.from('loads')
        .select('id, load_number, status, customer_load_id, pickup_location, delivery_location, pickup_time, delivery_time, loaded_miles, empty_miles, freight_amount, driver_rate, total_miles, weight_lbs')
        .eq('driver_id', dr.id).order('pickup_time', { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const dispatcher = useQuery({
    queryKey: ['driver-dispatcher', dr.dispatcher_id],
    enabled: !!dr.dispatcher_id,
    queryFn: async () => {
      const { data } = await supabase.from('profiles')
        .select('full_name, email').eq('id', dr.dispatcher_id).maybeSingle();
      return data;
    },
  });

  const p = priv.data, r = rig.data, l = lastLoad.data;
  const payLabel = dr.pay_rate_type === 'percentage'
    ? `${(Number(dr.pay_rate) * 100).toFixed(0)}%`
    : dr.pay_rate_type === 'flat' ? 'Flat' : `$${dr.pay_rate}/mi`;

  return (
    <div className="grid cols-2">
      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>Personal info</div>
        <Row l="Status" v={<Chip value={dr.status} />} />
        <Row l="Type" v={<span style={{ color: 'var(--accent)' }}>{title(dr.driver_type)}</span>} />
        <Row l="SSN" v={p ? mask(p.ssn_full || dr.ssn) : mask(dr.ssn)} mono />
        <Row l="Phone" v={dr.phone || '—'} />
        <Row l="Email" v={dr.email || '—'} />
        <Row l="Address" v={p?.home_address || '—'} />
        <Row l="Date of birth" v={p?.date_of_birth ? d(p.date_of_birth) : '—'} />
        <Row l="Hired" v={dr.hire_date ? d(dr.hire_date) : '—'} />
        <Row l="Created" v={ago(dr.created_at)} />
        <Row l="Note" v={dr.note || '—'} />
        {!p && <p className="small muted" style={{ marginTop: 8 }}>
          SSN, date of birth, address and banking are restricted to safety, accounting and admins.
        </p>}
      </div>

      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>Assignment</div>
        <Row l="Truck" v={r?.truck?.unit_number ? <b>{r.truck.unit_number}</b> : '—'} />
        <Row l="Trailer" v={r?.trailer?.unit_number ? <b>{r.trailer.unit_number}</b> : '—'} />
        <Row l="Since" v={r?.started_at ? d(r.started_at) : '—'} />
        <Row l="Dispatcher" v={dispatcher.data?.full_name || dispatcher.data?.email || '—'} />
        <Row l="Co-driver" v={dr.co_driver_id ? 'Assigned' : '—'} />

        <div className="nav-section" style={{ padding: '16px 0 6px' }}>Last load</div>
        {l ? (
          <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px',
            borderLeft: '3px solid var(--accent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b className="num">#{l.load_number}</b>
              <span className="small muted">{l.customer_load_id}</span>
              <div style={{ flex: 1 }} />
              <Chip value={l.status} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{l.pickup_location}</div>
                <div className="small muted">{dt(l.pickup_time)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{l.delivery_location}</div>
                <div className="small muted">{dt(l.delivery_time)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
              <span className="lb-tag">{l.empty_miles}mi empty</span>
              <span className="lb-tag">{Number(l.loaded_miles).toLocaleString()}mi loaded</span>
              <span className="lb-tag strong">{money(l.freight_amount)}</span>
              <span className="lb-tag green">{money(l.driver_rate)}</span>
              <span className="lb-tag amber">
                {l.total_miles ? (Number(l.freight_amount) / l.total_miles).toFixed(2) : '0.00'}$/mi
              </span>
            </div>
          </div>
        ) : <p className="small muted">No loads yet.</p>}
      </div>

      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>Payment info</div>
        <Row l="Pay type" v={title(dr.pay_rate_type)} />
        <Row l="Pay rate" v={<b>{payLabel}</b>} />
        <Row l="Deduct fuel" v={dr.deduct_fuel ? 'On driver' : 'On company'} />
        <Row l="Deduct tolls" v={dr.deduct_tolls ? 'On driver' : 'On company'} />
        <Row l="Fuel discount share" v={dr.fuel_discount_pct ? `${(Number(dr.fuel_discount_pct) * 100).toFixed(0)}%` : '—'} />
        <Row l="Bank routing" v={p ? mask(p.bank_routing) : '—'} mono />
        <Row l="Bank account" v={p ? mask(p.bank_account) : '—'} mono />
        <Row l="Payout method" v={p?.payout_method ? title(p.payout_method) : '—'} />
      </div>

      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>Legal info</div>
        <Row l="CDL number" v={dr.cdl_number || '—'} mono />
        <Row l="Class / state" v={`${dr.cdl_class || '—'} / ${dr.cdl_state || '—'}`} />
        <Row l="Endorsements" v={dr.cdl_endorsements || '—'} />
        <Row l="Company name" v={dr.company_name || '—'} />
        <Row l="EIN" v={dr.company_ein || '—'} mono />
        <Row l="Company address" v={dr.company_address || '—'} />
        <Row l="Recruiter" v={dr.recruiter || '—'} />
        <Row l="Emergency contact" v={dr.emergency_contact_name
          ? `${dr.emergency_contact_name} · ${dr.emergency_contact_phone || ''}` : '—'} />
      </div>
    </div>
  );
}

function Row({ l, v, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
      borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
      <span className="muted">{l}</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontFamily: mono ? 'var(--font-display)' : undefined, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

/* ---------------- compliances ---------------- */

function Compliances({ rows, driverId }) {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const editable = canEdit('safety');

  const docs = useQuery({
    queryKey: ['driver-docs-map', driverId],
    queryFn: async () => {
      const { data } = await supabase.from('documents')
        .select('id, file_path, file_name').eq('entity_type', 'driver').eq('entity_id', driverId);
      return Object.fromEntries((data || []).map((x) => [x.id, x]));
    },
  });

  return (
    <>
      <div className="page-head" style={{ marginBottom: 10 }}>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add compliance</button>}
      </div>
      <div className="grid" style={{ gap: 8 }}>
        {(rows || []).map((c) => {
          const live = statusFor(c.expiry_date);
          const days = c.expiry_date ? Math.floor((new Date(c.expiry_date) - new Date()) / 86400000) : null;
          return (
            <div key={c.id} className="card card-pad" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <b style={{ color: live === 'expired' ? 'var(--danger)' : live === 'expiring' ? 'var(--warn)' : 'var(--accent)' }}>
                  {c.type?.code}
                </b>
                <span className="small muted">{c.type?.name}</span>
                <div style={{ flex: 1 }} />
                <Chip value={live} />
              </div>
              <div className="small muted" style={{ marginTop: 5 }}>
                Start {d(c.issue_date)} · End {d(c.expiry_date)}
                {days !== null && (days < 0
                  ? <span style={{ color: 'var(--danger)' }}> · {Math.abs(days)} days overdue</span>
                  : <span> · {days} days left</span>)}
              </div>
              {c.document_id && docs.data?.[c.document_id] && (
                <button className="btn btn-ghost" style={{ marginTop: 7 }}
                  onClick={() => openDoc(docs.data[c.document_id].file_path)}>
                  📄 {docs.data[c.document_id].file_name}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {(!rows || rows.length === 0) && (
        <div className="card"><Empty head="No compliance items"
          sub="CDL, medical card, MVR, drug test, clearinghouse, W-9 and the rest live here with their expiry dates." /></div>
      )}
      {adding && <AddCompliance driverId={driverId} companyId={companyId} userId={user?.id}
        onClose={() => setAdding(false)}
        onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['driver-compliance', driverId] }); }} />}
    </>
  );
}

function AddCompliance({ driverId, companyId, userId, onClose, onSaved }) {
  const [f, setF] = useState({ compliance_type_id: '', issue_date: '', expiry_date: '', note: '' });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const types = useQuery({
    queryKey: ['ctypes-driver'],
    queryFn: async () => {
      const { data } = await supabase.from('compliance_types')
        .select('id, code, name, default_valid_days').eq('applies_to', 'driver').order('code');
      return data || [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.compliance_type_id) throw new Error('Pick the item.');
      let document_id = null;
      if (file) {
        const { path, name } = await uploadCompanyDoc(companyId, 'driver', driverId, file);
        const { data: doc, error } = await supabase.from('documents').insert({
          company_id: companyId, entity_type: 'driver', entity_id: driverId,
          doc_type: 'other', file_name: name, file_path: path,
          mime_type: file.type, size_bytes: file.size, uploaded_by: userId,
        }).select('id').single();
        if (error) throw error;
        document_id = doc.id;
      }
      const { error } = await supabase.from('compliance_items').insert({
        company_id: companyId, entity_type: 'driver', entity_id: driverId,
        compliance_type_id: f.compliance_type_id,
        issue_date: f.issue_date || null, expiry_date: f.expiry_date || null,
        status: statusFor(f.expiry_date), note: f.note || null, document_id, created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: onSaved,
  });

  return (
    <Drawer title="Add compliance item" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
      </>}>
      <ErrorNote error={save.error} />
      <Field label="Item">
        <select value={f.compliance_type_id} onChange={set('compliance_type_id')}>
          <option value="">—</option>
          {(types.data || []).map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
        </select>
      </Field>
      <div className="frow">
        <Field label="Start"><input type="date" value={f.issue_date} onChange={set('issue_date')} /></Field>
        <Field label="End"><input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></Field>
      </div>
      <Field label="Document"><input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      <Field label="Note"><textarea rows={2} value={f.note} onChange={set('note')} /></Field>
    </Drawer>
  );
}

/* ---------------- recurring deductions ---------------- */

function Recurring({ driverId }) {
  const rows = useQuery({
    queryKey: ['driver-recurring', driverId],
    queryFn: async () => {
      const { data, error } = await supabase.from('recurring_deductions')
        .select('*').eq('driver_id', driverId).order('name');
      if (error) throw error;
      const ids = data.map((r) => r.id);
      let runs = [];
      if (ids.length) {
        const { data: rr } = await supabase.from('recurring_deduction_runs')
          .select('recurring_deduction_id, amount, run_date, status').in('recurring_deduction_id', ids);
        runs = rr || [];
      }
      return data.map((r) => {
        const mine = runs.filter((x) => x.recurring_deduction_id === r.id);
        return {
          ...r,
          accumulated: mine.reduce((a, x) => a + Number(x.amount || 0), 0),
          runs: mine.length,
          since: mine.length ? mine.map((x) => x.run_date).sort()[0] : null,
        };
      });
    },
  });

  return (
    <>
      <p className="small muted" style={{ marginBottom: 10 }}>
        Processed daily at 13:00 UTC. Each run becomes a line on the driver's next statement.
      </p>
      <div className="grid" style={{ gap: 8 }}>
        {(rows.data || []).map((r) => {
          const pctDone = r.max_occurrences ? (r.occurrences_done / r.max_occurrences) * 100 : null;
          return (
            <div key={r.id} className="card card-pad" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <b>{r.name}</b>
                <div style={{ flex: 1 }} />
                <Chip value={r.status} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                <b className="num" style={{ fontSize: 19 }}>{money(r.amount)}</b>
                <span className="small muted">
                  / {title(r.frequency)}
                  {r.frequency !== 'monthly' && r.anchor_dow !== null
                    ? ` (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.anchor_dow]}s)` : ''}
                </span>
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                Accumulated <b className="num">{money(r.accumulated)}</b> over {r.runs} run(s)
                {r.since ? ` since ${d(r.since)}` : ''}
                {r.max_occurrences ? ` · ${r.occurrences_done}/${r.max_occurrences}` : ' · ongoing'}
              </div>
              {pctDone !== null && (
                <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-3)', marginTop: 7, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, pctDone)}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {rows.data?.length === 0 && (
        <div className="card"><Empty head="No recurring deductions"
          sub="Truck rent, trailer rent, ELD device, cargo insurance, occupational insurance and escrow are set up here." /></div>
      )}
    </>
  );
}

/* ---------------- loads ---------------- */

function Loads({ driverId }) {
  const rows = useQuery({
    queryKey: ['driver-loads', driverId],
    queryFn: async () => {
      const { data, error } = await supabase.from('loads')
        .select('id, load_number, status, customer_load_id, pickup_location, delivery_location, pickup_time, delivery_time, loaded_miles, empty_miles, total_miles, freight_amount, driver_rate, customer:customers(name)')
        .eq('driver_id', driverId).order('pickup_time', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  const t = (rows.data || []).reduce((a, l) => ({
    gross: a.gross + Number(l.freight_amount || 0),
    pay: a.pay + Number(l.driver_rate || 0),
    miles: a.miles + Number(l.total_miles || 0),
  }), { gross: 0, pay: 0, miles: 0 });

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="card-pad small muted" style={{ paddingBottom: 8 }}>
        {rows.data?.length || 0} loads · gross <b className="num">{money(t.gross)}</b> ·
        driver pay <b className="num">{money(t.pay)}</b> ·
        {Math.round(t.miles).toLocaleString()} mi ·
        avg <b className="num">${(t.miles ? t.gross / t.miles : 0).toFixed(2)}</b>/mi
      </div>
      <table className="data">
        <thead><tr><th>#</th><th>Status</th><th>Customer</th><th>Route</th><th>Miles</th><th>Freight</th><th>Driver rate</th><th>$/mi</th></tr></thead>
        <tbody>
          {(rows.data || []).map((l) => (
            <tr key={l.id} className="norow">
              <td className="num">{l.load_number}</td>
              <td><Chip value={l.status} /></td>
              <td className="small">{l.customer?.name || '—'}</td>
              <td className="small">{l.pickup_location} → {l.delivery_location}
                <div className="muted">{dt(l.pickup_time)}</div></td>
              <td className="num">{Number(l.total_miles).toLocaleString()}</td>
              <td className="num">{money(l.freight_amount)}</td>
              <td className="num">{money(l.driver_rate)}</td>
              <td className="num">{l.total_miles ? `$${(Number(l.freight_amount) / l.total_miles).toFixed(2)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.data?.length === 0 && <Empty head="No loads yet" sub="Loads assigned to this driver appear here." />}
    </div>
  );
}

/* ---------------- settlements ---------------- */

function Statements({ driverId }) {
  const rows = useQuery({
    queryKey: ['driver-settlements', driverId],
    queryFn: async () => {
      const { data, error } = await supabase.from('settlements')
        .select('*').eq('driver_id', driverId).order('statement_number', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table className="data">
        <thead><tr>
          <th>Statement</th><th>Period</th><th>Status</th><th>Loads</th><th>Credits</th>
          <th>Fuel</th><th>Tolls</th><th>Deductions</th><th>Scheduled</th><th>Net pay</th>
        </tr></thead>
        <tbody>
          {(rows.data || []).map((s) => (
            <tr key={s.id} className="norow">
              <td className="num">#{s.statement_number}</td>
              <td className="small">{d(s.period_start)} – {d(s.period_end)}</td>
              <td><Chip value={s.status} /></td>
              <td className="num">{money(s.loads_total)}</td>
              <td className="num">{money(s.credits_total)}</td>
              <td className="num">{money(-s.fuel_total)}</td>
              <td className="num">{money(-s.tolls_total)}</td>
              <td className="num">{money(-s.deductions_total)}</td>
              <td className="num">{money(-s.scheduled_total)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(s.net_pay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.data?.length === 0 && (
        <Empty head="No statements yet"
          sub="Run a settlement from Accounting → Settlements → Statements." />
      )}
    </div>
  );
}
