import { useState, useMemo } from 'react';
import { formatCurrency, formatDate, getDailyOpening, saveDailyOpening, getSales, getSaleTotal, getSaleProfit, parseAmount } from '../data/store';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function DailyReport({ transactions, noTitle }) {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [openingInput, setOpeningInput] = useState('');
  const dailyOpening = getDailyOpening();

  const dayIncome = useMemo(() => {
    return transactions
      .filter((t) => t.type === 'income' && t.date === selectedDate)
      .reduce((s, t) => s + parseAmount(t.amount), 0);
  }, [transactions, selectedDate]);

  const dayExpense = useMemo(() => {
    return transactions
      .filter((t) => t.type === 'expense' && t.date === selectedDate)
      .reduce((s, t) => s + parseAmount(t.amount), 0);
  }, [transactions, selectedDate]);

  const daySales = useMemo(() => {
    const sales = getSales().filter((s) => (s.status || 'completed') === 'completed' && s.date === selectedDate);
    return {
      list: sales,
      total: sales.reduce((sum, s) => sum + getSaleTotal(s), 0),
      profit: sales.reduce((sum, s) => sum + getSaleProfit(s), 0),
      count: sales.length,
    };
  }, [selectedDate]);

  const savedOpening = dailyOpening[selectedDate] != null ? dailyOpening[selectedDate] : null;
  const opening = openingInput !== '' ? parseAmount(openingInput) : (savedOpening ?? 0);
  const expectedBalance = opening + dayIncome - dayExpense;

  const saveOpening = () => {
    const num = parseAmount(openingInput);
    if (Number.isNaN(num)) return;
    const next = { ...dailyOpening, [selectedDate]: num };
    saveDailyOpening(next);
    setOpeningInput('');
  };

  const dayTransactions = useMemo(() => {
    return [...transactions]
      .filter((t) => t.date === selectedDate)
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  }, [transactions, selectedDate]);

  return (
    <>
      {!noTitle && <h1 className="page-title">كشف يومي</h1>}
      <p className="card-desc" style={{ marginBottom: '1rem' }}>
        رصيد الافتتاح، إيرادات ومصروفات اليوم، والرصيد المتوقع.
      </p>

      <div className="card">
        <h2 className="card-title">اختيار اليوم</h2>
        <div className="form-row">
          <div className="form-group">
            <label>التاريخ</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>رصيد الافتتاح (ج.م)</label>
            <div className="opening-row">
              <input
                type="number"
                step="0.01"
                placeholder={savedOpening != null ? String(savedOpening) : '0'}
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
              />
              <button type="button" className="btn-secondary" onClick={saveOpening}>
                حفظ الرصيد
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="stat-cards daily-report-cards">
        <div className="stat-card total">
          <div className="stat-label">رصيد الافتتاح</div>
          <div className="stat-value">{formatCurrency(opening)}</div>
        </div>
        <div className="stat-card income">
          <div className="stat-label">إيرادات اليوم (حركات)</div>
          <div className="stat-value">{formatCurrency(dayIncome)}</div>
        </div>
        <div className="stat-card expense">
          <div className="stat-label">مصروفات اليوم</div>
          <div className="stat-value">{formatCurrency(dayExpense)}</div>
        </div>
        <div className="stat-card balance">
          <div className="stat-label">الرصيد المتوقع (إغلاق)</div>
          <div className="stat-value">{formatCurrency(expectedBalance)}</div>
        </div>
        <div className="stat-card income">
          <div className="stat-label">مبيعات اليوم</div>
          <div className="stat-value">{formatCurrency(daySales.total)}</div>
          <div className="stat-extra">{daySales.count} فاتورة — ربح: {formatCurrency(daySales.profit)}</div>
        </div>
      </div>

      {daySales.list.length > 0 && (
        <div className="card">
          <h2 className="card-title">مبيعات يوم {formatDate(selectedDate)}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>البنود</th>
                  <th>الإجمالي</th>
                  <th>الربح</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {daySales.list.map((s) => (
                  <tr key={s.id}>
                    <td>{s.clientName || '—'}</td>
                    <td>{Array.isArray(s.items) ? s.items.map((i) => `${i.productName} × ${i.quantity}`).join('، ') : `${s.productName || '—'} × ${s.quantity || 0}`}</td>
                    <td className="amount-income">{formatCurrency(getSaleTotal(s))}</td>
                    <td className={getSaleProfit(s) >= 0 ? 'amount-income' : 'amount-expense'}>{formatCurrency(getSaleProfit(s))}</td>
                    <td>{s.paid ? 'مدفوع' : 'آجل'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="card-title">حركات يوم {formatDate(selectedDate)} (إيراد ومصروف)</h2>
        {dayTransactions.length === 0 ? (
          <div className="empty-state">
            <p>لا توجد حركات في هذا اليوم.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th>الفئة</th>
                  <th>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {dayTransactions.map((t) => (
                  <tr key={t.id}>
                    <td><span className={`badge badge-${t.type}`}>{t.type === 'income' ? 'إيراد' : 'مصروف'}</span></td>
                    <td>{t.description}</td>
                    <td>{t.category}</td>
                    <td className={t.type === 'income' ? 'amount-income' : 'amount-expense'}>
                      {t.type === 'income' ? '+' : '-'} {formatCurrency(t.amount)}
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
