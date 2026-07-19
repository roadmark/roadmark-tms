import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../app/AuthProvider';
import { ago } from '../lib/format';

export default function Notifications() {
  const { companyId, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['notifications', companyId, user?.id],
    enabled: !!companyId && !!user?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications')
        .select('id, kind, title, body, read_at, created_at')
        .eq('company_id', companyId).eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });

  const markRead = useMutation({
    mutationFn: async () => {
      const ids = (list.data || []).filter((n) => !n.read_at).map((n) => n.id);
      if (!ids.length) return;
      const { error } = await supabase.from('notifications')
        .update({ read_at: new Date().toISOString() }).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = (list.data || []).filter((n) => !n.read_at).length;

  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" title="Notifications" onClick={() => setOpen((o) => !o)}>
        ✦{unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div className="card" style={{ position: 'absolute', top: 42, right: 0, width: 320,
            zIndex: 31, maxHeight: 380, overflowY: 'auto' }}>
            <div className="card-pad" style={{ display: 'flex', alignItems: 'center', padding: '10px 14px' }}>
              <b style={{ fontSize: 13 }}>Notifications</b>
              <div style={{ flex: 1 }} />
              {unread > 0 && (
                <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11.5 }}
                  onClick={() => markRead.mutate()}>Mark read</button>
              )}
            </div>
            {(list.data || []).map((n) => (
              <div key={n.id} style={{ padding: '9px 14px', borderTop: '1px solid var(--line-soft)',
                background: n.read_at ? 'transparent' : 'var(--accent-soft)' }}>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>{n.title}</div>
                {n.body && <div className="small muted">{n.body}</div>}
                <div className="feed-meta">{ago(n.created_at)}</div>
              </div>
            ))}
            {list.data?.length === 0 && (
              <div className="empty" style={{ padding: 26 }}>Nothing yet</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
