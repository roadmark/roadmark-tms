import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { uploadCompanyDoc, openDoc } from '../../lib/storage';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Field, Empty, ErrorNote, Drawer } from '../../components/ui';
import { money, d, dt, ago, title } from '../../lib/format';
import { statusFor } from '../safety/Compliance';

const TABS = ['overview', 'compliances', 'maintenance', 'cases', 'condition'];
const PRIORITY_CHIP = { critical: 'red', high: 'orange', medium: 'blue', low: 'gray' };
const OPEN_CASES = ['created', 'diagnostics', 'awaiting_approval', 'repair'];

export default function UnitDetail({ kind }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { companyId } = useAuth();
  const [tab, setTab] = useState('overview');
  const table = kind === 'trailer' ? 'trailers' : 'trucks';

  const unit = useQuery({
    queryKey: [table, id],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const compliances = useQuery({
    queryKey: ['unit-compliance', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('compliance_items')
        .select('*, type:compliance_types(code, name), document_id')
        .eq('entity_type', kind).eq('entity_id', id).order('expiry_date', { nullsFirst: true });
      if (error) throw error;
      return data;
    },
  });

  const u = unit.data;
  const openCases = useQuery({
    queryKey: ['unit-cases', id],
    queryFn: async () => {
      const col = kind === 'trailer' ? 'trailer_id' : 'truck_id';
      const { data, error } = await supabase.from('repair_cases')
        .select('*, vendor:vendors(name), driver:drivers(full_name)')
        .eq(col, id).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const counts = {
    compliance: (compliances.data || []).filter((c) => statusFor(c.expiry_date) !== 'valid').length,
    cases: (openCases.data || []).filter((c) => OPEN_CASES.includes(c.status)).length,
  };

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => nav(`/fleet/${table}`)}>‹</button>
        <span className="chip gray nodot">{kind === 'trailer' ? 'Trailer' : 'Truck'}</span>
        <h2 style={{ marginLeft: 4 }}>{u?.unit_number || '…'}</h2>
        {u && <Chip value={u.status} />}
        <div className="spacer" />
      </div>

      <div className="seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {title(t)}
            {t === 'compliances' && counts.compliance > 0 && <span className="chip red nodot" style={{ marginLeft: 6 }}>{counts.compliance}</span>}
            {t === 'cases' && counts.cases > 0 && <span className="chip amber nodot" style={{ marginLeft: 6 }}>{counts.cases}</span>}
          </button>
        ))}
      </div>

      <ErrorNote error={unit.error} />
      {tab === 'overview' && u && <Overview unit={u} kind={kind} />}
      {tab === 'compliances' && <Compliances rows={compliances.data} kind={kind} entityId={id} />}
      {tab === 'maintenance' && <MaintenanceTab kind={kind} id={id} />}
      {tab === 'cases' && <CasesTab rows={openCases.data} />}
      {tab === 'condition' && <ConditionTab kind={kind} id={id} companyId={companyId} />}
    </>
  );
}

/* ---------------- overview ---------------- */

