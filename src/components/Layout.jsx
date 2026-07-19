import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../app/AuthProvider';
import { DEPT_COLORS } from '../data/permissions';
import { title } from '../lib/format';
import GlobalSearch from './GlobalSearch';
import Notifications from './Notifications';

const NAV = [
  { section: '', items: [
    { to: '/', label: 'Overview', end: true },
  ]},
  { section: 'Dispatch', items: [
    { to: '/dispatch/board', label: 'Board', dept: 'dispatch' },
    { to: '/dispatch/loads', label: 'Loads', dept: 'dispatch' },
    { to: '/dispatch/activity', label: 'Trip activity', dept: 'dispatch' },
    { to: '/dispatch/customers', label: 'Customers', dept: 'dispatch' },
  ]},
  { section: 'Accounting', items: [
    { to: '/accounting/loads', label: 'Loads', dept: 'accounting' },
    { to: '/accounting/settlements', label: 'Settlements', dept: 'accounting' },
    { to: '/accounting/invoices', label: 'Invoices', dept: 'accounting' },
    { to: '/accounting/payroll', label: 'Payroll', dept: 'accounting' },
    { to: '/admin', label: 'Company & users' },
  ]},
  { section: 'Safety', items: [
    { to: '/safety/drivers', label: 'Drivers', dept: 'safety' },
    { to: '/safety/insurance', label: 'Insurance', dept: 'safety' },
    { to: '/safety/compliance', label: 'Compliance', dept: 'safety' },
  ]},
  { section: 'Fleet', items: [
    { to: '/fleet/cases', label: 'Repair cases', dept: 'maintenance' },
    { to: '/fleet/assignments', label: 'Assignments', dept: 'fleet' },
    { to: '/fleet/trucks', label: 'Trucks', dept: 'fleet' },
    { to: '/fleet/trailers', label: 'Trailers', dept: 'fleet' },
    { to: '/fleet/maintenance', label: 'Maintenance history', dept: 'maintenance' },
    { to: '/fleet/vendors', label: 'Maintenance vendors', dept: 'maintenance' },
  ]},
  { section: 'Admin', items: [
    { to: '/tracking', label: 'Live map', dept: 'tracking' },
    { to: '/assistants', label: 'Assistants' },
    { to: '/admin/integrations', label: 'ELD' },
    { to: '/admin/assistants', label: 'Telegram' },
    { to: '/admin/email', label: 'Broker email' },
  ]},
];

const TITLES = {
  '/': 'Overview', '/dispatch/board': 'Dispatch board', '/dispatch/loads': 'Loads',
  '/dispatch/activity': 'Trip activity', '/dispatch/customers': 'Customers',
  '/accounting/loads': 'Accounting · Loads', '/accounting/settlements': 'Settlements',
  '/accounting/invoices': 'Invoices', '/accounting/payroll': 'Payroll',
  '/safety/drivers': 'Drivers', '/safety/insurance': 'Insurance', '/safety/compliance': 'Compliance',
  '/fleet/trucks': 'Trucks', '/fleet/trailers': 'Trailers',
  '/fleet/maintenance': 'Maintenance history', '/fleet/vendors': 'Maintenance vendors',
  '/fleet/cases': 'Repair cases', '/fleet/assignments': 'Assignments', '/tracking': 'Live map',
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rtms.nav') === 'min');
  useEffect(() => { localStorage.setItem('rtms.nav', collapsed ? 'min' : 'full'); }, [collapsed]);
  const initial = (user?.email || '?')[0].toUpperCase();

  return (
    <div className="frame">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          R<span className="dot" />
          <span className="hide-collapsed">admark <span className="sub">TMS</span></span>
        </div>

        <div className="who-card">
          <div className="who-avatar">{initial}</div>
          <div style={{ minWidth: 0 }} className="hide-collapsed">
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
              {s.section && <div className="nav-section hide-collapsed">{s.section}</div>}
              {s.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dept-dot"
                    style={{ background: i.dept ? DEPT_COLORS[i.dept] : 'var(--text-3)' }} />
                  <span className="hide-collapsed">{i.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button onClick={() => setCollapsed((v) => !v)} title="Collapse menu">
            {collapsed ? '»' : '« Collapse'}
          </button>
          <button onClick={signOut}>{collapsed ? '⏻' : 'Sign out'}</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h1>{TITLES[loc.pathname] || 'Roadmark TMS'}</h1>
          <div className="spacer" />
          <GlobalSearch />
          <div className="theme-pill">
            <button className={theme === 'light' ? 'on' : ''} title="Light"
              onClick={() => setTheme('light')}>☀</button>
            <button className={theme === 'dark' ? 'on' : ''} title="Dark"
              onClick={() => setTheme('dark')}>☾</button>
          </div>
          <Notifications />
          <div className="company-chip">
            <select value={companyId || ''} onChange={(e) => setCompanyId(e.target.value)}
              aria-label="Active company">
              {memberships.map((m) => (
                <option key={m.company_id} value={m.company_id}>{m.companies?.name}</option>
              ))}
            </select>
            <span className="who-avatar" style={{ width: 24, height: 24, fontSize: 11 }}>{initial}</span>
          </div>
        </div>
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
