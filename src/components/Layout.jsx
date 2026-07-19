import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../app/AuthProvider';
import { DEPT_COLORS } from '../data/permissions';
import { title } from '../lib/format';

const NAV = [
  { section: 'Operate', items: [
    { to: '/', label: 'Overview', end: true },
    { to: '/dispatch/loads', label: 'Loads', dept: 'dispatch' },
    { to: '/dispatch/customers', label: 'Customers', dept: 'dispatch' },
    { to: '/tracking', label: 'Track & Trace', dept: 'tracking' },
  ]},
  { section: 'Money', items: [
    { to: '/accounting', label: 'Accounting', dept: 'accounting' },
  ]},
  { section: 'People & Equipment', items: [
    { to: '/safety/drivers', label: 'Safety · Drivers', dept: 'safety' },
    { to: '/safety/compliance', label: 'Compliance', dept: 'safety' },
    { to: '/safety/insurance', label: 'Insurance', dept: 'safety' },
    { to: '/fleet/units', label: 'Fleet · Units', dept: 'fleet' },
    { to: '/fleet/assignments', label: 'Assignments', dept: 'fleet' },
    { to: '/maintenance', label: 'Maintenance', dept: 'maintenance' },
  ]},
  { section: 'Automation', items: [
    { to: '/assistants', label: 'Assistants' },
  ]},
  { section: 'Admin', items: [
    { to: '/admin', label: 'Company & Users' },
  ]},
];

const TITLES = {
  '/': 'Overview', '/dispatch/loads': 'Loads', '/dispatch/customers': 'Customers',
  '/tracking': 'Track & Trace', '/accounting': 'Accounting', '/safety/drivers': 'Drivers', '/safety/compliance': 'Compliance', '/safety/insurance': 'Insurance',
  '/fleet/units': 'Trucks & Trailers', '/fleet/assignments': 'Assignments', '/maintenance': 'Maintenance',
  '/assistants': 'Assistants', '/admin': 'Company & Users',
};

export default function Layout() {
  const { membership, memberships, companyId, setCompanyId, user, signOut } = useAuth();
  const loc = useLocation();

  return (
    <div className="frame">
      <aside className="sidebar">
        <div className="brand">
          Roadmark <span className="tag">TMS</span>
        </div>
        <nav className="nav">
          {NAV.map((s) => (
            <div key={s.section}>
              <div className="nav-section">{s.section}</div>
              {s.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}>
                  {i.dept && <span className="dept-dot" style={{ background: DEPT_COLORS[i.dept] }} />}
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">{user?.email}</div>
          <div className="role">
            {membership ? `${title(membership.role)}${membership.department ? ' · ' + title(membership.department) : ''}` : 'No membership'}
          </div>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h1>{TITLES[loc.pathname] || 'Roadmark TMS'}</h1>
          <div className="spacer" />
          <select
            className="company-switch"
            value={companyId || ''}
            onChange={(e) => setCompanyId(e.target.value)}
            aria-label="Active company"
          >
            {memberships.map((m) => (
              <option key={m.company_id} value={m.company_id}>{m.companies?.name}</option>
            ))}
          </select>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