function Overview({ unit, kind }) {
  const { companyId } = useAuth();

  const assignment = useQuery({
    queryKey: ['unit-assignment', unit.id],
    queryFn: async () => {
      const col = kind === 'trailer' ? 'trailer_id' : 'truck_id';
      const { data, error } = await supabase.from('assignments')
        .select('id, started_at, driver:drivers(id, full_name, phone, driver_type)')
        .eq(col, unit.id).is('ended_at', null).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const lastLoad = useQuery({
    queryKey: ['unit-last-load', unit.id],
    queryFn: async () => {
      const col = kind === 'trailer' ? 'trailer_id' : 'truck_id';
      const { data, error } = await supabase.from('loads')
        .select('id, load_number, status, customer_load_id, pickup_location, delivery_location, pickup_time, delivery_time, loaded_miles, empty_miles, freight_amount, driver_rate, weight_lbs, total_miles')
        .eq(col, unit.id).order('pickup_time', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const service = useQuery({
    queryKey: ['unit-service', unit.id],
    enabled: kind === 'truck',
    queryFn: async () => {
      const [pm, odo] = await Promise.all([
        supabase.from('pm_schedules').select('*').eq('truck_id', unit.id).limit(1).maybeSingle(),
        supabase.from('odometer_readings').select('reading, recorded_at')
          .eq('truck_id', unit.id).order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      return { pm: pm.data, odo: odo.data };
    },
  });

  const lease = useQuery({
    queryKey: ['unit-lease', unit.id],
    queryFn: async () => {
      const col = kind === 'trailer' ? 'trailer_id' : 'truck_id';
      const { data } = await supabase.from('unit_leases').select('*').eq(col, unit.id).limit(1).maybeSingle();
      return data;
    },
  });

  const a = assignment.data, l = lastLoad.data, s = service.data, lz = lease.data;
  const cycleStart = s?.pm?.last_done_odometer ?? 0;
  const interval = s?.pm?.interval_miles ?? 0;
  const nextDue = cycleStart + interval;
  const current = s?.odo?.reading ?? 0;
  const pct = interval ? Math.min(100, Math.max(0, ((current - cycleStart) / interval) * 100)) : 0;
  const left = nextDue - current;

  return (
    <div className="grid cols-2">
      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>
          {kind === 'trailer' ? 'Trailer' : 'Truck'} info
        </div>
        <Row l="Status" v={<Chip value={unit.status} />} />
        <Row l="VIN" v={unit.vin || '—'} mono />
        <Row l="Type" v={title(unit.truck_type || unit.trailer_type || '—')} />
        <Row l="Ownership" v={<span style={{ color: 'var(--accent)' }}>{title(unit.ownership)}</span>} />
        <Row l="Created" v={ago(unit.created_at)} />
        <Row l="Note" v={unit.note || '—'} />

        {kind === 'truck' && (
          <>
            <div className="nav-section" style={{ padding: '16px 0 6px' }}>Service</div>
            {s?.pm ? (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <MiniStat l="Cycle start" v={cycleStart.toLocaleString() + ' mi'} />
                  <MiniStat l="Next service" v={nextDue.toLocaleString() + ' mi'} />
                  <MiniStat l="Odometer" v={current.toLocaleString() + ' mi'} />
                  <span className={`chip ${left < 0 ? 'red' : left < 2000 ? 'orange' : 'green'}`}>
                    {left < 0 ? `${Math.abs(left).toLocaleString()} mi overdue` : `${left.toLocaleString()} mi to ${s.pm.name}`}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%',
                    background: pct > 95 ? 'var(--danger)' : pct > 80 ? 'var(--warn)' : 'var(--ok)' }} />
                </div>
              </>
            ) : (
              <p className="small muted">No PM schedule on this unit yet. Add one under Fleet →
                Maintenance to track service intervals here.</p>
            )}
          </>
        )}
      </div>

      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>Assignment</div>
        {a?.driver ? (
          <>
            <Row l="Driver" v={<b>{a.driver.full_name}</b>} />
            <Row l="Type" v={title(a.driver.driver_type)} />
            <Row l="Phone" v={a.driver.phone || '—'} />
            <Row l="Since" v={d(a.started_at)} />
          </>
        ) : <p className="small muted">Not assigned to a driver.</p>}

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
              {l.weight_lbs && <span className="lb-tag red">{Number(l.weight_lbs).toLocaleString()} lbs</span>}
              <span className="lb-tag amber">
                {l.total_miles ? (Number(l.freight_amount) / l.total_miles).toFixed(2) : '0.00'}$/mi
              </span>
            </div>
          </div>
        ) : <p className="small muted">No loads recorded for this unit.</p>}
      </div>

      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>Vehicle details</div>
        <Row l="Make" v={unit.make || '—'} />
        <Row l="Model" v={unit.model || '—'} />
        <Row l="Year" v={unit.year || '—'} />
        <Row l="Plate" v={unit.plate || '—'} />
        <Row l="Plate state" v={unit.plate_state || '—'} />
        <Row l="Registrant" v={unit.registrant || '—'} />
        {kind === 'truck' && <Row l="Toll device code" v={unit.toll_device_code || '—'} mono />}
        {kind === 'truck' && <Row l="Dropoff location" v={unit.dropoff_location || '—'} />}
      </div>

      <div className="card card-pad">
        <div className="nav-section" style={{ padding: '0 0 8px' }}>Lease / rent info</div>
        <Row l="Leasor" v={unit.leasor || '—'} />
        <Row l="Lease no." v={lz?.lease_number || '—'} />
        <Row l="In date" v={lz?.start_date ? d(lz.start_date) : '—'} />
        <Row l="Weekly payment" v={lz?.weekly_payment ? money(lz.weekly_payment) : '—'} />
        <Row l="Down payment" v={lz?.down_payment ? money(lz.down_payment) : '—'} />
        <Row l="Buy-out" v={lz?.buyout_amount ? money(lz.buyout_amount) : '—'} />
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
function MiniStat({ l, v }) {
  return (
    <div>
      <div className="dc-stat-l">{l}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 700 }}>{v}</div>
    </div>
  );
}

/* ---------------- compliances ---------------- */

function Compliances({ rows, kind, entityId }) {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const editable = canEdit('safety') || canEdit('fleet');

  const docs = useQuery({
    queryKey: ['unit-docs-map', entityId],
    queryFn: async () => {
      const { data } = await supabase.from('documents')
        .select('id, file_path, file_name').eq('entity_type', kind).eq('entity_id', entityId);
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
          const days = c.expiry_date
            ? Math.floor((new Date(c.expiry_date) - new Date()) / 86400000) : null;
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
              {c.note && <div className="small" style={{ marginTop: 4 }}>{c.note}</div>}
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
          sub="Registration, annual inspection, 2290, permits and title all live here with their expiry dates." /></div>
      )}
      {adding && <AddCompliance kind={kind} entityId={entityId} companyId={companyId} userId={user?.id}
        onClose={() => setAdding(false)}
        onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['unit-compliance', entityId] }); }} />}
    </>
  );
}

function AddCompliance({ kind, entityId, companyId, userId, onClose, onSaved }) {
  const [f, setF] = useState({ compliance_type_id: '', issue_date: '', expiry_date: '', note: '' });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const types = useQuery({
    queryKey: ['ctypes', kind],
    queryFn: async () => {
      const { data } = await supabase.from('compliance_types')
        .select('id, code, name').eq('applies_to', kind).order('code');
      return data || [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.compliance_type_id) throw new Error('Pick the item.');
      let document_id = null;
      if (file) {
        const { path, name } = await uploadCompanyDoc(companyId, kind, entityId, file);
        const { data: doc, error } = await supabase.from('documents').insert({
          company_id: companyId, entity_type: kind, entity_id: entityId,
          doc_type: 'registration', file_name: name, file_path: path,
          mime_type: file.type, size_bytes: file.size, uploaded_by: userId,
        }).select('id').single();
        if (error) throw error;
        document_id = doc.id;
      }
      const { error } = await supabase.from('compliance_items').insert({
        company_id: companyId, entity_type: kind, entity_id: entityId,
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

/* ---------------- maintenance ---------------- */

function MaintenanceTab({ kind, id }) {
  const rows = useQuery({
    queryKey: ['unit-maintenance', id],
    queryFn: async () => {
      const col = kind === 'trailer' ? 'trailer_id' : 'truck_id';
      const { data, error } = await supabase.from('maintenance_invoices')
        .select('*, vendor:vendors(name), driver:drivers(full_name)')
        .eq(col, id).order('in_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const total = (rows.data || []).reduce((a, r) => a + Number(r.total || 0), 0);

  return (
    <div className="card">
      <div className="card-pad small muted" style={{ paddingBottom: 8 }}>
        {rows.data?.length || 0} invoices · lifetime spend <b className="num">{money(total)}</b>
      </div>
      <table className="data">
        <thead><tr><th>In date</th><th>Invoice</th><th>Vendor</th><th>Driver</th><th>Status</th><th>Total</th><th>On company</th><th>On driver</th></tr></thead>
        <tbody>
          {(rows.data || []).map((m) => (
            <tr key={m.id} className="norow">
              <td>{d(m.in_date)}</td>
              <td className="num">{m.invoice_number || '—'}</td>
              <td>{m.vendor?.name || '—'}</td>
              <td className="small">{m.driver?.full_name || '—'}</td>
              <td><Chip value={m.status} /></td>
              <td className="num">{money(m.total)}</td>
              <td className="num">{money(m.on_company_total)}</td>
              <td className="num">{money(m.on_driver_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.data?.length === 0 && <Empty head="No maintenance history" sub="Repair invoices for this unit will collect here." />}
    </div>
  );
}

/* ---------------- repair cases ---------------- */

function CasesTab({ rows }) {
  const open = (rows || []).filter((c) => OPEN_CASES.includes(c.status));
  const past = (rows || []).filter((c) => !OPEN_CASES.includes(c.status));
  return (
    <>
      {open.length > 0 && (
        <>
          <div className="nav-section" style={{ padding: '0 0 8px' }}>Active</div>
          <div className="grid" style={{ gap: 8, marginBottom: 18 }}>
            {open.map((c) => <CaseRow key={c.id} c={c} active />)}
          </div>
        </>
      )}
      <div className="nav-section" style={{ padding: '0 0 8px' }}>Previous repairs</div>
      <div className="grid" style={{ gap: 8 }}>
        {past.map((c) => <CaseRow key={c.id} c={c} />)}
      </div>
      {(!rows || rows.length === 0) && (
        <div className="card"><Empty head="No repair cases"
          sub="Open a case from Fleet → Repair cases when a driver reports a problem on this unit." /></div>
      )}
    </>
  );
}

function CaseRow({ c, active }) {
  return (
    <div className="card card-pad" style={{
      padding: '11px 14px',
      borderLeft: `3px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
      background: active ? 'var(--accent-soft)' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <b className="num">#{c.case_number}</b>
        <b>{c.title}</b>
        <span className={`chip ${PRIORITY_CHIP[c.priority]} nodot`}>{c.priority}</span>
        <Chip value={c.status} />
        {c.down_unit && <span className="chip red">unit down</span>}
        <div style={{ flex: 1 }} />
        <span className="small muted">{ago(c.created_at)}</span>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {title(c.category)}
        {c.vendor?.name ? ` · ${c.vendor.name}` : ''}
        {c.driver?.full_name ? ` · ${c.driver.full_name}` : ''}
        {c.estimate_amount ? ` · est. ${money(c.estimate_amount)}` : ''}
        {c.resolved_at ? ` · resolved ${d(c.resolved_at)}` : ''}
      </div>
    </div>
  );
}

/* ---------------- condition photos ---------------- */

function ConditionTab({ kind, id, companyId }) {
  const { canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const editable = canEdit('fleet') || canEdit('maintenance');

  const photos = useQuery({
    queryKey: ['unit-condition', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('documents')
        .select('id, file_name, file_path, created_at')
        .eq('entity_type', kind).eq('entity_id', id).eq('doc_type', 'photo')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const upload = async (files) => {
    try {
      setBusy(true); setErr(null);
      for (const file of Array.from(files)) {
        const { path, name } = await uploadCompanyDoc(companyId, kind, id, file);
        const { error } = await supabase.from('documents').insert({
          company_id: companyId, entity_type: kind, entity_id: id, doc_type: 'photo',
          file_name: name, file_path: path, mime_type: file.type, size_bytes: file.size,
          uploaded_by: user?.id,
        });
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ['unit-condition', id] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head" style={{ marginBottom: 10 }}>
        <span className="small muted">Photos of the equipment — damage, condition at handover, tyres, interior.</span>
        <div className="spacer" />
        {editable && (
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            {busy ? 'Uploading…' : '+ Upload photos'}
            <input type="file" accept="image/*" multiple hidden
              onChange={(e) => e.target.files?.length && upload(e.target.files)} />
          </label>
        )}
      </div>
      <ErrorNote error={err || photos.error} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {(photos.data || []).map((p) => (
          <div key={p.id} className="card card-pad" style={{ padding: 10, cursor: 'pointer' }}
            onClick={() => openDoc(p.file_path)}>
            <div style={{ height: 90, borderRadius: 8, background: 'var(--surface-2)',
              display: 'grid', placeItems: 'center', fontSize: 26, marginBottom: 7 }}>🖼</div>
            <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.file_name}
            </div>
            <div className="feed-meta">{ago(p.created_at)}</div>
          </div>
        ))}
      </div>
      {photos.data?.length === 0 && (
        <div className="card"><Empty head="No condition files yet"
          sub="Upload walk-around photos when a unit is handed over, damaged, or comes back from the shop." /></div>
      )}
    </>
  );
}
