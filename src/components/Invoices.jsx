import { useState, useMemo, useEffect, useRef } from 'react';
import { formatCurrency, formatDate, parseAmount } from '../data/store';
import { buildInvoiceMessage, openWhatsAppWithMessage } from '../utils/whatsappReport';
import { downloadInvoicePdf, shareInvoicePdf } from '../utils/invoicePdf';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';

const INVOICES_PAGE_SIZE = 25;

export default function Invoices({ invoices, onAdd, onDelete, onTogglePaid, noTitle, onLoadMoreInvoices, onLoadArchivedInvoices }) {
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoicesPage, setInvoicesPage] = useState(0);
  const [hasMoreInvoices, setHasMoreInvoices] = useState((invoices?.length || 0) >= INVOICES_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef(null);
  const [archivedPage, setArchivedPage] = useState(0);
  const [archivedHasMore, setArchivedHasMore] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);

  const sortedInvoices = useMemo(
    () => [...(invoices || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [invoices]
  );
  const paginatedInvoices = useMemo(
    () => sortedInvoices.slice(0, (invoicesPage + 1) * INVOICES_PAGE_SIZE),
    [sortedInvoices, invoicesPage]
  );

  useEffect(() => {
    // When first page changes, re-evaluate hasMore.
    if (invoicesPage === 0) setHasMoreInvoices((invoices?.length || 0) >= INVOICES_PAGE_SIZE);
  }, [invoices, invoicesPage]);

  useEffect(() => {
    if (!hasMoreInvoices) {
      setArchivedPage(0);
      setArchivedHasMore(true);
    } else {
      setArchivedHasMore(false);
      setArchivedPage(0);
    }
  }, [hasMoreInvoices]);

  const loadMoreInvoices = async () => {
    if (!onLoadMoreInvoices || !hasMoreInvoices || loadingMore) return;
    const nextPage = invoicesPage + 1;
    const offset = nextPage * INVOICES_PAGE_SIZE;
    setLoadingMore(true);
    try {
      const added = await onLoadMoreInvoices(offset);
      if (!added || added <= 0) {
        setHasMoreInvoices(false);
        return;
      }
      setInvoicesPage(nextPage);
      setHasMoreInvoices(added === INVOICES_PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  const showArchivedOlder =
    typeof onLoadArchivedInvoices === 'function' && !hasMoreInvoices && archivedHasMore && !loadingMore && !loadingArchived;

  const loadArchivedOlder = async () => {
    if (!showArchivedOlder) return;
    setLoadingArchived(true);
    try {
      const serverPage = invoicesPage + archivedPage;
      const addedCount = await onLoadArchivedInvoices(serverPage);
      if (!addedCount || addedCount <= 0) {
        setArchivedHasMore(false);
        return;
      }
      // Treat archived fetch as extending the visible window.
      setInvoicesPage((p) => p + 1);
      setArchivedPage((p) => p + 1);
      if (addedCount < INVOICES_PAGE_SIZE) setArchivedHasMore(false);
    } finally {
      setLoadingArchived(false);
    }
  };

  useEffect(() => {
    if (!sentinelRef.current) return;
    if (!hasMoreInvoices) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        void loadMoreInvoices();
      },
      { root: null, threshold: 0.01 }
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMoreInvoices, loadingMore, invoicesPage, onLoadMoreInvoices]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const amt = parseAmount(amount);
    if (!client.trim() || !amount || amt <= 0) return;
    onAdd({
      id: crypto.randomUUID(),
      client: client.trim(),
      amount: amt,
      description: description.trim() || 'فاتورة',
      dueDate,
      paid: false,
      createdAt: new Date().toISOString(),
    });
    setClient('');
    setAmount('');
    setDescription('');
    setDueDate(new Date().toISOString().slice(0, 10));
  };

  const totalUnpaid = invoices.filter((i) => !i.paid).reduce((s, i) => s + parseAmount(i.amount), 0);
  const totalPaid = invoices.filter((i) => i.paid).reduce((s, i) => s + parseAmount(i.amount), 0);

  return (
    <>
      {noTitle !== true && <SectionHeader title="الفواتير" subtitle="إصدار الفواتير ومتابعة حالتها." />}

      <div className="stat-cards">
        <div className="stat-card expense">
          <div className="stat-label">مستحقة (غير مدفوعة)</div>
          <div className="stat-value">{formatCurrency(totalUnpaid)}</div>
        </div>
        <div className="stat-card income">
          <div className="stat-label">مدفوعة</div>
          <div className="stat-value">{formatCurrency(totalPaid)}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">إصدار فاتورة جديدة</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>العميل / الجهة</label>
              <input
                type="text"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="اسم العميل أو الشركة"
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
                required
              />
            </div>
            <div className="form-group">
              <label>تاريخ الاستحقاق</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>الوصف (اختياري)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="وصف الخدمة أو المنتج"
              />
            </div>
          </div>
          <button type="submit" className="btn-primary">
            إصدار الفاتورة
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="card-title">قائمة الفواتير</h2>
        {invoices.length === 0 ? (
          <EmptyState title="لا توجد فواتير حتى الآن" subtitle="أصدر أول فاتورة من النموذج أعلاه." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>الوصف</th>
                  <th>المبلغ</th>
                  <th>تاريخ الاستحقاق</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.client}</td>
                      <td>{inv.description}</td>
                      <td className="amount-income">{formatCurrency(inv.amount)}</td>
                      <td>{formatDate(inv.dueDate)}</td>
                      <td>
                        <span className={`badge ${inv.paid ? 'badge-paid' : 'badge-unpaid'}`}>
                          {inv.paid ? 'مدفوعة' : 'غير مدفوعة'}
                        </span>
                      </td>
                      <td className="actions-cell">
                        <button
                          type="button"
                          className="btn-pdf"
                          onClick={async () => await downloadInvoicePdf(inv)}
                          title="تحميل فاتورة PDF"
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          className="btn-whatsapp-inline"
                          onClick={async () => {
                            const shared = await shareInvoicePdf(inv);
                            if (!shared) {
                              const phone = prompt('رقم واتساب العميل (لمشاركة الفاتورة)', '');
                              if (phone) {
                                const msg = buildInvoiceMessage(inv);
                                openWhatsAppWithMessage(phone, msg);
                                await downloadInvoicePdf(inv);
                              }
                            }
                          }}
                          title="مشاركة الفاتورة (واتساب أو تحميل PDF)"
                        >
                          مشاركة
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                          onClick={() => onTogglePaid(inv.id)}
                        >
                          {inv.paid ? 'إلغاء الدفع' : 'تسجيل الدفع'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => onDelete(inv.id)}
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loadingMore && <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>جاري تحميل المزيد...</div>}
            {showArchivedOlder && (
              <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                <button type="button" className="btn-primary" onClick={() => void loadArchivedOlder()} disabled={loadingArchived}>
                  {loadingArchived ? 'جاري التحميل...' : 'تحميل بيانات أقدم'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
