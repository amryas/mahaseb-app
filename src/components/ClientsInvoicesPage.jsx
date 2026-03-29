import { useState } from 'react';
import Clients from './Clients';
import Invoices from './Invoices';
import Debts from './Debts';

const TABS = { clients: 'clients', invoices: 'invoices', debts: 'debts' };

export default function ClientsInvoicesPage({
  invoices,
  onAddInvoice,
  onDeleteInvoice,
  onToggleInvoicePaid,
  onToast,
}) {
  const [tab, setTab] = useState(TABS.clients);

  return (
    <>
      <h1 className="page-title">العملاء والبيع بالأجل والفواتير</h1>
      <p className="card-desc" style={{ marginBottom: '1rem' }}>
        إدارة العملاء، الفواتير المستحقة، ومبيعات البيع بالأجل والديون (ذمم مدينة).
      </p>
      <div className="tabs-nav">
        <button
          type="button"
          className={`tab-btn ${tab === TABS.clients ? 'active' : ''}`}
          onClick={() => setTab(TABS.clients)}
        >
          العملاء
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === TABS.invoices ? 'active' : ''}`}
          onClick={() => setTab(TABS.invoices)}
        >
          الفواتير
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === TABS.debts ? 'active' : ''}`}
          onClick={() => setTab(TABS.debts)}
        >
          البيع بالأجل والديون
        </button>
      </div>
      {tab === TABS.clients && <Clients onToast={onToast} />}
      {tab === TABS.invoices && (
        <Invoices
          invoices={invoices}
          onAdd={onAddInvoice}
          onDelete={onDeleteInvoice}
          onTogglePaid={onToggleInvoicePaid}
          noTitle
        />
      )}
      {tab === TABS.debts && <Debts onToast={onToast} noTitle />}
    </>
  );
}
