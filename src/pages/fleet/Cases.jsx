import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { uploadCompanyDoc, openDoc } from '../../lib/storage';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { ago, money, title } from '../../lib/format';
import DeptFeed from '../../components/DeptFeed';

const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['created', 'diagnostics', 'awaiting_approval', 'repair', 'resolved', 'closed', 'cancelled'];
const CATEGORIES = ['engine', 'brakes', 'tires', 'electrical', 'refrigeration', 'aftertreatment',
  'cooling', 'suspension', 'transmission', 'body', 'trailer', 'pm_service', 'other'];

const PRIORITY_CHIP = { critical: 'red', high: 'orange', medium: 'blue', low: 'gray' };
const STATUS_CHIP = {
  created: 'gray', diagnostics: 'blue', awaiting_approval: 'purple', repair: 'amber',
  resolved: 'green', closed: 'gray', cancelled: 'gray',
};
const OPEN_STATUSES = ['created', 'diagnostics', 'awaiting_approval', 'repair'];

export default function Cases() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState('board');
  const [scope, setScope] = useState('open');
  const [priority, setPriority] = useState('');
  const [open, setOpen] = useState(null);
  const editable = canEdit('maintenance') || canEdit('fleet') || canEdit('dispatch') || canEdit('safety');

  const cases = useQuery({
    queryKey: ['cases', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_cases')
        .select(`*, truck:trucks(unit_number), trailer:trailers(unit_number),
                 driver:drivers(full_name), vendor:vendors(name)`)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      return data;
    },
  });

  const lastComments = useQuery({
    queryKey: ['case-last-comments', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('case_comments')
        .select('case_id, body, kind, created_at')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(400);
      if (error) throw error;
      const m = {};
      for (const c of data) if (!m[c.case_id]) m[c.case_id] = c;
      return m;
    },
  });

  const rows = useMemo(() => {
    let list = cases.data || [];
    if (scope === 'open') list = list.filter((c) => OPEN_STATUSES.includes(c.status));
    if (scope === 'down') list = list.filter((c) => c.down_unit && OPEN_STATUSES.includes(c.status));
    if (scope === 'closed') list = list.filter((c) => !OPEN_STATUSES.includes(c.status));
    if (priority) list = list.filter((c) => c.priority === priority);
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...list].sort((a, b) => rank[a.priority] - rank[b.priority] ||
      new Date(b.created_at) - new Date(a.created_at));
  }, [cases.data, scope, priority]);

  const counts = useMemo(() => {
    const all = cases.data || [];
    const openList = all.filter((c) => OPEN_STATUSES.includes(c.status));
    return {
      open: openList.length,
      down: openList.filter((c) => c.down_unit).length,
      closed: all.length - openList.length,
      byPriority: Object.fromEntries(PRIORITIES.map((p) =>
        [p, openList.filter((c) => c.priority === p).length])),
    };
  }, [cases.data]);

  return (
    <>
      <div className="page-head">
        <h2>Cases</h2>
        <div className="seg">
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        </div>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>+ New case</button>}
      </div>

      <div className="grid cols-5" style={{ marginBottom: 14 }}>
        <Kpi label="Open cases" v={counts.open} />
        <Kpi label="Units down" v={counts.down} tone="var(--danger)" />
        <Kpi label="Critical" v={counts.byPriority.critical} tone="var(--danger)" />
        <Kpi label="High" v={counts.byPriority.high} tone="var(--warn)" />
        <Kpi label="Resolved" v={counts.closed} tone="var(--ok)" />
      </div>

      <div className="filter-row">
        {[['open', 'Open'], ['down', 'Units down'], ['closed', 'Resolved / closed'], ['', 'All']].map(([v, l]) => (
          <span key={v || 'all'} className={`chip gray nodot ${scope === v ? 'on' : ''}`}
            onClick={() => setScope(v)}>{l}</span>
        ))}
        <span style={{ width: 12 }} />
        {PRIORITIES.map((p) => (
          <span key={p} className={`chip ${PRIORITY_CHIP[p]} ${priority === p ? 'on' : ''}`}
            onClick={() => setPriority(priority === p ? '' : p)}>{p}</span>
        ))}
        <div style={{ flex: 1 }} />
        <span className="small muted">{rows.length} shown</span>
      </div>

      <ErrorNote error={cases.error} />

      {view === 'board' ? (
        <div className="case-grid">
          {rows.map((c) => {
            const last = lastComments.data?.[c.id];
            return (
              <div key={c.id} className={`case-card p-${c.priority}`} onClick={() => setOpen({ row: c })}>
                <div className="row">
                  <span className="chip blue nodot">
                    {c.unit_type === 'truck' ? 'TRUCK' : 'TRAILER'}{' '}
                    {c.truck?.unit_number || c.trailer?.unit_number || '—'}
                  </span>
                  <div className="spacer" />
                  <span className={`chip ${PRIORITY_CHIP[c.priority]} nodot`}>{c.priority}</span>
                </div>
                <h4>{c.title}</h4>
                <div className="row">
                  <span className={`chip ${STATUS_CHIP[c.status]}`}>{title(c.status)}</span>
                  <span className="chip gray nodot">{title(c.category)}</span>
                  {c.down_unit && <span className="chip red">down</span>}
                </div>
                {last ? (
                  <div className="case-note">
                    <div className="lbl">Last comment</div>
                    {last.body.length > 90 ? last.body.slice(0, 90) + '…' : last.body}
                  </div>
                ) : <div className="small muted">No comments yet</div>}
                <div className="case-foot">
                  #{c.case_number} · {ago(c.created_at)}
                  {c.driver?.full_name ? ` · ${c.driver.full_name}` : ''}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="card" style={{ gridColumn: '1/-1' }}>
              <Empty head="No cases here"
                sub="Open a case when a driver reports a problem — it tracks through diagnosis, approval and repair, and the shop invoice attaches at the end." />
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead><tr>
              <th>#</th><th>Unit</th><th>Title</th><th>Priority</th><th>Status</th>
              <th>Category</th><th>Driver</th><th>Vendor</th><th>Opened</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setOpen({ row: c })}>
                  <td className="num">{c.case_number}</td>
                  <td className="num">{c.truck?.unit_number || c.trailer?.unit_number || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{c.title}{c.down_unit && <span className="chip red" style={{ marginLeft: 6 }}>down</span>}</td>
                  <td><span className={`chip ${PRIORITY_CHIP[c.priority]} nodot`}>{c.priority}</span></td>
                  <td><span className={`chip ${STATUS_CHIP[c.status]}`}>{title(c.status)}</span></td>
                  <td className="small">{title(c.category)}</td>
                  <td className="small">{c.driver?.full_name || '—'}</td>
                  <td className="small">{c.vendor?.name || '—'}</td>
                  <td className="small">{ago(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty head="No cases here" sub="Change the filters above, or open a new case." />}
        </div>
      )}

      <div style={{ marginTop: 16 }}><DeptFeed dept="maintenance" /></div>

      {open && (
        <CaseDrawer row={open === 'new' ? null : open.row} onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['cases'] }); }} />
      )}
    </>
  );
}

