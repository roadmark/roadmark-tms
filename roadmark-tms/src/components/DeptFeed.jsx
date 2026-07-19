import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../app/AuthProvider';
import { Chip, Empty, ErrorNote } from './ui';
import { DEPT_COLORS } from '../data/permissions';
import { ago, title } from '../lib/format';

/** "Assistant activity" panel for one department — the bot actions that involved it. */
export default function DeptFeed({ dept, title: heading }) {
  const { companyId } = useAuth();
  const feed = useQuery({
    queryKey: ['activity', companyId, dept],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_department_activity')
        .select('*')
        .eq('company_id', companyId)
        .eq('department', dept)
        .order('happened_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="card">
      <div className="card-pad">
        <div className="page-head" style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 16 }}>
            <span style={{ color: DEPT_COLORS[dept] }}>●</span>{' '}
            {heading || `${title(dept)} — assistant activity`}
          </h2>
        </div>
        <ErrorNote error={feed.error} />
        {feed.data?.length === 0 && (
          <Empty head="No assistant activity yet"
            sub="When the bots go live, every action that involves this department shows here." />
        )}
        {(feed.data || []).map((r) => (
          <div className="feed-item" key={r.source + r.source_id}>
            <div className="feed-rail" style={{ background: DEPT_COLORS[dept] }} />
            <div style={{ flex: 1 }}>
              <div className="feed-title">{r.title}</div>
              <div className="feed-meta">{title(r.source)} · {ago(r.happened_at)}</div>
            </div>
            <Chip value={r.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
