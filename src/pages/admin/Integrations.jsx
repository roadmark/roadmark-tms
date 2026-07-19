import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Drawer, Field, Empty, ErrorNote } from '../../components/ui';
import { ago } from '../../lib/format';

const PROVIDERS = [
  ['samsara', 'Samsara'],
  ['motive', 'Motive (KeepTruckin)'],
  ['eva', 'EVA ELD (no public API yet)'],
  ['geotab', 'Geotab'],
  ['other', 'Other'],
];

export default function Integrations() {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const editable = canEdit('tracking') || canEdit('fleet');

  const conns = useQuery({
    queryKey: ['telematics-connections', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('telematics_connections')
        .select('*').eq('company_id', companyId).order('created_at');
      if (error) throw error;
      return data;
    },
  });

  const units = useQuery({
    queryKey: ['telematics-units', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('telematics_units')
        .select('id, external_id, external_name, external_vin, matched, truck_id, connection_id')
        .eq('company_id', companyId).order('external_name');
      if (error) throw error;
      return data;
    },
  });

  const runSync = useMutation({
    mutationFn: async ({ id, test }) => {
      setTestResult(null);
      const { data, error } = await supabase.functions.invoke('telematics-sync', {
        body: { connection_id: id, test: !!test },
      });
      if (error) throw new Error(error.message || 'Function call failed — is telematics-sync deployed?');
      return data;
    },
    onSuccess: (data) => { setTestResult(data); setTesting(null); qc.invalidateQueries(); },
    onError: () => setTesting(null),
  });

  const unmatched = (units.data || []).filter((u) => !u.truck_id);

  return (
    <>
      <div className="page-head">
        <h2>ELD &amp; integrations</h2>
        <div className="spacer" />
        {editable && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add connection</button>}
      </div>
      <ErrorNote error={conns.error || runSync.error} />

      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr><th>Provider</th><th>Label</th><th>Secret name</th><th>Status</th><th>Last sync</th><th></th></tr></thead>
          <tbody>
            {(conns.data || []).map((c) => (
              <tr key={c.id} className="norow">
                <td style={{ fontWeight: 600 }}>{PROVIDERS.find((p) => p[0] === c.provider)?.[1] || c.provider}</td>
                <td>{c.label}</td>
                <td className="small"><code>TELEMATICS_TOKEN_{c.secret_ref}</code></td>
                <td>
                  <Chip value={c.status === 'active' ? 'active' : c.status} />
                  {c.last_error && <div className="small" style={{ color: 'var(--danger)' }}>{c.last_error}</div>}
                </td>
                <td className="small">{c.last_sync_at ? ago(c.last_sync_at) : 'never'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editable && (
                    <>
                      <button className="btn btn-ghost" disabled={runSync.isPending}
                        onClick={() => { setTesting(c.id); runSync.mutate({ id: c.id, test: true }); }}>
                        {testing === c.id ? 'Testing…' : 'Test'}
                      </button>
                      <button className="btn btn-ghost" disabled={runSync.isPending}
                        onClick={() => runSync.mutate({ id: c.id })}>Sync now</button>
                      <button className="btn btn-ghost" onClick={() => setOpen(c)}>Edit</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {conns.data?.length === 0 && (
          <Empty head="No ELD connected"
            sub="Add your Samsara or Motive account to put trucks on the live map." />
        )}
      </div>

      {testResult && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <b>Result</b>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
            {JSON.stringify(testResult, null, 2)}
          </pre>
        </div>
      )}

      {(units.data || []).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-pad" style={{ paddingBottom: 4 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>
              Vehicles from the provider
            </h3>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Matched automatically by VIN, then by unit number. Anything unmatched
              ({unmatched.length}) can be linked here — positions are kept either way.
            </p>
          </div>
          <UnitMatcher units={units.data} editable={editable} />
        </div>
      )}

      {open && <ConnDrawer row={open === 'new' ? null : open} onClose={() => setOpen(null)}
        onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['telematics-connections'] }); }} />}
    </>
  );
}

