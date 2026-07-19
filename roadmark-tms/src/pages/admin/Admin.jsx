import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Empty, ErrorNote } from '../../components/ui';
import { title } from '../../lib/format';

export default function Admin() {
  const { companyId, isAdmin } = useAuth();

  const members = useQuery({
    queryKey: ['members', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('company_members')
        .select('id, role, department, status, profiles(full_name, email)')
        .eq('company_id', companyId).order('role');
      if (error) throw error;
      return data;
    },
  });

  const company = useQuery({
    queryKey: ['company', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies')
        .select('name, dba, mc_number, dot_number, address, city, state, phone, email')
        .eq('id', companyId).single();
      if (error) throw error;
      return data;
    },
  });

  const c = company.data;
  return (
    <>
      <ErrorNote error={members.error || company.error} />
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 16 }}>Company</h3>
          {c ? (
            <div className="small" style={{ display: 'grid', gap: 5 }}>
              <div><b>{c.name}</b>{c.dba ? ` (dba ${c.dba})` : ''}</div>
              <div className="muted">MC {c.mc_number || '—'} · DOT {c.dot_number || '—'}</div>
              <div className="muted">{[c.address, c.city, c.state].filter(Boolean).join(', ') || '—'}</div>
              <div className="muted">{c.phone || '—'} · {c.email || '—'}</div>
            </div>
          ) : <div className="muted small">Loading…</div>}
        </div>
        <div className="card card-pad">
          <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 16 }}>Adding users (demo)</h3>
          <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>
            <li>Supabase Dashboard → Authentication → Users → <b>Invite user</b>.</li>
            <li>They open the invite email and set a password.</li>
            <li>SQL Editor: insert their membership into <code>company_members</code> with a role
              (+ department for managers/team leaders). See DEMO_SETUP.md §5.</li>
          </ol>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The full build does all of this from this screen (invite email, role picker, suspend).
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16 }}>Users &amp; roles</h3>
        </div>
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th></tr></thead>
          <tbody>
            {(members.data || []).map((m) => (
              <tr key={m.id} className="norow">
                <td style={{ fontWeight: 600 }}>{m.profiles?.full_name || '—'}</td>
                <td>{m.profiles?.email}</td>
                <td>{title(m.role)}</td>
                <td>{m.department ? title(m.department) : '—'}</td>
                <td>{m.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.data?.length === 0 && <Empty head="No members" sub="Insert your membership per DEMO_SETUP.md." />}
        {!isAdmin() && <div className="card-pad small muted">You see this read-only; admins manage users.</div>}
      </div>
    </>
  );
}
