import { useState } from 'react';
import { useAuth } from '../../app/AuthProvider';
import Settlements from './Settlements';
import { BalancesOverview, Charges, DeductionsTable } from './Accounting';
import Scheduled from './Scheduled';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'statements', label: 'Statements' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'toll', label: 'Tolls' },
  { id: 'deductions', label: 'Deductions' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'credit', label: 'Credit' },
  { id: 'balance', label: 'Balance due' },
];

export default function SettlementsHub() {
  const { companyId, canEdit } = useAuth();
  const [tab, setTab] = useState('overview');
  const editable = canEdit('accounting');

  return (
    <>
      <div className="page-head">
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'overview' && <BalancesOverview companyId={companyId} />}
      {tab === 'statements' && <Settlements />}
      {tab === 'fuel' && <Charges kind="fuel" companyId={companyId} editable={editable} />}
      {tab === 'toll' && <Charges kind="toll" companyId={companyId} editable={editable} />}
      {tab === 'deductions' && <DeductionsTable companyId={companyId} />}
      {tab === 'scheduled' && <Scheduled kind="scheduled" />}
      {tab === 'credit' && <Scheduled kind="credit" />}
      {tab === 'balance' && <Scheduled kind="balance" />}
    </>
  );
}
