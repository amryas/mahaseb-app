import { useState } from 'react';
import {
  getTransactions,
  getInvoices,
  getClients,
  getSettings,
  getProducts,
  getSales,
  getDebts,
  getStockMovements,
  getSuppliers,
  getPurchases,
  getEmployees,
  saveInvoices,
  saveClients,
  saveSettings,
  saveDebts,
  saveStockMovements,
  saveSuppliers,
  savePurchases,
  saveEmployees,
} from '../data/store';
import {
  hydrateTransactionsFromList,
  hydrateProductsFromList,
  hydrateSalesFromList,
  hydrateClientsFromList,
} from '../data/bulkHydration';
import { getFriendlyErrorMessage, logError } from '../utils/userErrorHandler';
import * as XLSX from 'xlsx';

export default function BackupRestore({ onRestore, onToast }) {
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreError, setRestoreError] = useState('');

  const handleExportJson = () => {
    const data = {
      version: 3,
      exportedAt: new Date().toISOString(),
      transactions: getTransactions(),
      invoices: getInvoices(),
      clients: getClients(),
      settings: getSettings(),
      products: getProducts(),
      sales: getSales(),
      debts: getDebts(),
      stockMovements: getStockMovements(),
      suppliers: getSuppliers(),
      purchases: getPurchases(),
      employees: getEmployees(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `محاسب-مشروعي-نسخة-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('تم تصدير النسخة الاحتياطية');
  };

  const handleExportExcel = () => {
    const transactions = getTransactions();
    const rows = [
      ['التاريخ', 'النوع', 'الوصف', 'الفئة', 'المبلغ'],
      ...transactions.map((t) => [t.date, t.type === 'income' ? 'إيراد' : 'مصروف', t.description, t.category, t.amount]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الحركات');
    const inv = getInvoices();
    if (inv.length) {
      const invRows = [['العميل', 'الوصف', 'المبلغ', 'تاريخ الاستحقاق', 'مدفوعة'], ...inv.map((i) => [i.client, i.description, i.amount, i.dueDate, i.paid ? 'نعم' : 'لا'])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invRows), 'الفواتير');
    }
    XLSX.writeFile(wb, `محاسب-مشروعي-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onToast?.('تم تصدير Excel');
  };

  const handleRestore = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setRestoreError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.transactions) await hydrateTransactionsFromList(data.transactions);
        if (data.invoices) saveInvoices(data.invoices);
        if (data.clients) await hydrateClientsFromList(data.clients);
        if (data.settings) saveSettings(data.settings);
        if (data.products) await hydrateProductsFromList(data.products);
        if (data.sales) await hydrateSalesFromList(data.sales);
        if (data.debts) saveDebts(data.debts);
        if (data.stockMovements) saveStockMovements(data.stockMovements);
        if (data.suppliers) saveSuppliers(data.suppliers);
        if (data.purchases) savePurchases(data.purchases);
        if (data.employees) saveEmployees(data.employees);
        onRestore?.();
        onToast?.('تم استعادة النسخة الاحتياطية');
        setRestoreFile(null);
        setTimeout(() => window.location.reload(), 800);
      } catch (err) {
        logError(err, 'BackupRestore');
        setRestoreError(getFriendlyErrorMessage(err));
      }
    };
    reader.readAsText(f);
  };

  return (
    <>
      <h1 className="page-title">النسخ الاحتياطي والتصدير</h1>
      <div className="card">
        <h2 className="card-title">تصدير البيانات</h2>
        <p className="card-desc">
          احفظ نسخة من كل الحركات والفواتير والعملاء والإعدادات على جهازك. يُنصح بالتصدير دورياً.
        </p>
        <div className="backup-actions">
          <button type="button" className="btn-primary" onClick={handleExportJson}>
            تصدير نسخة احتياطية (JSON)
          </button>
          <button type="button" className="btn-secondary" onClick={handleExportExcel}>
            تصدير Excel (حركات + فواتير)
          </button>
        </div>
      </div>
      <div className="card">
        <h2 className="card-title">استعادة نسخة احتياطية</h2>
        <p className="card-desc">
          استعد من ملف JSON المُصدّر سابقاً. سيتم استبدال البيانات الحالية.
        </p>
        <div className="form-group">
          <input type="file" accept=".json" onChange={handleRestore} className="file-input" />
        </div>
        {restoreError && <div className="message message-error">{restoreError}</div>}
      </div>
    </>
  );
}
