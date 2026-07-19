export const DEPARTMENTS = ['dispatch','accounting','safety','fleet','maintenance','tracking'];

export const DEPT_COLORS = {
  dispatch: 'var(--dispatch)', accounting: 'var(--accounting)', safety: 'var(--safety)',
  fleet: 'var(--fleet)', maintenance: 'var(--maintenance)', tracking: 'var(--tracking)',
};

export const canEdit = (m, dept) => !!m && (
  ['master_admin','general_manager'].includes(m.role) ||
  (['manager','team_leader'].includes(m.role) && m.department === dept));

export const canApprove = (m, dept) => !!m && (
  ['master_admin','general_manager'].includes(m.role) ||
  (m.role === 'manager' && m.department === dept));

export const isAdmin = (m) => !!m && ['master_admin','general_manager'].includes(m.role);
