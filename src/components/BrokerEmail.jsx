import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../app/AuthProvider';
import { Field, ErrorNote } from './ui';
import { ago } from '../lib/format';

/** Broker conversation controls inside the load drawer. */
export default function BrokerEmail({ loadId }) {
  const { companyId, canEdit } = useAuth();
  const qc = useQueryClient();
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const editable = canEdit('dispatch') || canEdit('tracking');

  const thread = useQuery({
    queryKey: ['load-thread', loadId],
    queryFn: async () => {
      const { data, error } = await supabase.from('email_threads')
        .select('id, subject, participants, last_message_at, auto_linked, snippet')
        .eq('load_id', loadId).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const sub = useQuery({
    queryKey: ['load-sub', loadId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tracking_subscriptions')
        .select('*').eq('load_id', loadId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const candidates = useQuery({
    queryKey: ['thread-candidates', companyId, picking],
    enabled: picking,
    queryFn: async () => {
      const { data, error } = await supabase.from('email_threads')
        .select('id, subject, snippet, participants, last_message_at, load_id')
        .eq('company_id', companyId).is('load_id', null)
        .order('last_message_at', { ascending: false }).limit(25);
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['load-thread', loadId] });
    qc.invalidateQueries({ queryKey: ['load-sub', loadId] });
  };

  const link = useMutation({
    mutationFn: async (threadId) => {
      const { error } = await supabase.from('email_threads')
        .update({ load_id: loadId }).eq('id', threadId);
      if (error) throw error;
    },
    onSuccess: () => { setPicking(false); refresh(); },
  });

  const unlink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('email_threads')
        .update({ load_id: null, auto_linked: false }).eq('id', thread.data.id);
      if (error) throw error;
      await supabase.from('tracking_subscriptions').delete().eq('load_id', loadId);
    },
    onSuccess: refresh,
  });

  const toggleTracking = useMutation({
    mutationFn: async (on) => {
      if (!thread.data) throw new Error('Link the broker conversation first.');
      if (sub.data) {
        const { error } = await supabase.from('tracking_subscriptions').update({
          enabled: on, stopped_at: on ? null : new Date().toISOString(),
          stop_reason: on ? null : 'turned off by dispatch',
          next_send_at: on ? new Date().toISOString() : null,
          email_thread_id: thread.data.id,
        }).eq('id', sub.data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('tracking_subscriptions').insert({
          company_id: companyId, load_id: loadId, email_thread_id: thread.data.id,
          enabled: true, interval_minutes: 60, next_send_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
    },
    onSuccess: refresh,
    onError: (e) => setMsg({ type: 'error', text: e.message }),
  });

  const setInterval_ = useMutation({
    mutationFn: async (minutes) => {
      const { error } = await supabase.from('tracking_subscriptions')
        .update({ interval_minutes: Number(minutes) }).eq('id', sub.data.id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const sendNow = async (kind) => {
    try {
      setBusy(true); setMsg(null);
      const { data, error } = await supabase.functions.invoke('email-send', {
        body: { load_id: loadId, kind },
      });
      if (error) throw new Error(error.message || 'email-send failed — is it deployed?');
      if (data?.error) throw new Error(data.error);
      setMsg({ type: 'ok', text: `Sent to ${data.to.join(', ')}${data.cc?.length ? ` (cc ${data.cc.join(', ')})` : ''}` });
      qc.invalidateQueries({ queryKey: ['activity'] });
    } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  };

  const t = thread.data;
  const s = sub.data;

  return (
    <>
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '14px 0' }} />
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, margin: '0 0 8px' }}>Broker conversation</h3>
      <ErrorNote error={thread.error || link.error} />
      {msg && (
        <div className={msg.type === 'error' ? 'error-note' : 'small'}
          style={msg.type === 'ok' ? { color: 'var(--ok)', marginBottom: 8 } : undefined}>
          {msg.text}
        </div>
      )}

      {!t && !picking && (
        <>
          <p className="small muted">No email thread linked. Link one and the assistant can
            reply straight into the broker's conversation.</p>
          {editable && <button className="btn btn-ghost" onClick={() => setPicking(true)}>Link a conversation</button>}
        </>
      )}

      {picking && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', marginBottom: 6 }}>
            <b className="small">Recent unlinked conversations</b>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={() => setPicking(false)}>Cancel</button>
          </div>
          {(candidates.data || []).map((c) => (
            <div key={c.id} className="feed-item" style={{ padding: '7px 2px', cursor: 'pointer' }}
              onClick={() => link.mutate(c.id)}>
              <div style={{ flex: 1 }}>
                <div className="small" style={{ fontWeight: 600 }}>{c.subject || '(no subject)'}</div>
                <div className="small muted">
                  {(c.participants || []).map((p) => p.email).slice(0, 3).join(', ')} · {ago(c.last_message_at)}
                </div>
              </div>
            </div>
          ))}
          {candidates.data?.length === 0 && (
            <p className="small muted">Nothing to link. Sync the mailbox under Admin → Broker email.</p>
          )}
        </div>
      )}

      {t && (
        <>
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>{t.subject || '(no subject)'}</div>
            <div className="small muted">
              {(t.participants || []).map((p) => p.email).join(', ')}
            </div>
            <div className="small muted">Last message {ago(t.last_message_at)}
              {t.auto_linked ? ' · linked automatically by reference' : ''}</div>
          </div>

          {editable && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <button className="btn btn-primary" disabled={busy} onClick={() => sendNow('loaded_notice')}>
                  Send loaded notice
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => sendNow('tracking_update')}>
                  Send location update
                </button>
                <button className="btn btn-ghost" onClick={() => unlink.mutate()}>Unlink</button>
              </div>

              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b className="small">Automatic updates</b>
                  <div style={{ flex: 1 }} />
                  <button className={`btn ${s?.enabled && !s?.stopped_at ? 'btn-primary' : 'btn-ghost'}`}
                    disabled={toggleTracking.isPending}
                    onClick={() => toggleTracking.mutate(!(s?.enabled && !s?.stopped_at))}>
                    {s?.enabled && !s?.stopped_at ? 'On' : 'Off'}
                  </button>
                </div>
                {s?.enabled && !s?.stopped_at && (
                  <>
                    <div className="frow" style={{ marginTop: 8 }}>
                      <Field label="Every (minutes)">
                        <select defaultValue={s.interval_minutes}
                          onChange={(e) => setInterval_.mutate(e.target.value)}>
                          {[30, 60, 120, 240].map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </Field>
                      <div>
                        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>Next</label>
                        <div className="small" style={{ paddingTop: 8 }}>
                          {s.next_send_at ? new Date(s.next_send_at).toLocaleTimeString() : '—'}
                        </div>
                      </div>
                    </div>
                    <p className="small muted" style={{ margin: 0 }}>
                      Sends the truck's position into this conversation until the load is
                      delivered, then stops by itself. Skipped if the ELD has been silent
                      over 90 minutes.
                    </p>
                  </>
                )}
                {s?.stopped_at && (
                  <p className="small muted" style={{ marginBottom: 0 }}>
                    Stopped {ago(s.stopped_at)}{s.stop_reason ? ` — ${s.stop_reason}` : ''}.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
