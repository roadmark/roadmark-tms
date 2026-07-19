import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { uploadCompanyDoc, openDoc } from '../../lib/storage';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { MAINT_STATUSES } from '../../data/enums';
import { money, d } from '../../lib/format';
import DeptFeed from '../../components/DeptFeed';

export default function Maintenance() {
  const { companyId, canEdit, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);   // null | 'new' | {inv} | {prefill, job}
  const [intake, setIntake] = useState(false);

  const invoices = useQuery({
    queryKey: ['maintenance', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('maintenance_invoices')
        .select(`id, invoice_number, unit_type, in_date, out_date, status, payment_type, payment_ref,
                 odometer, subtotal, tax, fees, total, on_company_total, on_driver_total, notes,
                 truck_id, trailer_id, driver_id, vendor_id, extraction_job_id,
                 truck:trucks(unit_number), trailer:trailers(unit_number),
                 driver:drivers(full_name), vendor:vendors(name)`)
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const editable = canEdit('maintenance');

  return (
    <>
      <div className="page-head">
        <h2>Maintenance invoices</h2>
        <div className="spacer" />
        {editable && (
          <>
            <button className="btn btn-ghost" onClick={() => setIntake(true)}>📄 New from invoice (AI)</button>
            <button className="btn btn-primary" onClick={() => setOpen('new')}>New invoice</button>
          </>
        )}
      </div>
      <ErrorNote error={invoices.error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr>
            <th>Invoice</th><th>Unit</th><th>Driver</th><th>Vendor</th><th>In date</th>
            <th>Status</th><th>Total</th><th>On company</th><th>On driver</th>
          </tr></thead>
          <tbody>
            {(invoices.data || []).map((m) => (
              <tr key={m.id} onClick={() => editable && setOpen({ inv: m })}>
                <td className="num">{m.invoice_number || '—'}</td>
                <td className="num">{m.truck?.unit_number || m.trailer?.unit_number || '—'}</td>
                <td>{m.driver?.full_name || '—'}</td>
                <td>{m.vendor?.name || '—'}</td>
                <td>{d(m.in_date)}</td>
                <td><Chip value={m.status} /></td>
                <td className="num">{money(m.total)}</td>
                <td className="num">{money(m.on_company_total)}</td>
                <td className="num" style={{ color: m.on_driver_total > 0 ? 'var(--maintenance)' : undefined }}>
                  {money(m.on_driver_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.data?.length === 0 && (
          <Empty head="No maintenance invoices yet"
            sub='Click "New from invoice (AI)" and drop a repair shop invoice — the header and task lines pre-fill for review.' />
        )}
      </div>
      <DeptFeed dept="maintenance" />

      {intake && (
        <RepairIntake onClose={() => setIntake(false)}
          onReady={(prefill, job) => { setIntake(false); setOpen({ prefill, job }); }} />
      )}
      {open && (
        <InvoiceDrawer
          inv={open === 'new' ? null : open.inv || null}
          prefill={open?.prefill || null}
          job={open?.job || null}
          onClose={() => setOpen(null)}
          companyId={companyId} userId={user?.id}
          onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['maintenance'] }); qc.invalidateQueries({ queryKey: ['deductions'] }); }}
        />
      )}
    </>
  );
}

/* ---------------- AI repair invoice intake ---------------- */

function RepairIntake({ onClose, onReady }) {
  const { companyId, user } = useAuth();
  const [phase, setPhase] = useState('pick');
  const [error, setError] = useState(null);
  const [jobRow, setJobRow] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const start = async (file) => {
    try {
      setPhase('uploading'); setError(null);
      const { path, name } = await uploadCompanyDoc(companyId, 'maintenance_invoice', 'intake', file);
      const { data: job, error: jErr } = await supabase.from('extraction_jobs')
        .insert({ company_id: companyId, kind: 'repair_invoice', status: 'pending',
                  file_path: path, file_name: name, created_by: user?.id })
        .select('*').single();
      if (jErr) throw jErr;
      setJobRow(job); setPhase('reading');
      const { error: fnErr } = await supabase.functions
        .invoke('extract-document', { body: { job_id: job.id } });
      if (fnErr) throw new Error(fnErr.message || 'Extraction function failed');
      timer.current = setInterval(async () => {
        const { data: j } = await supabase.from('extraction_jobs')
          .select('*').eq('id', job.id).single();
        if (!j) return;
        setJobRow(j);
        if (j.status === 'needs_review') {
          clearInterval(timer.current);
          onReady(j.extracted || {}, j);
        } else if (j.status === 'failed') {
          clearInterval(timer.current);
          setError(new Error(j.error || 'Extraction failed'));
          setPhase('failed');
        }
      }, 2000);
    } catch (e) { setError(e); setPhase('failed'); }
  };

  return (
    <Drawer title="New invoice from repair document" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cancel</button>}>
      <ErrorNote error={error} />
      {phase === 'pick' && (
        <>
          <p className="muted">Drop the shop's invoice (PDF or photo). The AI reads the
            header and every task line; you review, set On Company / On Driver per task,
            and save.</p>
          <input type="file" accept=".pdf,image/*"
            onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
        </>
      )}
      {phase === 'uploading' && <p>Uploading…</p>}
      {phase === 'reading' && <p><b>Reading the invoice…</b> <span className="muted small">Usually 5–20 seconds.</span></p>}
      {phase === 'failed' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setPhase('pick'); setError(null); }}>Try another file</button>
          {jobRow && <button className="btn btn-ghost" onClick={() => onReady({}, jobRow)}>Enter manually (keep document)</button>}
        </div>
      )}
    </Drawer>
  );
}

