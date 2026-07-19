import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { uploadCompanyDoc, openDoc } from '../../lib/storage';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { LOAD_STATUSES } from '../../data/enums';
import BrokerEmail from '../../components/BrokerEmail';
import { useLoadDocChips, DocChips } from '../../components/ChipStrips';
import PageHead from '../../components/PageHead';
import { money, dt } from '../../lib/format';

const LOAD_COLS = `id, load_number, status, customer_load_id, dispatcher_id, pickup_time, delivery_time,
  pickup_location, delivery_location, loaded_miles, empty_miles, total_miles,
  freight_amount, driver_rate, weight_lbs, notes,
  customer:customers(id, name),
  driver:drivers!loads_driver_id_fkey(id, full_name),
  truck:trucks(id, unit_number),
  trailer:trailers(id, unit_number)`;

export default function Loads() {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(null);      // null | 'new' | {load} | {prefill, job}
  const [intake, setIntake] = useState(false); // rate-con intake drawer
  const docChips = useLoadDocChips();

  const loads = useQuery({
    queryKey: ['loads', companyId, statusFilter],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('loads').select(LOAD_COLS)
        .eq('company_id', companyId)
        .order('load_number', { ascending: false }).limit(100);
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const editable = canEdit('dispatch') || canEdit('accounting');

  return (
    <>
      <PageHead title="Loads" stats={[{ v: loads.data?.length ?? 0, l: 'in view' }]}>
        <select className="company-switch" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {LOAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {editable && (
          <>
            <button className="btn btn-ghost" onClick={() => setIntake(true)}>
              📄 New from rate con (AI)
            </button>
            <button className="btn btn-primary" onClick={() => setOpen('new')}>+ New load</button>
          </>
        )}
      </PageHead>
      <ErrorNote error={loads.error} />
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>#</th><th>Status</th><th>Docs</th><th>Customer</th><th>Ref</th><th>Pickup</th>
              <th>Delivery</th><th>Driver</th><th>Truck</th><th>Miles</th><th>Rate</th><th>Driver rate</th>
            </tr>
          </thead>
          <tbody>
            {(loads.data || []).map((l) => (
              <tr key={l.id} onClick={() => editable && setOpen({ load: l })}>
                <td className="num">{l.load_number}</td>
                <td><Chip value={l.status} /></td>
                <td><DocChips docs={docChips.data?.[l.id]} /></td>
                <td>{l.customer?.name || '—'}</td>
                <td>{l.customer_load_id || '—'}</td>
                <td>{l.pickup_location || '—'}<div className="small muted">{dt(l.pickup_time)}</div></td>
                <td>{l.delivery_location || '—'}<div className="small muted">{dt(l.delivery_time)}</div></td>
                <td>{l.driver?.full_name || '—'}</td>
                <td className="num">{l.truck?.unit_number || '—'}</td>
                <td className="num">{l.total_miles || 0}</td>
                <td className="num">{money(l.freight_amount)}</td>
                <td className="num">{money(l.driver_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loads.data?.length === 0 && <Empty head="No loads yet" sub='Click "New load", or drop a rate confirmation on "New from rate con".' />}
      </div>

      {intake && (
        <RateConIntake
          onClose={() => setIntake(false)}
          onReady={(prefill, job) => { setIntake(false); setOpen({ prefill, job }); }}
        />
      )}

      {open && (
        <LoadDrawer
          load={open === 'new' ? null : open.load || null}
          prefill={open?.prefill || null}
          job={open?.job || null}
          onClose={() => setOpen(null)}
          companyId={companyId} userId={user?.id}
          onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['loads'] }); }}
        />
      )}
    </>
  );
}

/* ---------------- AI rate-con intake ---------------- */

function RateConIntake({ onClose, onReady }) {
  const { companyId, user } = useAuth();
  const [phase, setPhase] = useState('pick');  // pick -> uploading -> reading -> failed
  const [error, setError] = useState(null);
  const [jobRow, setJobRow] = useState(null);
  const fileRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const start = async (file) => {
    try {
      setPhase('uploading'); setError(null);
      const { path, name } = await uploadCompanyDoc(companyId, 'load', 'intake', file);
      const { data: job, error: jErr } = await supabase.from('extraction_jobs')
        .insert({
          company_id: companyId, kind: 'rate_confirmation', status: 'pending',
          file_path: path, file_name: name, created_by: user?.id,
        })
        .select('*').single();
      if (jErr) throw jErr;
      setJobRow(job);
      setPhase('reading');
      const { error: fnErr } = await supabase.functions
        .invoke('extract-document', { body: { job_id: job.id } });
      if (fnErr) throw new Error(fnErr.message || 'Extraction function failed — is it deployed?');
      timer.current = setInterval(async () => {
        const { data: j } = await supabase.from('extraction_jobs')
          .select('*').eq('id', job.id).single();
        if (!j) return;
        setJobRow(j);
        if (j.status === 'needs_review') {
          clearInterval(timer.current);
          onReady(toPrefill(j.extracted), j);
        } else if (j.status === 'failed') {
          clearInterval(timer.current);
          setError(new Error(j.error || 'Extraction failed'));
          setPhase('failed');
        }
      }, 2000);
    } catch (e) {
      setError(e); setPhase('failed');
    }
  };

  return (
    <Drawer title="New load from rate confirmation" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cancel</button>}>
      <ErrorNote error={error} />
      {phase === 'pick' && (
        <>
          <p className="muted">Drop the broker's rate confirmation (PDF or photo).
            The AI reads it, pre-fills the load form, and you review before anything is created.</p>
          <input ref={fileRef} type="file" accept=".pdf,image/*"
            onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
        </>
      )}
      {phase === 'uploading' && <p>Uploading document…</p>}
      {phase === 'reading' && (
        <>
          <p><b>Reading the rate con…</b></p>
          <p className="muted small">Extracting customer, rate, stops, appointment times.
            Usually 5–15 seconds.</p>
        </>
      )}
      {phase === 'failed' && (
        <>
          <p>The document couldn't be read automatically.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => { setPhase('pick'); setError(null); }}>
              Try another file
            </button>
            {jobRow && (
              <button className="btn btn-ghost"
                onClick={() => onReady({}, jobRow)}>Enter manually (keep document)</button>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

/** Map the extraction JSON onto load-form fields. */
function toPrefill(x) {
  if (!x) return {};
  const stops = Array.isArray(x.stops) ? x.stops : [];
  const pickups = stops.filter((s) => s.stop_type === 'pickup');
  const dels = stops.filter((s) => s.stop_type === 'delivery');
  const p = pickups[0], dLast = dels[dels.length - 1];
  const loc = (s) => s ? [s.city, s.state].filter(Boolean).join(', ') || s.location_name || '' : '';
  const localInput = (iso) => {
    if (!iso) return '';
    const t = new Date(iso);
    if (isNaN(t)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  };
  const conf = x.confidence || {};
  const low = Object.entries(conf).filter(([, v]) => Number(v) < 0.8).map(([k]) => k);
  return {
    customer_name: x.customer_name || '',
    customer_load_id: x.customer_load_id || '',
    freight_amount: Number(x.freight_amount) || 0,
    pickup_location: loc(p),
    pickup_time: localInput(p ? p.scheduled_at : null),
    delivery_location: loc(dLast) + (dels.length > 1 ? ` (+${dels.length - 1})` : ''),
    delivery_time: localInput(dLast ? dLast.scheduled_at : null),
    weight_lbs: x.weight_lbs || '',
    notes: [x.commodity, x.temperature && `Temp: ${x.temperature}`, x.notes]
      .filter(Boolean).join(' · '),
    _lowConfidence: low,
    _stops: stops,
  };
}

/* ---------------- load drawer (manual + review modes) ---------------- */

function LoadDrawer({ load, prefill, job, onClose, onSaved, companyId, userId }) {
  const [f, setF] = useState(() => ({
    status: load?.status || 'scheduled',
    customer_id: load?.customer?.id || '',
    customer_load_id: load?.customer_load_id || prefill?.customer_load_id || '',
    dispatcher_id: load?.dispatcher_id || userId || '',
    driver_id: load?.driver?.id || '',
    truck_id: load?.truck?.id || '',
    trailer_id: load?.trailer?.id || '',
    pickup_location: load?.pickup_location || prefill?.pickup_location || '',
    pickup_time: load?.pickup_time?.slice(0, 16) || prefill?.pickup_time || '',
    delivery_location: load?.delivery_location || prefill?.delivery_location || '',
    delivery_time: load?.delivery_time?.slice(0, 16) || prefill?.delivery_time || '',
    loaded_miles: load?.loaded_miles ?? 0,
    empty_miles: load?.empty_miles ?? 0,
    freight_amount: load?.freight_amount ?? prefill?.freight_amount ?? 0,
    driver_rate: load?.driver_rate ?? 0,
    weight_lbs: load?.weight_lbs ?? prefill?.weight_lbs ?? '',
    notes: load?.notes || prefill?.notes || '',
  }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const [matchedName, setMatchedName] = useState(false);

  const { companyId: cid, canEdit } = useAuth();
  const opts = useQuery({
    queryKey: ['load-options', cid],
    queryFn: async () => {
      const [c, dr, t, tr, mem] = await Promise.all([
        supabase.from('customers').select('id,name').eq('company_id', cid).order('name'),
        supabase.from('drivers').select('id,full_name').eq('company_id', cid).in('status', ['active', 'ready']).order('full_name'),
        supabase.from('trucks').select('id,unit_number').eq('company_id', cid).order('unit_number'),
        supabase.from('trailers').select('id,unit_number').eq('company_id', cid).order('unit_number'),
        supabase.from('company_members').select('user_id, profiles(full_name, email)').eq('company_id', cid),
      ]);
      for (const r of [c, dr, t, tr]) if (r.error) throw r.error;
      return { customers: c.data, drivers: dr.data, trucks: t.data, trailers: tr.data,
        members: (mem.data || []).map((m) => ({ id: m.user_id, name: m.profiles?.full_name || m.profiles?.email || 'user' })) };
    },
  });

  useEffect(() => {
    if (matchedName || !prefill?.customer_name || !opts.data || f.customer_id) return;
    const want = prefill.customer_name.toLowerCase();
    const hit = opts.data.customers.find((c) =>
      c.name.toLowerCase().includes(want) || want.includes(c.name.toLowerCase()));
    if (hit) setF((p) => ({ ...p, customer_id: hit.id }));
    setMatchedName(true);
  }, [opts.data, prefill, matchedName, f.customer_id]);

  // picking a driver pulls in their currently assigned truck + trailer
  const pickDriver = async (e) => {
    const driver_id = e.target.value;
    setF((p) => ({ ...p, driver_id }));
    if (!driver_id) return;
    const { data } = await supabase.from('assignments')
      .select('truck_id, trailer_id')
      .eq('company_id', companyId).eq('driver_id', driver_id)
      .is('ended_at', null).maybeSingle();
    if (data) setF((p) => ({
      ...p,
      truck_id: data.truck_id || p.truck_id,
      trailer_id: data.trailer_id || p.trailer_id,
    }));
  };

  const docs = useQuery({
    queryKey: ['load-docs', load?.id],
    enabled: !!load?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('documents')
        .select('id, doc_type, file_name, file_path, created_at')
        .eq('entity_type', 'load').eq('entity_id', load.id)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
  const qc = useQueryClient();
  const [docType, setDocType] = useState('pod');
  const attachDoc = async (file) => {
    const { path, name } = await uploadCompanyDoc(companyId, 'load', load.id, file);
    const { error } = await supabase.from('documents').insert({
      company_id: companyId, entity_type: 'load', entity_id: load.id,
      doc_type: docType, file_name: name, file_path: path,
      mime_type: file.type, size_bytes: file.size, uploaded_by: userId,
    });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['load-docs', load.id] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        company_id: companyId,
        status: f.status,
        customer_id: f.customer_id || null,
        customer_load_id: f.customer_load_id || null,
        dispatcher_id: f.dispatcher_id || null,
        driver_id: f.driver_id || null,
        truck_id: f.truck_id || null,
        trailer_id: f.trailer_id || null,
        pickup_location: f.pickup_location || null,
        pickup_time: f.pickup_time ? new Date(f.pickup_time).toISOString() : null,
        delivery_location: f.delivery_location || null,
        delivery_time: f.delivery_time ? new Date(f.delivery_time).toISOString() : null,
        loaded_miles: Number(f.loaded_miles) || 0,
        empty_miles: Number(f.empty_miles) || 0,
        freight_amount: Number(f.freight_amount) || 0,
        driver_rate: Number(f.driver_rate) || 0,
        weight_lbs: f.weight_lbs ? Number(f.weight_lbs) : null,
        notes: f.notes || null,
      };
      if (load) {
        const { error } = await supabase.from('loads')
          .update({ ...row, updated_by: userId }).eq('id', load.id);
        if (error) throw error;
        return load.id;
      }
      const { data: created, error } = await supabase.from('loads')
        .insert({ ...row, created_by: userId }).select('id').single();
      if (error) throw error;
      // multi-stop: store every stop the AI found
      const aiStops = prefill?._stops || [];
      if (aiStops.length) {
        const rows = aiStops.map((st, i) => ({
          load_id: created.id, company_id: companyId, seq: i + 1,
          stop_type: st.stop_type === 'delivery' ? 'delivery' : 'pickup',
          location_name: st.location_name || null,
          city: st.city || null, state: st.state || null,
          appointment_type: st.appointment_type === 'fcfs' ? 'fcfs' : 'appt',
          scheduled_at: st.scheduled_at ? new Date(st.scheduled_at).toISOString() : null,
        }));
        await supabase.from('load_stops').insert(rows);
      }
      if (job) {
        await supabase.from('documents').insert({
          company_id: companyId, entity_type: 'load', entity_id: created.id,
          doc_type: 'rate_con', file_name: job.file_name || 'rate_con.pdf',
          file_path: job.file_path, extraction_job_id: job.id, uploaded_by: userId,
        });
        await supabase.from('extraction_jobs').update({
          status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString(),
          applied_entity_type: 'load', applied_entity_id: created.id,
        }).eq('id', job.id);
      }
      return created.id;
    },
    onSuccess: onSaved,
  });

  const low = prefill?._lowConfidence || [];
  const heading = load ? `Load #${load.load_number}`
    : job ? 'Review extracted load' : 'New load';

  return (
    <Drawer title={heading} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : (load ? 'Save changes' : job ? 'Create load + attach rate con' : 'Create load')}
        </button>
      </>}>
      <ErrorNote error={save.error || opts.error} />

      {job && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, padding: '10px 12px' }}>
          <b>AI pre-filled from the rate con — review every field.</b>
          {prefill?.customer_name && !f.customer_id && (
            <div className="small">Customer "{prefill.customer_name}" isn't in your list —
              pick one below or add it under Customers first.</div>
          )}
          {low.length > 0 && (
            <div className="small">Double-check (lower confidence): {low.join(', ')}</div>
          )}
          <button className="btn btn-ghost" style={{ marginTop: 6 }}
            onClick={() => openDoc(job.file_path)}>Open the document</button>
        </div>
      )}

      <div className="frow">
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {LOAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Customer reference #">
          <input value={f.customer_load_id} onChange={set('customer_load_id')} placeholder="M-28143" />
        </Field>
      </div>
      <Field label="Dispatcher">
        <select value={f.dispatcher_id} onChange={set('dispatcher_id')}>
          <option value="">—</option>
          {(opts.data?.members || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="Customer (broker)">
        <select value={f.customer_id} onChange={set('customer_id')}>
          <option value="">—</option>
          {(opts.data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="frow">
        <Field label="Driver">
          <select value={f.driver_id} onChange={pickDriver}>
            <option value="">—</option>
            {(opts.data?.drivers || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select>
        </Field>
        <Field label="Truck">
          <select value={f.truck_id} onChange={set('truck_id')}>
            <option value="">—</option>
            {(opts.data?.trucks || []).map((x) => <option key={x.id} value={x.id}>{x.unit_number}</option>)}
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Trailer">
          <select value={f.trailer_id} onChange={set('trailer_id')}>
            <option value="">—</option>
            {(opts.data?.trailers || []).map((x) => <option key={x.id} value={x.id}>{x.unit_number}</option>)}
          </select>
        </Field>
        <Field label="Weight (lbs)">
          <input type="number" value={f.weight_lbs} onChange={set('weight_lbs')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Pickup — city, state">
          <input value={f.pickup_location} onChange={set('pickup_location')} placeholder="Houston, TX" />
        </Field>
        <Field label="Pickup time">
          <input type="datetime-local" value={f.pickup_time} onChange={set('pickup_time')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Delivery — city, state">
          <input value={f.delivery_location} onChange={set('delivery_location')} placeholder="Rochester, NY" />
        </Field>
        <Field label="Delivery time">
          <input type="datetime-local" value={f.delivery_time} onChange={set('delivery_time')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Loaded miles">
          <input type="number" value={f.loaded_miles} onChange={set('loaded_miles')} />
        </Field>
        <Field label="Empty miles">
          <input type="number" value={f.empty_miles} onChange={set('empty_miles')} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Freight amount ($)">
          <input type="number" step="0.01" value={f.freight_amount} onChange={set('freight_amount')} />
        </Field>
        <Field label="Driver rate ($)">
          <input type="number" step="0.01" value={f.driver_rate} onChange={set('driver_rate')} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} value={f.notes} onChange={set('notes')} />
      </Field>

      {load && <BrokerEmail loadId={load.id} />}

      {load && <StopsEditor loadId={load.id} companyId={companyId} />}

      {load && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '14px 0' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, margin: '0 0 8px' }}>Documents</h3>
          <ErrorNote error={docs.error} />
          {(docs.data || []).map((doc) => (
            <div key={doc.id} className="feed-item" style={{ padding: '8px 2px' }}>
              <span className="chip gray">{doc.doc_type}</span>
              <div style={{ flex: 1 }} className="small">{doc.file_name}</div>
              <button className="btn btn-ghost" onClick={() => openDoc(doc.file_path)}>Open</button>
            </div>
          ))}
          {docs.data?.length === 0 && <p className="small muted">No documents attached yet.</p>}
          {(canEdit('dispatch') || canEdit('accounting')) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 7 }}>
                {['pod', 'bol', 'lumper', 'rate_con', 'invoice', 'photo', 'other'].map((t) =>
                  <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="file" accept=".pdf,image/*"
                onChange={(e) => e.target.files?.[0] && attachDoc(e.target.files[0]).catch((err) => alert(err.message))} />
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}


/* ---------------- stops editor ---------------- */

function StopsEditor({ loadId, companyId }) {
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ stop_type: 'delivery', city: '', state: '', location_name: '',
    appointment_type: 'appt', scheduled_at: '' });
  const setNv = (k) => (e) => setN((p) => ({ ...p, [k]: e.target.value }));

  const stops = useQuery({
    queryKey: ['load-stops', loadId],
    queryFn: async () => {
      const { data, error } = await supabase.from('load_stops')
        .select('id, seq, stop_type, location_name, city, state, appointment_type, scheduled_at')
        .eq('load_id', loadId).order('seq');
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['load-stops', loadId] });
    qc.invalidateQueries({ queryKey: ['loads'] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const seq = (stops.data?.length || 0) + 1;
      const { error } = await supabase.from('load_stops').insert({
        load_id: loadId, company_id: companyId, seq,
        stop_type: n.stop_type,
        location_name: n.location_name || null,
        city: n.city || null, state: n.state || null,
        appointment_type: n.appointment_type,
        scheduled_at: n.scheduled_at ? new Date(n.scheduled_at).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAdding(false);
      setN({ stop_type: 'delivery', city: '', state: '', location_name: '', appointment_type: 'appt', scheduled_at: '' });
      refresh();
    },
  });

  const del = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('load_stops').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const editable = canEdit('dispatch') || canEdit('accounting');

  return (
    <>
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '14px 0' }} />
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, margin: '0 0 8px' }}>Stops</h3>
      <ErrorNote error={stops.error || add.error || del.error} />
      {(stops.data || []).map((st) => (
        <div key={st.id} className="feed-item" style={{ padding: '8px 2px' }}>
          <span className={`chip ${st.stop_type === 'pickup' ? 'blue' : 'green'}`}>{st.seq}. {st.stop_type}</span>
          <div style={{ flex: 1 }}>
            <div className="small" style={{ fontWeight: 600 }}>
              {[st.city, st.state].filter(Boolean).join(', ') || st.location_name || '—'}
            </div>
            <div className="small muted">
              {st.appointment_type === 'fcfs' ? 'FCFS' : 'Appointment'} · {dt(st.scheduled_at)}
            </div>
          </div>
          {editable && (
            <button className="btn btn-ghost" onClick={() => del.mutate(st.id)}>Remove</button>
          )}
        </div>
      ))}
      {stops.data?.length === 0 && (
        <p className="small muted">No stops recorded. Adding a pickup and a delivery updates
          the load's route and the "(+n)" multi-stop label automatically.</p>
      )}
      {editable && !adding && (
        <button className="btn btn-ghost" onClick={() => setAdding(true)}>+ Add stop</button>
      )}
      {adding && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 8 }}>
          <div className="frow">
            <Field label="Type">
              <select value={n.stop_type} onChange={setNv('stop_type')}>
                <option value="pickup">pickup</option><option value="delivery">delivery</option>
              </select>
            </Field>
            <Field label="Appointment">
              <select value={n.appointment_type} onChange={setNv('appointment_type')}>
                <option value="appt">Appointment</option><option value="fcfs">FCFS</option>
              </select>
            </Field>
          </div>
          <div className="frow">
            <Field label="City"><input value={n.city} onChange={setNv('city')} /></Field>
            <Field label="State"><input value={n.state} onChange={setNv('state')} maxLength={2} /></Field>
          </div>
          <Field label="Facility / shipper name">
            <input value={n.location_name} onChange={setNv('location_name')} />
          </Field>
          <Field label="Scheduled">
            <input type="datetime-local" value={n.scheduled_at} onChange={setNv('scheduled_at')} />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={add.isPending} onClick={() => add.mutate()}>Add stop</button>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
