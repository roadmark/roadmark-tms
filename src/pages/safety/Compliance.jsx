import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { uploadCompanyDoc, openDoc } from '../../lib/storage';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { d } from '../../lib/format';
import DeptFeed from '../../components/DeptFeed';

/** Status from the expiry date — the same rule the nightly job applies. */
export function statusFor(expiry) {
  if (!expiry) return 'missing';
  const days = Math.floor((new Date(expiry) - new Date()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'valid';
}

const DOC_TYPE_FOR = {
  MED: 'medical_card', CDL: 'cdl', W9: 'w9', REG: 'registration', TREG: 'registration',
  INSP: 'inspection', TINSP: 'inspection', HUT2290: 'permit',
};

export default function Compliance() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState('driver');
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(null);
  const editable = canEdit('safety') || canEdit('fleet');

  const items = useQuery({
    queryKey: ['compliance', companyId, entityType],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('compliance_items')
        .select(`id, entity_type, entity_id, status, issue_date, expiry_date, note, document_id,
                 type:compliance_types(id, code, name, applies_to)`)
        .eq('company_id', companyId).eq('entity_type', entityType)
        .order('expiry_date', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data;
    },
  });

  // names for the entities referenced
  const names = useQuery({
    queryKey: ['entity-names', companyId, entityType],
    enabled: !!companyId,
    queryFn: async () => {
      const table = entityType === 'driver' ? 'drivers' : entityType === 'truck' ? 'trucks' : 'trailers';
      const col = entityType === 'driver' ? 'full_name' : 'unit_number';
      const { data, error } = await supabase.from(table).select(`id, ${col}`).eq('company_id', companyId);
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.id, r[col]]));
    },
  });

  const docs = useQuery({
    queryKey: ['compliance-docs', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('documents')
        .select('id, file_path, file_name').eq('company_id', companyId);
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.id, r]));
    },
  });

  const rows = useMemo(() => {
    const list = (items.data || []).map((r) => ({ ...r, live: statusFor(r.expiry_date) }));
    return statusFilter ? list.filter((r) => r.live === statusFilter) : list;
  }, [items.data, statusFilter]);

  const counts = useMemo(() => {
    const c = { expired: 0, expiring: 0, missing: 0, valid: 0 };
    (items.data || []).forEach((r) => { c[statusFor(r.expiry_date)] += 1; });
    return c;
  }, [items.data]);

  return (
    <>
      <div className="page-head">
        <h2>Compliance</h2>
        {['driver', 'truck', 'trailer'].map((t) => (
          <button key={t} className={`btn ${entityType === t ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEntityType(t)}>{t}s</button>
        ))}
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add item</button>}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <CountCard label="Expired" v={counts.expired} tone="var(--danger)" />
        <CountCard label="Expiring (30 days)" v={counts.expiring} tone="#c2410c" />
        <CountCard label="Missing date" v={counts.missing} tone="var(--text-3)" />
        <CountCard label="Valid" v={counts.valid} tone="var(--ok)" />
      </div>

      <div className="filter-row">
        {['', 'expired', 'expiring', 'missing', 'valid'].map((s) => (
          <span key={s || 'all'} className={`chip gray ${statusFilter === s ? 'on' : ''}`}
            onClick={() => setStatusFilter(s)}>{s || 'all'}</span>
        ))}
      </div>

      <ErrorNote error={items.error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr>
            <th>{entityType === 'driver' ? 'Driver' : 'Unit'}</th><th>Item</th>
            <th>Status</th><th>Issued</th><th>Expires</th><th>Document</th><th>Note</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => editable && setOpen(r)}>
                <td style={{ fontWeight: 600 }}>{names.data?.[r.entity_id] || '—'}</td>
                <td>{r.type?.code} <span className="small muted">{r.type?.name}</span></td>
                <td><Chip value={r.live} /></td>
                <td>{d(r.issue_date)}</td>
                <td>{d(r.expiry_date)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.document_id && docs.data?.[r.document_id]
                    ? <button className="btn btn-ghost" onClick={() => openDoc(docs.data[r.document_id].file_path)}>Open</button>
                    : <span className="muted">—</span>}
                </td>
                <td className="small">{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <Empty head="Nothing here"
            sub="Add compliance items (CDL, medical card, MVR, registration, annual inspection…) with their expiry dates and the app tracks them." />
        )}
      </div>

      <DeptFeed dept="safety" />

      {open && <ItemDrawer row={open === 'new' ? null : open} entityType={entityType}
        onClose={() => setOpen(null)}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['compliance'] }); qc.invalidateQueries({ queryKey: ['compliance-docs'] }); }} />}
    </>
  );
}

function CountCard({ label, v, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num" style={{ color: v > 0 ? tone : 'var(--text-3)' }}>{v}</div>
    </div>
  );
}

function ItemDrawer({ row, entityType, onClose, onSaved }) {
  const { companyId, user } = useAuth();
  const [f, setF] = useState({
    entity_id: row?.entity_id || '',
    compliance_type_id: row?.type?.id || '',
    issue_date: row?.issue_date || '',
    expiry_date: row?.expiry_date || '',
    note: row?.note || '',
  });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const opts = useQuery({
    queryKey: ['compliance-options', companyId, entityType],
    queryFn: async () => {
      const table = entityType === 'driver' ? 'drivers' : entityType === 'truck' ? 'trucks' : 'trailers';
      const col = entityType === 'driver' ? 'full_name' : 'unit_number';
      const [ents, types] = await Promise.all([
        supabase.from(table).select(`id, ${col}`).eq('company_id', companyId).order(col),
        supabase.from('compliance_types').select('id, code, name, applies_to, default_valid_days')
          .eq('applies_to', entityType).order('code'),
      ]);
      if (ents.error) throw ents.error;
      if (types.error) throw types.error;
      return {
        entities: ents.data.map((r) => ({ id: r.id, label: r[col] })),
        types: types.data,
      };
    },
  });

  // picking a type with a known validity period fills the expiry from the issue date
  const pickType = (e) => {
    const compliance_type_id = e.target.value;
    setF((p) => {
      const t = opts.data?.types.find((x) => x.id === compliance_type_id);
      let expiry_date = p.expiry_date;
      if (t?.default_valid_days && p.issue_date && !row) {
        const dt = new Date(p.issue_date);
        dt.setDate(dt.getDate() + t.default_valid_days);
        expiry_date = dt.toISOString().slice(0, 10);
      }
      return { ...p, compliance_type_id, expiry_date };
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!f.entity_id) throw new Error(`Pick the ${entityType}.`);
      if (!f.compliance_type_id) throw new Error('Pick the compliance item.');
      let document_id = row?.document_id || null;
      if (file) {
        const { path, name } = await uploadCompanyDoc(companyId, entityType, f.entity_id, file);
        const code = opts.data?.types.find((t) => t.id === f.compliance_type_id)?.code;
        const { data: doc, error: dErr } = await supabase.from('documents').insert({
          company_id: companyId, entity_type: entityType, entity_id: f.entity_id,
          doc_type: DOC_TYPE_FOR[code] || 'other', file_name: name, file_path: path,
          mime_type: file.type, size_bytes: file.size, uploaded_by: user?.id,
        }).select('id').single();
        if (dErr) throw dErr;
        document_id = doc.id;
      }
      const payload = {
        company_id: companyId, entity_type: entityType, entity_id: f.entity_id,
        compliance_type_id: f.compliance_type_id,
        issue_date: f.issue_date || null, expiry_date: f.expiry_date || null,
        status: statusFor(f.expiry_date), note: f.note || null, document_id,
      };
      if (row) {
        const { error } = await supabase.from('compliance_items').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('compliance_items')
          .insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  const live = statusFor(f.expiry_date);
  return (
    <Drawer title={row ? 'Compliance item' : `Add ${entityType} compliance item`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save item'}
        </button>
      </>}>
      <ErrorNote error={save.error || opts.error} />
      <Field label={entityType === 'driver' ? 'Driver' : 'Unit'}>
        <select value={f.entity_id} onChange={set('entity_id')} disabled={!!row}>
          <option value="">—</option>
          {(opts.data?.entities || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </Field>
      <Field label="Compliance item">
        <select value={f.compliance_type_id} onChange={pickType}>
          <option value="">—</option>
          {(opts.data?.types || []).map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
        </select>
      </Field>
      <div className="frow">
        <Field label="Issue date"><input type="date" value={f.issue_date} onChange={set('issue_date')} /></Field>
        <Field label="Expiry date"><input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></Field>
      </div>
      <div style={{ marginBottom: 10 }}>
        Current status: <Chip value={live} />
        {live === 'expiring' && <span className="small muted"> — inside 30 days</span>}
      </div>
      <Field label={row?.document_id ? 'Replace document' : 'Attach document (optional)'}>
        <input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      <Field label="Note"><textarea rows={2} value={f.note} onChange={set('note')} /></Field>
      <p className="small muted">Items expiring within 30 days show as “expiring”, and past the
        date as “expired”. When the reminder bot goes live it reads exactly this list to tag
        the driver and safety in the truck group.</p>
    </Drawer>
  );
}