/* ---------------- invoice drawer ---------------- */

const emptyTask = () => ({ key: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0, amount: 0, charge_to: 'company' });

function InvoiceDrawer({ inv, prefill, job, onClose, onSaved, companyId, userId }) {
  const px = prefill || {};
  const [f, setF] = useState(() => ({
    invoice_number: inv?.invoice_number || px.invoice_number || '',
    unit_type: inv?.unit_type || 'truck',
    truck_id: inv?.truck_id || '',
    trailer_id: inv?.trailer_id || '',
    driver_id: inv?.driver_id || '',
    vendor_id: inv?.vendor_id || '',
    vendor_new: '',
    in_date: inv?.in_date || px.invoice_date || '',
    out_date: inv?.out_date || '',
    payment_type: inv?.payment_type || (px.payment_hint && px.payment_hint !== 'unknown' ? px.payment_hint : 'efs'),
    payment_ref: inv?.payment_ref || '',
    status: inv?.status || 'in_progress',
    odometer: inv?.odometer ?? px.odometer ?? '',
    tax: inv?.tax ?? px.tax ?? 0,
    fees: inv?.fees ?? px.fees ?? 0,
    notes: inv?.notes || '',
  }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const [tasks, setTasks] = useState(() =>
    Array.isArray(px.tasks) && px.tasks.length
      ? px.tasks.map((t) => ({ key: crypto.randomUUID(), description: t.description || '',
          quantity: Number(t.quantity) || 1, unit_price: Number(t.unit_price) || 0,
          amount: Number(t.amount) || (Number(t.quantity) || 1) * (Number(t.unit_price) || 0),
          charge_to: 'company' }))
      : [emptyTask()]);
  const [matched, setMatched] = useState(false);

  const { companyId: cid } = useAuth();
  const opts = useQuery({
    queryKey: ['maint-options', cid],
    queryFn: async () => {
      const [v, dr, t, tr] = await Promise.all([
        supabase.from('vendors').select('id,name').eq('company_id', cid).order('name'),
        supabase.from('drivers').select('id,full_name').eq('company_id', cid).order('full_name'),
        supabase.from('trucks').select('id,unit_number').eq('company_id', cid).order('unit_number'),
        supabase.from('trailers').select('id,unit_number').eq('company_id', cid).order('unit_number'),
      ]);
      for (const r of [v, dr, t, tr]) if (r.error) throw r.error;
      return { vendors: v.data, drivers: dr.data, trucks: t.data, trailers: tr.data };
    },
  });

  // load existing tasks when editing
  const existingTasks = useQuery({
    queryKey: ['maint-tasks', inv?.id],
    enabled: !!inv?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('maintenance_tasks')
        .select('id, description, quantity, unit_price, amount, charge_to')
        .eq('invoice_id', inv.id).order('created_at');
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (existingTasks.data?.length) {
      setTasks(existingTasks.data.map((t) => ({ key: t.id, ...t })));
    }
  }, [existingTasks.data]);

  // auto-match extracted vendor + unit
  useEffect(() => {
    if (matched || !opts.data || inv) return;
    const next = {};
    if (px.vendor_name && !f.vendor_id) {
      const want = px.vendor_name.toLowerCase();
      const hit = opts.data.vendors.find((v) =>
        v.name.toLowerCase().includes(want) || want.includes(v.name.toLowerCase()));
      if (hit) next.vendor_id = hit.id; else next.vendor_new = px.vendor_name;
    }
    if (px.unit_number) {
      const tHit = opts.data.trucks.find((t) => t.unit_number === String(px.unit_number));
      const trHit = !tHit && opts.data.trailers.find((t) => t.unit_number === String(px.unit_number));
      if (tHit) { next.unit_type = 'truck'; next.truck_id = tHit.id; }
      else if (trHit) { next.unit_type = 'trailer'; next.trailer_id = trHit.id; }
    }
    if (Object.keys(next).length) setF((p) => ({ ...p, ...next }));
    setMatched(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.data, matched]);

  const setTask = (key, k) => (e) => setTasks((ts) => ts.map((t) => {
    if (t.key !== key) return t;
    const val = k === 'description' || k === 'charge_to' ? e.target.value : Number(e.target.value);
    const nt = { ...t, [k]: val };
    if (k === 'quantity' || k === 'unit_price') nt.amount = Number((nt.quantity * nt.unit_price).toFixed(2));
    return nt;
  }));

  const subtotal = tasks.reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const total = subtotal + (Number(f.tax) || 0) + (Number(f.fees) || 0);
  const onDriver = tasks.filter((t) => t.charge_to === 'driver').reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const onCompany = total - onDriver; // tax & fees go on company

  const save = useMutation({
    mutationFn: async () => {
      // vendor: use selected or create the new one
      let vendorId = f.vendor_id || null;
      if (!vendorId && f.vendor_new.trim()) {
        const { data: v, error: vErr } = await supabase.from('vendors')
          .insert({ company_id: companyId, name: f.vendor_new.trim(),
                    city: px.vendor_city || null, state: px.vendor_state || null })
          .select('id').single();
        if (vErr) throw vErr;
        vendorId = v.id;
      }
      const row = {
        company_id: companyId,
        invoice_number: f.invoice_number || null,
        unit_type: f.unit_type,
        truck_id: f.unit_type === 'truck' ? (f.truck_id || null) : null,
        trailer_id: f.unit_type === 'trailer' ? (f.trailer_id || null) : null,
        driver_id: f.driver_id || null,
        vendor_id: vendorId,
        in_date: f.in_date || null,
        out_date: f.out_date || null,
        payment_type: f.payment_type || null,
        payment_ref: f.payment_ref || null,
        status: f.status,
        odometer: f.odometer ? Number(f.odometer) : null,
        subtotal, tax: Number(f.tax) || 0, fees: Number(f.fees) || 0, total,
        on_company_total: Number(onCompany.toFixed(2)),
        on_driver_total: Number(onDriver.toFixed(2)),
        notes: f.notes || null,
        extraction_job_id: job?.id || inv?.extraction_job_id || null,
      };
      if (f.unit_type === 'truck' && !row.truck_id) throw new Error('Pick the truck this invoice is for.');
      if (f.unit_type === 'trailer' && !row.trailer_id) throw new Error('Pick the trailer this invoice is for.');

      let invoiceId = inv?.id;
      if (inv) {
        const { error } = await supabase.from('maintenance_invoices')
          .update({ ...row, updated_by: userId }).eq('id', inv.id);
        if (error) throw error;
        await supabase.from('maintenance_tasks').delete().eq('invoice_id', inv.id);
      } else {
        const { data: created, error } = await supabase.from('maintenance_invoices')
          .insert({ ...row, created_by: userId }).select('id').single();
        if (error) throw error;
        invoiceId = created.id;
      }
      const taskRows = tasks.filter((t) => t.description.trim()).map((t) => ({
        invoice_id: invoiceId, company_id: companyId,
        description: t.description.trim(), quantity: Number(t.quantity) || 1,
        unit_price: Number(t.unit_price) || 0, amount: Number(t.amount) || 0,
        charge_to: t.charge_to,
      }));
      if (taskRows.length) {
        const { error: tErr } = await supabase.from('maintenance_tasks').insert(taskRows);
        if (tErr) throw tErr;
      }

      // attach document + close job (AI path, create only)
      if (job && !inv) {
        await supabase.from('documents').insert({
          company_id: companyId, entity_type: 'maintenance_invoice', entity_id: invoiceId,
          doc_type: 'invoice', file_name: job.file_name || 'invoice.pdf',
          file_path: job.file_path, extraction_job_id: job.id, uploaded_by: userId,
        });
        await supabase.from('extraction_jobs').update({
          status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString(),
          applied_entity_type: 'maintenance_invoice', applied_entity_id: invoiceId,
        }).eq('id', job.id);
      }

      // driver-charged portion -> deduction (create only, avoid duplicates on edit)
      if (!inv && onDriver > 0 && f.driver_id) {
        const vendorName = (opts.data?.vendors.find((v) => v.id === vendorId)?.name)
          || f.vendor_new.trim() || 'Vendor';
        const desc = `${(f.payment_type || 'efs').toUpperCase()}-Repair-${vendorName}-${f.invoice_number || 'no-inv'}`;
        const { error: dErr } = await supabase.from('deductions').insert({
          company_id: companyId, driver_id: f.driver_id,
          truck_id: f.unit_type === 'truck' ? (f.truck_id || null) : null,
          trailer_id: f.unit_type === 'trailer' ? (f.trailer_id || null) : null,
          issued_date: f.in_date || new Date().toISOString().slice(0, 10),
          charge_to: 'driver', category: 'maintenance', description: desc,
          amount: Number(onDriver.toFixed(2)), total: Number(onDriver.toFixed(2)),
          source_maintenance_invoice_id: invoiceId, created_by: userId,
        });
        if (dErr) throw dErr;
      }
      return invoiceId;
    },
    onSuccess: onSaved,
  });

  const o = opts.data;
  return (
    <Drawer title={inv ? `Invoice ${inv.invoice_number || ''}` : job ? 'Review extracted invoice' : 'New maintenance invoice'}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : inv ? 'Save changes' : 'Save invoice'}
        </button>
      </>}>
      <ErrorNote error={save.error || opts.error} />

      {job && !inv && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, padding: '10px 12px' }}>
          <b>AI pre-filled from the invoice — review the header and every task line.</b>
          <div className="small">Mark each task On Company or On Driver. The driver's share
            automatically becomes a deduction on save.</div>
          <button className="btn btn-ghost" style={{ marginTop: 6 }}
            onClick={() => openDoc(job.file_path)}>Open the document</button>
        </div>
      )}

      <div className="frow">
        <Field label="Invoice #"><input value={f.invoice_number} onChange={set('invoice_number')} /></Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            {MAINT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Unit type">
          <select value={f.unit_type} onChange={set('unit_type')}>
            <option value="truck">truck</option><option value="trailer">trailer</option>
          </select>
        </Field>
        {f.unit_type === 'truck' ? (
          <Field label="Truck">
            <select value={f.truck_id} onChange={set('truck_id')}>
              <option value="">—</option>
              {(o?.trucks || []).map((x) => <option key={x.id} value={x.id}>{x.unit_number}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Trailer">
            <select value={f.trailer_id} onChange={set('trailer_id')}>
              <option value="">—</option>
              {(o?.trailers || []).map((x) => <option key={x.id} value={x.id}>{x.unit_number}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="frow">
        <Field label="Driver (for On Driver charges)">
          <select value={f.driver_id} onChange={set('driver_id')}>
            <option value="">—</option>
            {(o?.drivers || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select>
        </Field>
        <Field label="Vendor">
          <select value={f.vendor_id} onChange={(e) => setF((p) => ({ ...p, vendor_id: e.target.value, vendor_new: '' }))}>
            <option value="">— {f.vendor_new ? `(new: ${f.vendor_new})` : ''}</option>
            {(o?.vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      </div>
      {!f.vendor_id && (
        <Field label="…or new vendor name">
          <input value={f.vendor_new} onChange={set('vendor_new')} placeholder="Shop name — will be created" />
        </Field>
      )}
      <div className="frow">
        <Field label="In date"><input type="date" value={f.in_date} onChange={set('in_date')} /></Field>
        <Field label="Out date"><input type="date" value={f.out_date} onChange={set('out_date')} /></Field>
      </div>
      <div className="frow">
        <Field label="Payment type">
          <select value={f.payment_type} onChange={set('payment_type')}>
            {['efs', 'credit_card', 'bank', 'cash', 'check', 'other'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Payment ref / money code"><input value={f.payment_ref} onChange={set('payment_ref')} /></Field>
      </div>
      <Field label="Odometer"><input type="number" value={f.odometer} onChange={set('odometer')} /></Field>

      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, margin: '14px 0 8px' }}>Tasks</h3>
      {tasks.map((t) => (
        <div key={t.key} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <Field label="Description">
            <input value={t.description} onChange={setTask(t.key, 'description')} />
          </Field>
          <div className="frow">
            <Field label="Qty"><input type="number" step="0.01" value={t.quantity} onChange={setTask(t.key, 'quantity')} /></Field>
            <Field label="Unit price"><input type="number" step="0.01" value={t.unit_price} onChange={setTask(t.key, 'unit_price')} /></Field>
          </div>
          <div className="frow">
            <Field label="Amount"><input type="number" step="0.01" value={t.amount} onChange={setTask(t.key, 'amount')} /></Field>
            <Field label="Charge to">
              <select value={t.charge_to} onChange={setTask(t.key, 'charge_to')}
                style={{ borderColor: t.charge_to === 'driver' ? 'var(--maintenance)' : undefined }}>
                <option value="company">On Company</option>
                <option value="driver">On Driver</option>
              </select>
            </Field>
          </div>
          <button className="btn btn-danger" onClick={() => setTasks((ts) => ts.filter((x) => x.key !== t.key))}>
            Remove task
          </button>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => setTasks((ts) => [...ts, emptyTask()])}>+ Add task</button>

      <div className="frow" style={{ marginTop: 12 }}>
        <Field label="Tax"><input type="number" step="0.01" value={f.tax} onChange={set('tax')} /></Field>
        <Field label="Fees"><input type="number" step="0.01" value={f.fees} onChange={set('fees')} /></Field>
      </div>
      <div className="card-pad" style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 12px' }}>
        <div className="frow small">
          <div>Subtotal: <b className="num">{money(subtotal)}</b></div>
          <div>Total: <b className="num">{money(total)}</b></div>
        </div>
        <div className="frow small" style={{ marginTop: 4 }}>
          <div>On Company: <b className="num">{money(onCompany)}</b> <span className="muted">(incl. tax/fees)</span></div>
          <div>On Driver: <b className="num" style={{ color: 'var(--maintenance)' }}>{money(onDriver)}</b></div>
        </div>
        {onDriver > 0 && !inv && (
          <div className="small" style={{ marginTop: 6 }}>
            {f.driver_id
              ? '✓ Saving will create a driver deduction for the On Driver amount.'
              : '⚠ Pick the driver above, or the On Driver amount will not create a deduction.'}
          </div>
        )}
      </div>
      <Field label="Notes"><textarea rows={2} value={f.notes} onChange={set('notes')} style={{ marginTop: 10 }} /></Field>
    </Drawer>
  );
}
