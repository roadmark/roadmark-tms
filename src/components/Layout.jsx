import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../app/AuthProvider';
import { DEPT_COLORS } from '../data/permissions';
import { title } from '../lib/format';
import GlobalSearch from './GlobalSearch';
import Notifications from './Notifications';

const NAV = [
  { section: 'Work', items: [
    { to: '/', label: 'Overview', end: true },
    { to: '/dispatch/board', label: 'Board', dept: 'dispatch' },
    { to: '/dispatch/loads', label: 'Loads', dept: 'dispatch' },
    { to: '/dispatch/activity', label: 'Trip activity', dept: 'dispatch' },
    { to: '/dispatch/customers', label: 'Customers', dept: 'dispatch' },
  ]},
  { section: 'Fleet', items: [
    { to: '/fleet/cases', label: 'Cases', dept: 'maintenance' },
    { to: '/fleet/assignments', label: 'Assignments', dept: 'fleet' },
    { to: '/fleet/units', label: 'Fleet data', dept: 'fleet' },
    { to: '/maintenance', label: 'Maintenance', dept: 'maintenance' },
    { to: '/tracking', label: 'Live map', dept: 'tracking' },
  ]},
  { section: 'Money', items: [
    { to: '/accounting', label: 'Accounting', dept: 'accounting' },
  ]},
  { section: 'Safety', items: [
    { to: '/safety/drivers', label: 'Drivers', dept: 'safety' },
    { to: '/safety/compliance', label: 'Compliance', dept: 'safety' },
    { to: '/safety/insurance', label: 'Insurance', dept: 'safety' },
  ]},
  { section: 'Admin', items: [
    { to: '/assistants', label: 'Assistants' },
    { to: '/admin', label: 'Company & users' },
    { to: '/admin/integrations', label: 'ELD' },
    { to: '/admin/assistants', label: 'Telegram' },
    { to: '/admin/email', label: 'Broker email' },
  ]},
];

const TITLES = {
  '/': 'Overview', '/dispatch/board': 'Dispatch board', '/dispatch/loads': 'Loads',
  '/dispatch/activity': 'Trip activity', '/dispatch/customers': 'Customers',
  '/fleet/cases': 'Cases', '/fleet/assignments': 'Assignments', '/fleet/units': 'Fleet data',
  '/maintenance': 'Maintenance', '/tracking': 'Live map', '/accounting': 'Accounting',
  '/safety/drivers': 'Drivers', '/safety/compliance': 'Compliance', '/safety/insurance': 'Insurance',
  '/assistants': 'Assistants', '/admin': 'Company & users', '/admin/integrations': 'ELD & integrations',
  '/admin/assistants': 'Telegram setup', '/admin/email': 'Broker email',
};

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('rtms.theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rtms.theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

export default function Layout() {
  const { membership, memberships, companyId, setCompanyId, user, signOut } = useAuth();
  const loc = useLocation();
  const [theme, setTheme] = useTheme();
  const initial = (user?.email || '?')[0].toUpperCase();

  return (
    <div className="frame">
      <aside className="sidebar">
        <div className="brand">
          R<span className="dot" />admark <span className="sub">TMS</span>
        </div>

        <div className="who-card">
          <div className="who-avatar">{initial}</div>
          <div style={{ minWidth: 0 }}>
            <div className="who-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.email?.split('@')[0]}
            </div>
            <div className="who-role">
              {membership ? `${title(membership.role)}${membership.department ? ' · ' + membership.department : ''}` : 'no access'}
            </div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((s) => (
            <div key={s.section}>
              <div className="nav-section">{s.section}</div>
              {s.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}>
                  {i.dept
                    ? <span className="dept-dot" style={{ background: DEPT_COLORS[i.dept] }} />
                    : <span className="dept-dot" style={{ background: 'var(--text-3)' }} />}
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h1>{TITLES[loc.pathname] || 'Roadmark TMS'}</h1>
          <div className="spacer" />
          <GlobalSearch />
          <button className="icon-btn" title="Switch theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <Notifications />
          <select className="company-switch" value={companyId || ''}
            onChange={(e) => setCompanyId(e.target.value)} aria-label="Active company">
            {memberships.map((m) => (
              <option key={m.company_id} value={m.company_id}>{m.companies?.name}</option>
            ))}
          </select>
        </div>
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