function Kpi({ label, v, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num" style={{ color: v > 0 ? tone : undefined }}>{v ?? '·'}</div>
    </div>
  );
}

/* ---------------- case drawer ---------------- */

function CaseDrawer({ row, onClose, onSaved }) {
  const { companyId, user, canEdit } = useAuth();
  const qc = useQueryClient();
  const editable = canEdit('maintenance') || canEdit('fleet') || canEdit('dispatch') || canEdit('safety');
  const [f, setF] = useState({
    title: row?.title || '', description: row?.description || '',
    unit_type: row?.unit_type || 'truck',
    truck_id: row?.truck_id || '', trailer_id: row?.trailer_id || '',
    driver_id: row?.driver_id || '', vendor_id: row?.vendor_id || '',
    priority: row?.priority || 'medium', status: row?.status || 'created',
    category: row?.category || 'other', down_unit: row?.down_unit || false,
    estimate_amount: row?.estimate_amount ?? '', location_text: row?.location_text || '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const opts = useQuery({
    queryKey: ['case-options', companyId],
    queryFn: async () => {
      const [t, tr, dr, v] = await Promise.all([
        supabase.from('trucks').select('id, unit_number').eq('company_id', companyId).order('unit_number'),
        supabase.from('trailers').select('id, unit_number').eq('company_id', companyId).order('unit_number'),
        supabase.from('drivers').select('id, full_name').eq('company_id', companyId).order('full_name'),
        supabase.from('vendors').select('id, name').eq('company_id', companyId).order('name'),
      ]);
      return { trucks: t.data || [], trailers: tr.data || [], drivers: dr.data || [], vendors: v.data || [] };
    },
  });

  // when a truck is picked on a new case, suggest its current driver
  useEffect(() => {
    if (row || !f.truck_id || f.driver_id) return;
    (async () => {
      const { data } = await supabase.from('assignments')
        .select('driver_id').eq('truck_id', f.truck_id).is('ended_at', null).maybeSingle();
      if (data?.driver_id) setF((p) => ({ ...p, driver_id: data.driver_id }));
    })();
  }, [f.truck_id, row, f.driver_id]);

  const comments = useQuery({
    queryKey: ['case-comments', row?.id],
    enabled: !!row?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('case_comments')
        .select('*, author:profiles(full_name, email)')
        .eq('case_id', row.id).order('created_at');
      if (error) throw error;
      return data;
    },
  });

  const docs = useQuery({
    queryKey: ['case-docs', row?.id],
    enabled: !!row?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('documents')
        .select('id, doc_type, file_name, file_path, created_at')
        .eq('entity_type', 'repair_case').eq('entity_id', row.id).order('created_at');
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['case-comments', row?.id] });
    qc.invalidateQueries({ queryKey: ['case-docs', row?.id] });
    qc.invalidateQueries({ queryKey: ['cases'] });
    qc.invalidateQueries({ queryKey: ['case-last-comments'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!f.title.trim()) throw new Error('Give the case a title.');
      if (f.unit_type === 'truck' && !f.truck_id) throw new Error('Pick the truck.');
      if (f.unit_type === 'trailer' && !f.trailer_id) throw new Error('Pick the trailer.');
      const payload = {
        company_id: companyId, title: f.title.trim(), description: f.description || null,
        unit_type: f.unit_type,
        truck_id: f.unit_type === 'truck' ? f.truck_id : null,
        trailer_id: f.unit_type === 'trailer' ? f.trailer_id : null,
        driver_id: f.driver_id || null, vendor_id: f.vendor_id || null,
        priority: f.priority, status: f.status, category: f.category,
        down_unit: !!f.down_unit,
        estimate_amount: f.estimate_amount === '' ? null : Number(f.estimate_amount),
        location_text: f.location_text || null,
      };
      if (row) {
        const { error } = await supabase.from('repair_cases')
          .update({ ...payload, updated_by: user?.id }).eq('id', row.id);
        if (error) throw error;
        return row.id;
      }
      const { data, error } = await supabase.from('repair_cases')
        .insert({ ...payload, created_by: user?.id }).select('id, case_number, truck_id').single();
      if (error) throw error;
      await supabase.from('assistant_actions').insert({
        company_id: companyId, kind: 'case_opened', status: 'sent',
        truck_id: payload.truck_id, driver_id: payload.driver_id,
        departments: ['maintenance', 'fleet'],
        summary: `Case #${data.case_number} opened — ${payload.title}`,
        sent_at: new Date().toISOString(),
      });
      return data.id;
    },
    onSuccess: onSaved,
  });

  const addComment = async () => {
    if (!comment.trim()) return;
    try {
      setBusy(true); setErr(null);
      const { error } = await supabase.from('case_comments').insert({
        case_id: row.id, company_id: companyId, body: comment.trim(),
        kind: 'comment', author_id: user?.id,
      });
      if (error) throw error;
      setComment(''); refresh();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const setStatus = async (status) => {
    try {
      setBusy(true); setErr(null);
      const { error } = await supabase.from('repair_cases')
        .update({ status, updated_by: user?.id }).eq('id', row.id);
      if (error) throw error;
      refresh();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  /* invoice upload → AI read → maintenance invoice linked back to the case */
  const fileRef = useRef(null);
  const [invPhase, setInvPhase] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const uploadInvoice = async (file) => {
    try {
      setErr(null); setInvPhase('uploading');
      const { path, name } = await uploadCompanyDoc(companyId, 'repair_case', row.id, file);
      await supabase.from('documents').insert({
        company_id: companyId, entity_type: 'repair_case', entity_id: row.id,
        doc_type: 'invoice', file_name: name, file_path: path,
        mime_type: file.type, size_bytes: file.size, uploaded_by: user?.id,
      });
      const { data: job, error: jErr } = await supabase.from('extraction_jobs').insert({
        company_id: companyId, kind: 'repair_invoice', status: 'pending',
        file_path: path, file_name: name, created_by: user?.id,
      }).select('*').single();
      if (jErr) throw jErr;
      setInvPhase('reading');
      const { error: fnErr } = await supabase.functions
        .invoke('extract-document', { body: { job_id: job.id } });
      if (fnErr) throw new Error(fnErr.message || 'Extraction function failed — is it deployed?');
      timer.current = setInterval(async () => {
        const { data: j } = await supabase.from('extraction_jobs').select('*').eq('id', job.id).single();
        if (!j) return;
        if (j.status === 'needs_review') {
          clearInterval(timer.current);
          await createInvoice(j, path, name);
        } else if (j.status === 'failed') {
          clearInterval(timer.current);
          setInvPhase(null);
          setErr(new Error(`${j.error} — the file is saved on the case; add the invoice manually under Maintenance.`));
          refresh();
        }
      }, 2000);
    } catch (e) { setInvPhase(null); setErr(e); }
  };

  const createInvoice = async (job, path, name) => {
    try {
      setInvPhase('saving');
      const x = job.extracted || {};
      // vendor: use the case's, else match by name, else create
      let vendorId = f.vendor_id || null;
      if (!vendorId && x.vendor_name) {
        const hit = (opts.data?.vendors || []).find((v) =>
          v.name.toLowerCase().includes(String(x.vendor_name).toLowerCase()) ||
          String(x.vendor_name).toLowerCase().includes(v.name.toLowerCase()));
        if (hit) vendorId = hit.id;
        else {
          const { data: nv } = await supabase.from('vendors').insert({
            company_id: companyId, name: String(x.vendor_name).slice(0, 120),
            city: x.vendor_city || null, state: x.vendor_state || null,
          }).select('id').single();
          vendorId = nv?.id ?? null;
        }
      }
      const tasks = Array.isArray(x.tasks) ? x.tasks : [];
      const subtotal = tasks.reduce((a, t) => a + (Number(t.amount) || 0), 0) || Number(x.subtotal) || 0;
      const tax = Number(x.tax) || 0, fees = Number(x.fees) || 0;
      const total = Number(x.total) || subtotal + tax + fees;

      const { data: inv, error: iErr } = await supabase.from('maintenance_invoices').insert({
        company_id: companyId, invoice_number: x.invoice_number || null,
        unit_type: f.unit_type,
        truck_id: f.unit_type === 'truck' ? f.truck_id : null,
        trailer_id: f.unit_type === 'trailer' ? f.trailer_id : null,
        driver_id: f.driver_id || null, vendor_id: vendorId,
        in_date: x.invoice_date || new Date().toISOString().slice(0, 10),
        payment_type: x.payment_hint && x.payment_hint !== 'unknown' ? x.payment_hint : 'efs',
        status: 'to_be_paid',
        odometer: x.odometer ? Number(x.odometer) : null,
        subtotal, tax, fees, total,
        on_company_total: total, on_driver_total: 0,
        extraction_job_id: job.id, created_by: user?.id,
        notes: `From case #${row.case_number} — ${row.title}`,
      }).select('id').single();
      if (iErr) throw iErr;

      if (tasks.length) {
        await supabase.from('maintenance_tasks').insert(tasks.map((t) => ({
          invoice_id: inv.id, company_id: companyId,
          description: String(t.description || 'Item').slice(0, 300),
          quantity: Number(t.quantity) || 1, unit_price: Number(t.unit_price) || 0,
          amount: Number(t.amount) || 0, charge_to: 'company',
        })));
      }
      await supabase.from('documents').insert({
        company_id: companyId, entity_type: 'maintenance_invoice', entity_id: inv.id,
        doc_type: 'invoice', file_name: name, file_path: path,
        extraction_job_id: job.id, uploaded_by: user?.id,
      });
      await supabase.from('extraction_jobs').update({
        status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString(),
        applied_entity_type: 'maintenance_invoice', applied_entity_id: inv.id,
      }).eq('id', job.id);
      await supabase.from('repair_cases').update({
        maintenance_invoice_id: inv.id, vendor_id: vendorId, status: 'resolved',
        updated_by: user?.id,
      }).eq('id', row.id);
      await supabase.from('case_comments').insert({
        case_id: row.id, company_id: companyId, kind: 'attachment', author_id: user?.id,
        body: `Invoice ${x.invoice_number || ''} attached — ${tasks.length} line item(s), total ${
          Number(total).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. Review the split under Maintenance.`,
      });
      setInvPhase(null);
      refresh();
    } catch (e) { setInvPhase(null); setErr(e); }
  };

  const o = opts.data;
  const heading = row ? `Case #${row.case_number}` : 'New case';

  return (
    <Drawer title={heading} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <div style={{ flex: 1 }} />
        {editable && (
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : row ? 'Save changes' : 'Open case'}
          </button>
        )}
      </>}>
      <ErrorNote error={err || save.error || opts.error} />

      {row && editable && (
        <div className="filter-row" style={{ marginBottom: 14 }}>
          {STATUSES.filter((s) => s !== 'cancelled').map((s) => (
            <span key={s} className={`chip ${STATUS_CHIP[s]} ${row.status === s ? 'on' : ''}`}
              style={{ cursor: 'pointer', opacity: row.status === s ? 1 : .6 }}
              onClick={() => row.status !== s && setStatus(s)}>{title(s)}</span>
          ))}
        </div>
      )}

      <Field label="What's wrong"><input value={f.title} onChange={set('title')}
        placeholder="Reefer not holding temp" /></Field>
      <div className="frow">
        <Field label="Priority">
          <select value={f.priority} onChange={set('priority')}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select value={f.category} onChange={set('category')}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{title(c)}</option>)}
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
              {(o?.trucks || []).map((t) => <option key={t.id} value={t.id}>{t.unit_number}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Trailer">
            <select value={f.trailer_id} onChange={set('trailer_id')}>
              <option value="">—</option>
              {(o?.trailers || []).map((t) => <option key={t.id} value={t.id}>{t.unit_number}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="frow">
        <Field label="Driver">
          <select value={f.driver_id} onChange={set('driver_id')}>
            <option value="">—</option>
            {(o?.drivers || []).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </Field>
        <Field label="Shop / vendor">
          <select value={f.vendor_id} onChange={set('vendor_id')}>
            <option value="">—</option>
            {(o?.vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="frow">
        <Field label="Estimate ($)">
          <input type="number" step="0.01" value={f.estimate_amount} onChange={set('estimate_amount')} />
        </Field>
        <Field label="Unit is down?">
          <select value={f.down_unit ? 'yes' : 'no'}
            onChange={(e) => setF((p) => ({ ...p, down_unit: e.target.value === 'yes' }))}>
            <option value="no">No — still running</option>
            <option value="yes">Yes — cannot run</option>
          </select>
        </Field>
      </div>
      <Field label="Where"><input value={f.location_text} onChange={set('location_text')}
        placeholder="Shop name or location" /></Field>
      <Field label="Details"><textarea rows={3} value={f.description} onChange={set('description')} /></Field>

      {row && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '16px 0' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, margin: '0 0 8px' }}>Repair invoice</h3>
          {row.maintenance_invoice_id ? (
            <p className="small" style={{ color: 'var(--ok)' }}>
              ✓ Invoice attached and created under Maintenance. Set the On Company / On Driver
              split there — driver-charged amounts become a deduction.
            </p>
          ) : editable ? (
            <>
              <p className="small muted">Upload the shop's invoice (PDF or photo). The AI reads
                the header and every line item, creates the maintenance invoice against this unit,
                links it here and marks the case resolved.</p>
              {!invPhase && (
                <input ref={fileRef} type="file" accept=".pdf,image/*"
                  onChange={(e) => e.target.files?.[0] && uploadInvoice(e.target.files[0])} />
              )}
              {invPhase === 'uploading' && <p className="small">Uploading…</p>}
              {invPhase === 'reading' && <p className="small"><b>Reading the invoice…</b> usually 5–20 seconds.</p>}
              {invPhase === 'saving' && <p className="small">Creating the maintenance invoice…</p>}
            </>
          ) : <p className="small muted">No invoice yet.</p>}

          {(docs.data || []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              {docs.data.map((d) => (
                <div key={d.id} className="feed-item" style={{ padding: '7px 2px' }}>
                  <span className="chip gray nodot">{d.doc_type}</span>
                  <div style={{ flex: 1 }} className="small">{d.file_name}</div>
                  <button className="btn btn-ghost" onClick={() => openDoc(d.file_path)}>Open</button>
                </div>
              ))}
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '16px 0' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, margin: '0 0 4px' }}>Activity</h3>
          {(comments.data || []).map((c) => (
            <div key={c.id} className={`comment ${c.kind !== 'comment' ? 'sys' : ''}`}>
              <div className="who">
                {(c.author?.full_name || c.author?.email || c.author_label || '·')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div className="body">{c.body}</div>
                <div className="feed-meta">
                  {c.author?.full_name || c.author?.email || c.author_label || 'system'} · {ago(c.created_at)}
                </div>
              </div>
            </div>
          ))}
          {comments.data?.length === 0 && <p className="small muted">No activity yet.</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…" onKeyDown={(e) => e.key === 'Enter' && addComment()}
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)',
                borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)',
                fontFamily: 'inherit', fontSize: 13 }} />
            <button className="btn btn-ghost" disabled={busy || !comment.trim()} onClick={addComment}>Post</button>
          </div>
        </>
      )}
    </Drawer>
  );
}
