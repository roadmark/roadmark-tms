import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Chip, Empty, ErrorNote } from '../../components/ui';
import { ago, title } from '../../lib/format';

export default function AssistantsAdmin() {
  const { companyId, canEdit, isAdmin } = useAuth();
  const qc = useQueryClient();
  const editable = isAdmin() || canEdit('dispatch');

  const groups = useQuery({
    queryKey: ['tg-groups', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('telegram_groups')
        .select('id, chat_id, title, truck_id, active, updated_at')
        .eq('company_id', companyId).order('title');
      if (error) throw error;
      return data;
    },
  });

  const identities = useQuery({
    queryKey: ['tg-identities', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('telegram_identities')
        .select('id, telegram_user_id, username, display_name, driver_id, employee_id, profile_id')
        .eq('company_id', companyId).order('display_name');
      if (error) throw error;
      return data;
    },
  });

  const refs = useQuery({
    queryKey: ['assistant-refs', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [trucks, drivers, employees] = await Promise.all([
        supabase.from('trucks').select('id, unit_number').eq('company_id', companyId).order('unit_number'),
        supabase.from('drivers').select('id, full_name').eq('company_id', companyId).order('full_name'),
        supabase.from('employees').select('id, full_name, department').eq('company_id', companyId).order('full_name'),
      ]);
      return { trucks: trucks.data || [], drivers: drivers.data || [], employees: employees.data || [] };
    },
  });

  const pending = useQuery({
    queryKey: ['pending-actions', companyId],
    enabled: !!companyId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('assistant_actions')
        .select('id, kind, status, summary, created_at, truck:trucks(unit_number)')
        .eq('company_id', companyId).eq('status', 'awaiting_approval')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const setGroupTruck = useMutation({
    mutationFn: async ({ id, truck_id }) => {
      const { error } = await supabase.from('telegram_groups')
        .update({ truck_id: truck_id || null }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tg-groups'] }),
  });

  const setIdentity = useMutation({
    mutationFn: async ({ id, field, value }) => {
      const patch = { driver_id: null, employee_id: null };
      if (field !== 'none') patch[field] = value;
      const { error } = await supabase.from('telegram_identities').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tg-identities'] }),
  });

  return (
    <>
      <div className="page-head">
        <h2>Assistants — Telegram setup</h2>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontSize: 15 }}>How to connect a truck group</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>Add your bot to the truck's Telegram group (group title = truck number).</li>
          <li>In the group, send <code>/link 4114</code> — it binds the group to that truck.</li>
          <li>Everyone in the group sends <code>/register</code> once, then you connect each
            person to their driver or staff record below (needed so the bot can tag them).</li>
          <li>After loading, the driver sends the BOL photo with caption <b>bol</b>;
            morning inspection photos with caption <b>pti</b>.</li>
        </ol>
      </div>

      {(pending.data || []).length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent)' }}>
          <div className="card-pad" style={{ paddingBottom: 4 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>
              Waiting for a dispatcher in Telegram
            </h3>
          </div>
          {pending.data.map((a) => (
            <div key={a.id} className="feed-item" style={{ padding: '10px 18px' }}>
              <div style={{ flex: 1 }}>
                <div className="feed-title">{a.summary || title(a.kind)}</div>
                <div className="feed-meta">Truck {a.truck?.unit_number || '—'} · {ago(a.created_at)}</div>
              </div>
              <Chip value={a.status} />
            </div>
          ))}
        </div>
      )}

      <ErrorNote error={groups.error || identities.error || setGroupTruck.error || setIdentity.error} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad" style={{ paddingBottom: 4 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>Truck groups</h3>
        </div>
        <table className="data">
          <thead><tr><th>Group</th><th>Chat ID</th><th>Truck</th><th>Last activity</th></tr></thead>
          <tbody>
            {(groups.data || []).map((g) => (
              <tr key={g.id} className="norow">
                <td style={{ fontWeight: 600 }}>{g.title || '—'}</td>
                <td className="small muted">{g.chat_id}</td>
                <td>
                  {editable ? (
                    <select value={g.truck_id || ''} style={{ padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6 }}
                      onChange={(e) => setGroupTruck.mutate({ id: g.id, truck_id: e.target.value })}>
                      <option value="">— not linked —</option>
                      {(refs.data?.trucks || []).map((t) => <option key={t.id} value={t.id}>{t.unit_number}</option>)}
                    </select>
                  ) : (refs.data?.trucks.find((t) => t.id === g.truck_id)?.unit_number || '—')}
                </td>
                <td className="small">{ago(g.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.data?.length === 0 && (
          <Empty head="No groups connected yet"
            sub="Add the bot to a truck group and send /link with the truck number." />
        )}
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 4 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15 }}>People</h3>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Connect each Telegram user to their record. Drivers get reminders; dispatch staff
            can approve BOL notices from the group.
          </p>
        </div>
        <table className="data">
          <thead><tr><th>Telegram</th><th>Username</th><th>Connected to</th></tr></thead>
          <tbody>
            {(identities.data || []).map((i) => {
              const current = i.driver_id ? `driver:${i.driver_id}`
                : i.employee_id ? `employee:${i.employee_id}` : '';
              return (
                <tr key={i.id} className="norow">
                  <td style={{ fontWeight: 600 }}>{i.display_name || i.telegram_user_id}</td>
                  <td className="small">{i.username ? `@${i.username}` : <span className="muted">no username — can't be tagged</span>}</td>
                  <td>
                    {editable ? (
                      <select value={current} style={{ padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6, maxWidth: 260 }}
                        onChange={(e) => {
                          const [kind, id] = e.target.value.split(':');
                          setIdentity.mutate({ id: i.id, field: kind === 'driver' ? 'driver_id' : kind === 'employee' ? 'employee_id' : 'none', value: id });
                        }}>
                        <option value="">— not connected —</option>
                        <optgroup label="Drivers">
                          {(refs.data?.drivers || []).map((dv) => (
                            <option key={dv.id} value={`driver:${dv.id}`}>{dv.full_name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Office staff">
                          {(refs.data?.employees || []).map((e) => (
                            <option key={e.id} value={`employee:${e.id}`}>{e.full_name} ({e.department})</option>
                          ))}
                        </optgroup>
                      </select>
                    ) : (current ? 'connected' : '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {identities.data?.length === 0 && (
          <Empty head="Nobody registered yet"
            sub="Ask everyone in the truck groups to send /register once." />
        )}
      </div>
    </>
  );
}
