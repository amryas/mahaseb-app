import { useState } from 'react';
import Reports from './Reports';
import DailyReport from './DailyReport';
import AppButton from './ui/AppButton';

const TABS = { reports: 'reports', daily: 'daily' };

export default function ReportsAndDaily({ transactions, invoices, onToast }) {
  const [tab, setTab] = useState(TABS.reports);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="app-page-title m-0">التقارير</h1>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <AppButton
            variant={tab === TABS.reports ? 'primary' : 'secondary'}
            size="md"
            className="shadow-sm"
            onClick={() => setTab(TABS.reports)}
          >
            التقارير وإرسال واتساب
          </AppButton>
          <AppButton
            variant={tab === TABS.daily ? 'primary' : 'secondary'}
            size="md"
            className="shadow-sm"
            onClick={() => setTab(TABS.daily)}
          >
            كشف يومي
          </AppButton>
        </div>
      </header>
      {tab === TABS.reports && (
        <Reports transactions={transactions} invoices={invoices} noTitle onToast={onToast} />
      )}
      {tab === TABS.daily && <DailyReport transactions={transactions} noTitle />}
    </div>
  );
}