function UnitMatcher({ units, editable }) {
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const trucks = useQuery({
    queryKey: ['trucks-min', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('trucks')
        .select('id, unit_number').eq('company_id', companyId).order('unit_number');
      if (error) throw error;
      return data;
    },
  });
  const link = useMutation({
    mutationFn: async ({ id, truck_id }) => {
      const { error } = await supabase.from('telematics_units')
        .update({ truck_id: truck_id || null, matched: !!truck_id }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telematics-units'] }),
  });

  return (
    <table className="data">
      <thead><tr><th>Provider name</th><th>VIN</th><th>External ID</th><th>Our truck</th></tr></thead>
      <tbody>
        {units.map((u) => (
          <tr key={u.id} className="norow">
            <td style={{ fontWeight: 600 }}>{u.external_name || '—'}</td>
            <td className="small">{u.external_vin || '—'}</td>
            <td className="small muted">{u.external_id}</td>
            <td>
              {editable ? (
                <select value={u.truck_id || ''} style={{ padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6 }}
                  onChange={(e) => link.mutate({ id: u.id, truck_id: e.target.value })}>
                  <option value="">— not linked —</option>
                  {(trucks.data || []).map((t) => <option key={t.id} value={t.id}>{t.unit_number}</option>)}
                </select>
              ) : (u.matched ? 'linked' : '—')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConnDrawer({ row, onClose, onSaved }) {
  const { companyId, user } = useAuth();
  const [f, setF] = useState({
    provider: row?.provider || 'samsara',
    label: row?.label || '',
    secret_ref: row?.secret_ref || '',
    base_url: row?.base_url || '',
    status: row?.status || 'active',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const ref = f.secret_ref.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!ref) throw new Error('Give the connection a secret name, e.g. MAIN_SAMSARA');
      if (!f.label.trim()) throw new Error('Give the connection a label.');
      const payload = {
        company_id: companyId, provider: f.provider, label: f.label.trim(),
        secret_ref: ref, base_url: f.base_url.trim() || null, status: f.status,
      };
      if (row) {
        const { error } = await supabase.from('telematics_connections').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('telematics_connections')
          .insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: onSaved,
  });

  const ref = (f.secret_ref || 'YOUR_REF').toUpperCase().replace(/[^A-Z0-9_]/g, '_');

  return (
    <Drawer title={row ? 'Edit connection' : 'Add ELD connection'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save connection'}
        </button>
      </>}>
      <ErrorNote error={save.error} />
      <Field label="Provider">
        <select value={f.provider} onChange={set('provider')}>
          {PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Label"><input value={f.label} onChange={set('label')} placeholder="Samsara — main account" /></Field>
      <Field label="Secret name">
        <input value={f.secret_ref} onChange={set('secret_ref')} placeholder="MAIN_SAMSARA" />
      </Field>
      <Field label="Custom API base URL (optional)">
        <input value={f.base_url} onChange={set('base_url')} placeholder="leave empty for the default" />
      </Field>
      <Field label="Status">
        <select value={f.status} onChange={set('status')}>
          <option value="active">active</option><option value="paused">paused</option>
        </select>
      </Field>

      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginTop: 10 }}>
        <b>Your API token never goes in this form.</b>
        <p className="small" style={{ margin: '6px 0' }}>
          It lives as a Supabase secret so it's never exposed to the browser. Add it in
          Supabase → Edge Functions → Secrets with this exact name:
        </p>
        <code className="small">TELEMATICS_TOKEN_{ref}</code>
        <p className="small" style={{ margin: '8px 0 0' }}>
          {f.provider === 'samsara' && 'Samsara: Settings → API Tokens → create a token with Read Vehicle Statistics.'}
          {f.provider === 'motive' && 'Motive: Admin → Developers → API Keys → create a key.'}
          {f.provider === 'eva' && 'EVA has no public API yet — request partner access from their support. Until then, import units by CSV and use manual check calls.'}
          {(f.provider === 'geotab' || f.provider === 'other') && 'No adapter yet for this provider — tell me which one and I will add it.'}
        </p>
        <p className="small" style={{ margin: '8px 0 0' }}>
          After saving, use <b>Test</b> to confirm the token works, then <b>Sync now</b> to pull positions.
        </p>
      </div>
    </Drawer>
  );
}
