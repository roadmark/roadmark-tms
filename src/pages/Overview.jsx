import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../app/AuthProvider';
import { Chip, DeptChip, Empty, ErrorNote } from '../components/ui';
import { ago, title } from '../lib/format';

const count = async (table, cid, filters = (q) => q) => {
  const { count: n, error } = await filters(
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('company_id', cid)
  );
  if (error) throw error;
  return n ?? 0;
};

export default function Overview() {
  const { companyId } = useAuth();

  const stats = useQuery({
    queryKey: ['overview', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [drivers, trucks, trailers, loadsActive, loadsScheduled, customers] = await Promise.all([
        count('drivers', companyId, (q) => q.eq('status', 'active')),
        count('trucks', companyId),
        count('trailers', companyId),
        count('loads', companyId, (q) => q.eq('status', 'in_progress')),
        count('loads', companyId, (q) => q.eq('status', 'scheduled')),
        count('customers', companyId),
      ]);
      return { drivers, trucks, trailers, loadsActive, loadsScheduled, customers };
    },
  });

  const feed = useQuery({
    queryKey: ['activity', companyId, 'all'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_department_activity')
        .select('*')
        .eq('company_id', companyId)
        .order('happened_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      // collapse duplicates (same event shown once with all departments)
      const seen = new Map();
      for (const r of data) {
        const k = r.source + r.source_id;
        if (!seen.has(k)) seen.set(k, { ...r, departments: [r.department] });
        else seen.get(k).departments.push(r.department);
      }
      return [...seen.values()].slice(0, 15);
    },
  });

  const s = stats.data;
  return (
    <>
      <ErrorNote error={stats.error || feed.error} />
      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <StatCard label="Active drivers" value={s?.drivers} />
        <StatCard label="Trucks" value={s?.trucks} />
        <StatCard label="Trailers" value={s?.trailers} />
        <StatCard label="Customers" value={s?.customers} />
        <StatCard label="Loads in progress" value={s?.loadsActive} />
        <StatCard label="Loads scheduled" value={s?.loadsScheduled} />
      </div>

      <div className="card">
        <div className="card-pad">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <h2 style={{ fontSize: 16 }}>Assistant activity — all departments</h2>
          </div>
          {feed.data?.length === 0 && (
            <Empty head="No assistant activity yet"
              sub="Bot actions (BOL notices, tracking updates, PTI screenings, alerts) appear here and in each department's module." />
          )}
          {(feed.data || []).map((r) => (
            <div className="feed-item" key={r.source + r.source_id}>
              <div className="feed-rail" style={{ background: 'var(--accent)' }} />
              <div style={{ flex: 1 }}>
                <div className="feed-title">{r.title}</div>
                <div className="feed-meta">
                  {title(r.source)} · {ago(r.happened_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {r.departments.map((dp) => <DeptChip key={dp} dept={dp} />)}
                <Chip value={r.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num">{value ?? '·'}</div>
    </div>
  );
}
