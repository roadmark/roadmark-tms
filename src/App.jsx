import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuthProvider, { useAuth } from './app/AuthProvider';
import Layout from './components/Layout';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Loads from './pages/dispatch/Loads';
import Customers from './pages/dispatch/Customers';
import Drivers from './pages/safety/Drivers';
import Compliance from './pages/safety/Compliance';
import Insurance from './pages/safety/Insurance';
import Units from './pages/fleet/Units';
import Assignments from './pages/fleet/Assignments';
import Maintenance from './pages/maintenance/Maintenance';
import Accounting from './pages/accounting/Accounting';
import TrackTrace from './pages/tracking/TrackTrace';
import Assistants from './pages/Assistants';
import Admin from './pages/admin/Admin';
import Integrations from './pages/admin/Integrations';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, placeholderData: (p) => p } },
});

function Gate() {
  const { session, memberships, companyId } = useAuth();
  if (session === undefined) return <div className="empty">Loading…</div>;
  if (!session) return <Login />;
  if (!memberships.length) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Almost there</h1>
          <div className="roadline" />
          <p>You're signed in, but this account isn't a member of any company yet.
            Run the membership insert from <b>DEMO_SETUP.md §5</b>, then refresh.</p>
        </div>
      </div>
    );
  }
  if (!companyId) return <div className="empty">Loading…</div>;
  return <Layout />;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Gate />}>
              <Route path="/" element={<Overview />} />
              <Route path="/dispatch/loads" element={<Loads />} />
              <Route path="/dispatch/customers" element={<Customers />} />
              <Route path="/safety/drivers" element={<Drivers />} />
              <Route path="/safety/compliance" element={<Compliance />} />
              <Route path="/safety/insurance" element={<Insurance />} />
              <Route path="/fleet/units" element={<Units />} />
              <Route path="/fleet/assignments" element={<Assignments />} />
              <Route path="/maintenance" element={<Maintenance />} />
              <Route path="/accounting" element={<Accounting />} />
              <Route path="/tracking" element={<TrackTrace />} />
              <Route path="/assistants" element={<Assistants />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/integrations" element={<Integrations />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
