import { useState, useEffect } from 'react';
import { getSales, getDebts, saveDebts, formatCurrency, formatDate } from '../data/store';
import { addTransaction } from '../data/transactionsWriteService';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Debts({ onToast, noTitle }) {
  const [debts, setDebts] = useState([]);
  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  useEffect(() => {
    setDebts(getDebts());
  }, []);

  useEffect(() => {
    saveDebts(debts);
  }, [debts]);

  const sales = getSales();
  const unpaidSales = sales.filter((s) => !s.paid);
  const unpaidDebts = debts.filter((d) => !d.paid);

  const allReceivables = [
    ...unpaidSales.map((s) => ({ id: s.id, type: 'sale', clientName: s.clientName, amount: s.total, dueDate: s.date, note: `بيع: ${s.productName}` })),
    ...unpaidDebts.map((d) => ({ id: d.id, type: 'debt', clientName: d.clientName, amount: d.amount, dueDate: d.dueDate, note: d.note || '' })),
  ];

  const today = todayStr();
  const dueSoon = allReceivables.filter((r) => r.dueDate <= today || (new Date(r.dueDate) - new Date(today)) / 86400000 <= 7);

  const handleAddDebt = (e) => {
    e.preventDefault();
    if (!clientName.trim() || !amount || Number(amount) <= 0) return;
    setDebts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), clientName: clientName.trim(), amount: Number(amount), dueDate, note: note.trim(), paid: false },
    ]);
    onToast?.('تمت الإضافة');
    setClientName('');
    setAmount('');
    setDueDate(new Date().toISOString().slice(0, 10));
    setNote('');
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

  return (
    <>
      {noTitle !== true && <h1 className="page-title">الديون والذمم المدينة</h1>}

      {dueSoon.length > 0 && (
        <div className="card alert-card">
          <h2 className="card-title">تنبيه: مستحقات قريبة أو متأخرة</h2>
          <ul className="due-invoices-list">
            {dueSoon.map((r) => (
              <li key={r.id + r.type}>
                <span>{r.clientName}</span>
                <span>{formatCurrency(r.amount)}</span>
                <span className="due-date">{formatDate(r.dueDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 className="card-title">إضافة دين (ذمة مدينة)</h2>
        <p className="card-desc">سجّل مبلغاً مستحقاً لكم من عميل أو جهة (غير مرتبط بفاتورة).</p>
        <form onSubmit={handleAddDebt}>
          <div className="form-row">
            <div className="form-group">
              <label>اسم العميل / الجهة</label>
              <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>المبلغ (ج.م)</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>تاريخ الاستحقاق</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>ملاحظة (اختياري)</label>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary">إضافة</button>
        </form>
      </div>

      <div className="card">
        <h2 className="card-title">إجمالي المستحقات (دفع آجل + ديون)</h2>
        <p className="card-desc">
          مبيعات بانتظار الاستلام + ديون مسجّلة. استخدم «تسجيل استلام» من صفحة المبيعات لمبيعات الآجل، أو «استلام» هنا للديون.
        </p>
        {allReceivables.length === 0 ? (
          <div className="empty-state"><p>لا توجد مستحقات.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>العميل</th>
                  <th>المبلغ</th>
                  <th>الاستحقاق</th>
                  <th>ملاحظة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {allReceivables.map((r) => (
                  <tr key={r.id + r.type}>
                    <td>{r.type === 'sale' ? <span className="badge badge-unpaid">بيع آجل</span> : <span className="badge badge-expense">دين</span>}</td>
                    <td>{r.clientName}</td>
                    <td className="amount-income">{formatCurrency(r.amount)}</td>
                    <td>{formatDate(r.dueDate)}</td>
                    <td>{r.note}</td>
                    <td>
                      {r.type === 'debt' && (
                        <button type="button" className="btn-primary btn-sm" onClick={() => { const d = debts.find((x) => x.id === r.id); markDebtPaid(d); }}>
                          استلام
                        </button>
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
  );
}