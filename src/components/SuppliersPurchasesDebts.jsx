import { useState, useEffect } from 'react';
import {
  getSuppliers,
  saveSuppliers,
  getPurchases,
  savePurchases,
  getDebts,
  saveDebts,
  getSales,
  formatCurrency,
  formatDate,
} from '../data/store';
import { addTransaction } from '../data/transactionsWriteService';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function SuppliersPurchasesDebts({ onToast }) {
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [debts, setDebts] = useState([]);
  const [tab, setTab] = useState('suppliers');

  // نموذج مورد
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supNote, setSupNote] = useState('');
  // نموذج مشتريات
  const [purSupplierId, setPurSupplierId] = useState('');
  const [purAmount, setPurAmount] = useState('');
  const [purDesc, setPurDesc] = useState('');
  const [purDate, setPurDate] = useState(todayStr());
  // نموذج دين (ذمة مدينة)
  const [debtClientName, setDebtClientName] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDueDate, setDebtDueDate] = useState(todayStr());
  const [debtNote, setDebtNote] = useState('');

  useEffect(() => {
    setSuppliers(getSuppliers());
    setPurchases(getPurchases());
    setDebts(getDebts());
  }, []);

  const handleAddSupplier = (e) => {
    e.preventDefault();
    if (!supName.trim()) return;
    const next = [
      ...suppliers,
      { id: crypto.randomUUID(), name: supName.trim(), phone: supPhone.trim(), note: supNote.trim() },
    ];
    saveSuppliers(next);
    setSuppliers(next);
    onToast?.('تمت إضافة المورد');
    setSupName('');
    setSupPhone('');
    setSupNote('');
  };

  const handleAddPurchase = async (e) => {
    e.preventDefault();
    const amount = Number(purAmount);
    if (!amount || amount <= 0) return;
    const supplier = suppliers.find((s) => s.id === purSupplierId);
    const supplierName = supplier ? supplier.name : 'غير محدد';
    const newPur = {
      id: crypto.randomUUID(),
      supplierId: purSupplierId,
      supplierName,
      amount,
      description: purDesc.trim() || 'مشتريات',
      date: purDate,
    };
    const nextPurchases = [...purchases, newPur];
    savePurchases(nextPurchases);
    setPurchases(nextPurchases);
    const tr = await addTransaction({
      id: crypto.randomUUID(),
      type: 'expense',
      description: `مشتريات: ${supplierName} - ${purDesc.trim() || 'مشتريات'}`,
      amount,
      category: 'موردين',
      date: purDate,
      source: 'purchase',
      purchaseId: newPur.id,
    });
    if (!tr.ok) onToast?.('تم حفظ المشتريات لكن تعذر تسجيل المصروف.', 'error');
    else onToast?.('تم تسجيل المشتريات والمصروف');
    setPurAmount('');
    setPurDesc('');
    setPurDate(todayStr());
  };

  const handleAddDebt = (e) => {
    e.preventDefault();
    if (!debtClientName.trim() || !debtAmount || Number(debtAmount) <= 0) return;
    const newDebt = {
      id: crypto.randomUUID(),
      clientName: debtClientName.trim(),
      amount: Number(debtAmount),
      dueDate: debtDueDate,
      note: debtNote.trim(),
      paid: false,
    };
    const next = [...debts, newDebt];
    saveDebts(next);
    setDebts(next);
    onToast?.('تمت إضافة الدين (ذمة مدينة)');
    setDebtClientName('');
    setDebtAmount('');
    setDebtDueDate(todayStr());
    setDebtNote('');
  };

  const markDebtPaid = async (debt) => {
    if (!debt) return;
    const updated = debts.map((d) => (d.id === debt.id ? { ...d, paid: true } : d));
    setDebts(updated);
    saveDebts(updated);
    const tr = await addTransaction({
      id: crypto.randomUUID(),
      type: 'income',
      description: `استلام دين: ${debt.clientName}`,
      amount: debt.amount,
      category: 'مبيعات',
      date: todayStr(),
      source: 'debt_payment',
    });
    if (!tr.ok) onToast?.('تم تحديث الدين لكن تعذر تسجيل الإيراد.', 'error');
    else onToast?.('تم تسجيل الاستلام');
  };

  const unpaidSales = getSales().filter((s) => !s.paid);
  const unpaidDebtsList = debts.filter((d) => !d.paid);
  const allReceivables = [
    ...unpaidSales.map((s) => ({ id: s.id, type: 'sale', clientName: s.clientName, amount: s.total, dueDate: s.date })),
    ...unpaidDebtsList.map((d) => ({ id: d.id, type: 'debt', clientName: d.clientName, amount: d.amount, dueDate: d.dueDate, debt: d })),
  ];

  return (
    <>
      <h1 className="page-title">الموردين والمشتريات والديون على العميل</h1>
      <p className="card-desc" style={{ marginBottom: '1rem' }}>
        إدارة الموردين، تسجيل المشتريات (وتسجيلها كمصروف تلقائياً)، والديون المستحقة لكم من العملاء (ذمم مدينة).
      </p>
      <div className="tabs-nav">
        <button type="button" className={`tab-btn ${tab === 'suppliers' ? 'active' : ''}`} onClick={() => setTab('suppliers')}>
          الموردين
        </button>
        <button type="button" className={`tab-btn ${tab === 'purchases' ? 'active' : ''}`} onClick={() => setTab('purchases')}>
          المشتريات
        </button>
        <button type="button" className={`tab-btn ${tab === 'debts' ? 'active' : ''}`} onClick={() => setTab('debts')}>
          الديون (ذمم مدينة)
        </button>
      </div>

      {tab === 'suppliers' && (
        <>
          <div className="card">
            <h2 className="card-title">إضافة مورد</h2>
            <form onSubmit={handleAddSupplier}>
              <div className="form-row">
                <div className="form-group">
                  <label>اسم المورد</label>
                  <input type="text" value={supName} onChange={(e) => setSupName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>الهاتف</label>
                  <input type="tel" value={supPhone} onChange={(e) => setSupPhone(e.target.value)} dir="ltr" />
                </div>
                <div className="form-group">
                  <label>ملاحظة</label>
                  <input type="text" value={supNote} onChange={(e) => setSupNote(e.target.value)} />
                </div>
              </div>
              <button type="submit" className="btn-primary">إضافة مورد</button>
            </form>
          </div>
          <div className="card">
            <h2 className="card-title">قائمة الموردين</h2>
            {suppliers.length === 0 ? (
              <div className="empty-state"><p>لا يوجد موردين مسجلين.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>الاسم</th><th>الهاتف</th><th>ملاحظة</th></tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td dir="ltr">{s.phone || '—'}</td>
                        <td>{s.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'purchases' && (
        <>
          <div className="card">
            <h2 className="card-title">تسجيل مشتريات</h2>
            <p className="card-desc">يتم تسجيل المبلغ كمصروف تلقائياً تحت فئة «موردين».</p>
            <form onSubmit={handleAddPurchase}>
              <div className="form-row">
                <div className="form-group">
                  <label>المورد</label>
                  <select value={purSupplierId} onChange={(e) => setPurSupplierId(e.target.value)}>
                    <option value="">— اختر —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>المبلغ (ج.م)</label>
                  <input type="number" min="0.01" step="0.01" value={purAmount} onChange={(e) => setPurAmount(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>التاريخ</label>
                  <input type="date" value={purDate} onChange={(e) => setPurDate(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>الوصف</label>
                  <input type="text" value={purDesc} onChange={(e) => setPurDesc(e.target.value)} placeholder="وصف المشتريات" />
                </div>
              </div>
              <button type="submit" className="btn-primary">تسجيل المشتريات</button>
            </form>
          </div>
          <div className="card">
            <h2 className="card-title">سجل المشتريات</h2>
            {purchases.length === 0 ? (
              <div className="empty-state"><p>لا توجد مشتريات مسجلة.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>التاريخ</th><th>المورد</th><th>المبلغ</th><th>الوصف</th></tr>
                  </thead>
                  <tbody>
                    {[...purchases].sort((a, b) => new Date(b.date) - new Date(a.date)).map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(p.date)}</td>
                        <td>{p.supplierName}</td>
                        <td className="amount-expense">{formatCurrency(p.amount)}</td>
                        <td>{p.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'debts' && (
        <>
          <div className="card">
            <h2 className="card-title">إضافة دين (ذمة مدينة)</h2>
            <p className="card-desc">مبلغ مستحق لكم من عميل أو جهة.</p>
            <form onSubmit={handleAddDebt}>
              <div className="form-row">
                <div className="form-group">
                  <label>اسم العميل / الجهة</label>
                  <input type="text" value={debtClientName} onChange={(e) => setDebtClientName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>المبلغ (ج.م)</label>
                  <input type="number" min="0.01" step="0.01" value={debtAmount} onChange={(e) => setDebtAmount(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>تاريخ الاستحقاق</label>
                  <input type="date" value={debtDueDate} onChange={(e) => setDebtDueDate(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>ملاحظة</label>
                  <input type="text" value={debtNote} onChange={(e) => setDebtNote(e.target.value)} />
                </div>
              </div>
              <button type="submit" className="btn-primary">إضافة دين</button>
            </form>
          </div>
          <div className="card">
            <h2 className="card-title">المستحقات (مبيعات آجلة + ديون)</h2>
            {allReceivables.length === 0 ? (
              <div className="empty-state"><p>لا توجد مستحقات.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>النوع</th><th>العميل</th><th>المبلغ</th><th>الاستحقاق</th><th></th></tr>
                  </thead>
                  <tbody>
                    {allReceivables.map((r) => (
                      <tr key={r.id + r.type}>
                        <td>{r.type === 'sale' ? <span className="badge badge-unpaid">بيع آجل</span> : <span className="badge badge-expense">دين</span>}</td>
                        <td>{r.clientName}</td>
                        <td className="amount-income">{formatCurrency(r.amount)}</td>
                        <td>{formatDate(r.dueDate)}</td>
                        <td>
                          {r.type === 'debt' && r.debt && (
                            <button type="button" className="btn-primary btn-sm" onClick={() => markDebtPaid(r.debt)}>استلام</button>
                          )}
                          {r.type === 'sale' && <span className="text-muted">تسجيل الاستلام من صفحة المبيعات</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
