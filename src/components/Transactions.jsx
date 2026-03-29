import { useState, useEffect, useRef } from 'react';
import { getCategories, formatCurrency, formatDate, parseAmount } from '../data/store';
import { useSubscription } from '../hooks/useSubscription';
import { useTransactionsCursor } from '../hooks/useTransactionsCursor';
import { getTransactionSumByType } from '../data/aggregatesService';
import { TRANSACTIONS_EVENTS } from '../data/transactionsWriteService';
import VirtualTableBody from './VirtualTableBody';
import AppButton from './ui/AppButton';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';

export default function Transactions({ type, transactions: _transactions, onAdd, onDelete, onGoToSubscription }) {
  const { canWrite } = useSubscription();
  const readOnly = !canWrite;
  const categories = getCategories();
  const list = type === 'income' ? categories.income : categories.expense;

  const {
    items,
    loading: listLoading,
    loadingMore,
    hasMore,
    error: listError,
    loadMore,
    refresh,
  } = useTransactionsCursor(type);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(list[0] || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [typeTotal, setTypeTotal] = useState(0);

  const tableScrollRef = useRef(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sum = await getTransactionSumByType(type);
      if (!cancelled) setTypeTotal(sum);
    })();
    return () => {
      cancelled = true;
    };
  }, [type]);

  useEffect(() => {
    const onChanged = () => {
      void refresh();
      void getTransactionSumByType(type).then(setTypeTotal);
    };
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(TRANSACTIONS_EVENTS.CHANGED, onChanged);
    return () => window.removeEventListener(TRANSACTIONS_EVENTS.CHANGED, onChanged);
  }, [type, refresh]);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return undefined;
    const el = sentinelRef.current;
    const root = tableScrollRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root: root || null, rootMargin: '100px', threshold: 0.01 }
    );
    io.observe(el);
    // Scroll-stall recovery: re-check near-bottom periodically.
    const interval = window.setInterval(() => {
      if (!hasMore || loadingMore || !el) return;
      const rootBottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
      const sentinelTop = el.getBoundingClientRect().top;
      if (sentinelTop <= rootBottom + 120) void loadMore();
    }, 2500);

    return () => {
      io.disconnect();
      window.clearInterval(interval);
    };
  }, [hasMore, loadMore, loadingMore, items.length]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const amt = parseAmount(amount);
    if (!description.trim() || !amount || amt <= 0) return;
    onAdd({
      id: crypto.randomUUID(),
      type,
      description: description.trim(),
      amount: amt,
      category,
      date,
    });
    setDescription('');
    setAmount('');
    setCategory(list[0] || '');
    setDate(new Date().toISOString().slice(0, 10));
  };

  const title = type === 'income' ? 'إيرادات' : 'مصروفات';
  const typeLabel = type === 'income' ? 'إيراد' : 'مصروف';

  return (
    <>
      <SectionHeader title={title} subtitle={`إدارة ${typeLabel} بسهولة ووضوح.`} />

      {readOnly && (
        <div className="card read-only-banner" style={{ background: '#ffebee', borderColor: '#f44336' }}>
          <p className="card-desc">
            <strong>وضع العرض فقط.</strong> انتهت الفترة التجريبية. لا يمكن تسجيل مصروف جديد حتى تجديد الاشتراك.
            {onGoToSubscription && (
              <AppButton className="mt-2" onClick={onGoToSubscription}>
                صفحة الاشتراك
              </AppButton>
            )}
          </p>
        </div>
      )}

      {!readOnly && (
      <div className="card">
        <h2 className="card-title">إضافة {typeLabel} جديد</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>الوصف</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثال: بيع منتج، دفع إيجار..."
                required
              />
            </div>
            <div className="form-group">
              <label>المبلغ (ج.م)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="form-group">
              <label>الفئة</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {list.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>التاريخ</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <AppButton type="submit">
            إضافة {typeLabel}
          </AppButton>
        </form>
      </div>
      )}

      <div className="card">
        <h2 className="card-title">
          قائمة {title} — إجمالي: <span className={type === 'income' ? 'amount-income' : 'amount-expense'}>{formatCurrency(typeTotal)}</span>
        </h2>
        {listError && (
          <p className="card-desc" style={{ color: 'var(--expense)' }}>تعذر تحميل القائمة: {listError}</p>
        )}
        {listLoading && items.length === 0 ? (
          <EmptyState title="جاري تحميل السجلات..." />
        ) : items.length === 0 ? (
          <EmptyState title="لا توجد سجلات حتى الآن" subtitle={`أضف أول ${typeLabel} من النموذج أعلاه.`} />
        ) : (
          <div ref={tableScrollRef} className="table-wrap" style={{ maxHeight: 'min(70vh, 560px)', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الوصف</th>
                  <th>الفئة</th>
                  <th>المبلغ</th>
                  <th></th>
                </tr>
              </thead>
              <VirtualTableBody
                parentRef={tableScrollRef}
                items={items}
                rowHeight={52}
                colCount={5}
                renderRow={(t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.date)}</td>
                    <td>{t.description}</td>
                    <td>{t.category}</td>
                    <td className={type === 'income' ? 'amount-income' : 'amount-expense'}>
                      {formatCurrency(t.amount)}
                    </td>
                    <td className="actions-cell">
                      {!readOnly && (
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => onDelete(t.id)}
                          aria-label="حذف"
                        >
                          حذف
                        </button>
                      )}
                      {readOnly && <span className="text-muted">—</span>}
                    </td>
                  </tr>
                )}
              />
            </table>
            {hasMore && <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />}
            {loadingMore && (
              <div style={{ marginTop: '0.75rem', textAlign: 'center' }} className="text-muted">
                جاري تحميل المزيد…
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
