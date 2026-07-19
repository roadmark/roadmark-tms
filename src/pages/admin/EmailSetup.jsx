import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Field, Empty, ErrorNote } from '../../components/ui';
import { ago } from '../../lib/format';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

export default function EmailSetup() {
  const { companyId, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const redirectUri = `${window.location.origin}/admin/email`;

  const mailboxes = useQuery({
    queryKey: ['mailboxes', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('email_mailboxes')
        .select('*').eq('company_id', companyId).order('created_at');
      if (error) throw error;
      return data;
    },
  });

  const templates = useQuery({
    queryKey: ['templates', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('message_templates')
        .select('*').eq('company_id', companyId).order('kind');
      if (error) throw error;
      return data;
    },
  });

  // handle the redirect back from Google
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const err = params.get('error');
    if (err) { setStatus({ type: 'error', text: `Google returned: ${err}` }); window.history.replaceState({}, '', redirectUri); return; }
    if (!code || !companyId) return;
    (async () => {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke('email-oauth', {
        body: { code, redirect_uri: redirectUri, company_id: companyId },
      });
      setBusy(false);
      window.history.replaceState({}, '', redirectUri);
      if (error || data?.error) setStatus({ type: 'error', text: data?.error || error.message });
      else {
        setStatus({ type: 'ok', text: `Connected ${data.address}` });
        qc.invalidateQueries({ queryKey: ['mailboxes'] });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const connect = () => {
    if (!clientId) {
      setStatus({ type: 'error', text: 'VITE_GOOGLE_CLIENT_ID is not set — add it in Vercel (and .env.local) and redeploy.' });
      return;
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    window.location.href = url.toString();
  };

  const sync = useMutation({
    mutationFn: async (mailbox_id) => {
      const { data, error } = await supabase.functions.invoke('email-sync', { body: { mailbox_id } });
      if (error) throw new Error(error.message || 'email-sync failed — is it deployed?');
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => { setStatus({ type: 'ok', text: JSON.stringify(d.report) }); qc.invalidateQueries(); },
    onError: (e) => setStatus({ type: 'error', text: e.message }),
  });

  const saveTpl = useMutation({
    mutationFn: async ({ id, subject, body }) => {
      const { error } = await supabase.from('message_templates').update({ subject, body }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { setStatus({ type: 'ok', text: 'Template saved' }); qc.invalidateQueries({ queryKey: ['templates'] }); },
  });

  return (
    <>
      <div className="page-head">
        <h2>Broker email</h2>
        <div className="spacer" />
        {isAdmin() && <button className="btn btn-primary" disabled={busy} onClick={connect}>
          {busy ? 'Connecting…' : 'Connect dispatch mailbox'}
        </button>}
      </div>

      {status && (
        <div className={status.type === 'error' ? 'error-note' : 'card card-pad'}
          style={status.type === 'ok' ? { marginBottom: 14, borderLeft: '3px solid var(--ok)' } : undefined}>
          {status.text}
        </div>
      )}
      <ErrorNote error={mailboxes.error} />

      <div className="card" style={{ marginBottom: 16 }}>
        <table className="data">
          <thead><tr><th>Mailbox</th><th>Provider</th><th>Status</th><th>Last sync</th><th></th></tr></thead>
          <tbody>
            {(mailboxes.data || []).map((m) => (
              <tr key={m.id} className="norow">
                <td style={{ fontWeight: 600 }}>{m.address}</td>
                <td>{m.provider}</td>
                <td>
                  <Chip value={m.status === 'active' ? 'active' : m.status} />
                  {m.last_error && <div className="small" style={{ color: 'var(--danger)' }}>{m.last_error}</div>}
                </td>
                <td className="small">{m.last_sync_at ? ago(m.last_sync_at) : 'never'}</td>
                <td style={{ textAlign: 'right' }}>
                  {isAdmin() && (
                    <button className="btn btn-ghost" disabled={sync.isPending}
                      onClick={() => sync.mutate(m.id)}>
                      {sync.isPending ? 'Syncing…' : 'Sync conversations'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {mailboxes.data?.length === 0 && (
          <Empty head="No mailbox connected"
            sub="Connect the dispatch mailbox to reply into broker conversations automatically." />
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 15 }}>How this works</h3>
        <p className="small muted" style={{ margin: 0 }}>
          The app mirrors the <b>envelope</b> of recent conversations — subject, who is on the
          thread, and the message IDs that hold a conversation together. It never stores email
          bodies. When it replies, it sends from your own mailbox with those IDs attached and
          addresses everyone already on the thread, so the message lands inside the broker's
          existing conversation exactly as if your dispatcher had hit Reply All.
        </p>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>Message templates</h3>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Placeholders: {'{customer_load_id} {load_number} {truck} {driver_first_name} {location} {miles_left} {next_stop_city} {eta} {appointment_time} {temperature} {company}'}
          </p>
        </div>
        <div className="card-pad">
          {(templates.data || []).map((t) => (
            <TemplateEditor key={t.id} tpl={t} onSave={saveTpl.mutate} busy={saveTpl.isPending} />
          ))}
          {templates.data?.length === 0 && (
            <p className="small muted">No templates — run migration 013 to seed the defaults.</p>
          )}
        </div>
      </div>
    </>
  );
}

function TemplateEditor({ tpl, onSave, busy }) {
  const [subject, setSubject] = useState(tpl.subject || '');
  const [body, setBody] = useState(tpl.body || '');
  const dirty = subject !== (tpl.subject || '') || body !== (tpl.body || '');
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{tpl.name}</div>
      <Field label="Subject (used only when starting a new thread)">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message">
        <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <button className="btn btn-primary" disabled={!dirty || busy}
        onClick={() => onSave({ id: tpl.id, subject, body })}>
        {busy ? 'Saving…' : 'Save template'}
      </button>
    </div>
  );
}
