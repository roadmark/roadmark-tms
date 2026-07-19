import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { canEdit as _canEdit, isAdmin as _isAdmin } from '../data/permissions';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [memberships, setMemberships] = useState([]);
  const [companyId, setCompanyId] = useState(localStorage.getItem('rtms.company') || null);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMemberships([]); return; }
    supabase
      .from('company_members')
      .select('id, role, department, status, company_id, companies(id, name)')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setMemberships(data || []);
        if (data?.length && !data.find((m) => m.company_id === companyId)) {
          setCompanyId(data[0].company_id);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (companyId) localStorage.setItem('rtms.company', companyId);
  }, [companyId]);

  // one realtime channel per active company -> invalidate queries
  useEffect(() => {
    if (!companyId || !session) return;
    const ch = supabase
      .channel(`company:${companyId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', filter: `company_id=eq.${companyId}` },
        () => qc.invalidateQueries())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [companyId, session, qc]);

  const value = useMemo(() => {
    const membership = memberships.find((m) => m.company_id === companyId) || null;
    return {
      session,
      user: session?.user ?? null,
      memberships,
      membership,
      companyId,
      setCompanyId: (id) => { setCompanyId(id); qc.clear(); },
      canEdit: (dept) => _canEdit(membership, dept),
      isAdmin: () => _isAdmin(membership),
      signOut: () => supabase.auth.signOut(),
    };
  }, [session, memberships, companyId, qc]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
