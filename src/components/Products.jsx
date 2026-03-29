import { useState, useEffect, useMemo, useRef } from 'react';
import { getSettings, formatCurrency, getProducts } from '../data/store';
import { useSubscription } from '../hooks/useSubscription';
import { useUsageLimits } from '../hooks/useUsageLimits';
import LimitReachedModal from './LimitReachedModal';
import { addProduct, updateProduct, deleteProduct, PRODUCTS_EVENTS } from '../data/productsWriteService';
import { useProductsCursor } from '../hooks/useProductsCursor';
import { getLowStockProducts } from '../data/aggregatesService';
import VirtualTableBody from './VirtualTableBody';
import AppButton from './ui/AppButton';
import Card, { CardHeader } from './ui/Card';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';

const UNITS = ['قطعة', 'كارتون', 'كيلو', 'لتر', 'متر', 'علبة', 'أخرى'];

export default function Products({ onToast, onGoToSubscription }) {
  const { isExpired, canWrite } = useSubscription();
  const { canAddProduct, loading: limitsLoading, refresh: refreshLimits } = useUsageLimits();
  const { items, loading: tableLoading, loadingMore, hasMore, error: tableError, loadMore, refresh: refreshProductCursor } = useProductsCursor();
  const [lowStockRows, setLowStockRows] = useState([]);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [inventoryVersion, setInventoryVersion] = useState(0);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [unit, setUnit] = useState(UNITS[0]);
  const [costPrice, setCostPrice] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickQty, setQuickQty] = useState('1');
  const formCardRef = useRef(null);
  const tableScrollRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);

  const reloadLowStock = () => {
    void getLowStockProducts(100).then((rows) => setLowStockRows(rows));
  };

  useEffect(() => {
    reloadLowStock();
  }, []);

  useEffect(() => {
    const onInv = () => {
      reloadLowStock();
      setInventoryVersion((v) => v + 1);
    };
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(PRODUCTS_EVENTS.CHANGED, onInv);
    return () => window.removeEventListener(PRODUCTS_EVENTS.CHANGED, onInv);
  }, []);

  // Fallback: لو Cursor/IndexedDB رجّع فاضي (أو المستخدم عنده IDB قديم/ملخبط)، اعرض منتجات الـcache.
  // ده بيحل حالة: البيع شايف منتجات (من cache) لكن المخزون بيقول "لا يوجد".
  const cacheProducts = useMemo(() => getProducts(), [inventoryVersion]);
  const displayItems = items.length > 0 ? items : cacheProducts;
  const filteredDisplayItems = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return displayItems;
    return displayItems.filter((p) => (p.name || '').toLowerCase().includes(q));
  }, [displayItems, tableSearch]);

  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || !hasMore || tableLoading) return undefined;
    const root = tableScrollRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root: root || null, rootMargin: '160px', threshold: 0 }
    );
    io.observe(el);
    // Scroll-stall recovery: if IntersectionObserver misses the trigger, we re-check near-bottom.
    const interval = window.setInterval(() => {
      if (!hasMore || loadingMore || !el) return;
      const rootBottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
      const sentinelTop = el.getBoundingClientRect().top;
      if (sentinelTop <= rootBottom + 140) void loadMore();
    }, 2500);

    return () => {
      io.disconnect();
      window.clearInterval(interval);
    };
  }, [hasMore, loadMore, tableLoading, loadingMore, items.length]);

  useEffect(() => {
    if (editingId && formCardRef.current) {
      formCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [editingId]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!canWrite) return;
    if (!limitsLoading && canAddProduct === false) {
      setLimitModalOpen(true);
      return;
    }
    const q = parseInt(quantity, 10) || 0;
    const min = parseInt(minQuantity, 10) || 0;
    const cost = parseFloat(costPrice) || 0;
    if (!name.trim()) return;
    const payload = { name: name.trim(), quantity: q, minQuantity: min, unit, costPrice: cost };
    if (editingId) {
      const wr = await updateProduct(editingId, payload);
      if (!wr.ok) {
        if (wr.error === 'subscription_required' || wr.code === 'SUBSCRIPTION_REQUIRED') {
          onToast?.('انتهت الفترة التجريبية أو الاشتراك — لا يمكن التعديل.', 'error');
          onGoToSubscription?.();
        } else {
          onToast?.('تعذر حفظ المنتج محلياً.', 'error');
        }
        return;
      }
      void refreshProductCursor();
      reloadLowStock();
      setEditingId(null);
      onToast?.('تم التعديل');
    } else {
      const wr = await addProduct(payload);
      if (!wr.ok) {
        if (wr.error === 'subscription_required' || wr.code === 'SUBSCRIPTION_REQUIRED') {
          onToast?.('انتهت الفترة التجريبية أو الاشتراك — لا يمكن الإضافة.', 'error');
          onGoToSubscription?.();
        } else if (wr.error === 'plan_limit_reached' || wr.code === 'PLAN_LIMIT_REACHED') {
          setLimitModalOpen(true);
        } else {
          onToast?.('تعذر حفظ المنتج محلياً.', 'error');
        }
        return;
      }
      void refreshProductCursor();
      reloadLowStock();
      onToast?.('تمت الإضافة');
    }
    setName('');
    setCostPrice('');
    setQuantity('');
    setMinQuantity('');
    setUnit(UNITS[0]);
    refreshLimits();
  };

  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!canWrite) return;
    if (!limitsLoading && canAddProduct === false) {
      setLimitModalOpen(true);
      return;
    }
    if (!quickName.trim()) return;
    const q = parseInt(quickQty, 10) || 0;
    const payload = { name: quickName.trim(), quantity: q, minQuantity: 0, unit: UNITS[0], costPrice: 0 };
    const wr = await addProduct(payload);
    if (!wr.ok) {
      if (wr.error === 'subscription_required' || wr.code === 'SUBSCRIPTION_REQUIRED') {
        onToast?.('انتهت الفترة التجريبية أو الاشتراك — لا يمكن الإضافة.', 'error');
        onGoToSubscription?.();
      } else if (wr.error === 'plan_limit_reached' || wr.code === 'PLAN_LIMIT_REACHED') {
        setLimitModalOpen(true);
      } else {
        onToast?.('تعذر حفظ المنتج محلياً.', 'error');
      }
      return;
    }
    void refreshProductCursor();
    reloadLowStock();
    setQuickName('');
    setQuickQty('1');
    onToast?.('تمت الإضافة');
    refreshLimits();
  };

  const startEdit = (p) => {
    if (!p?.id) return;
    setEditingId(p.id);
    setName(p.name ?? '');
    setQuantity(String(p.quantity ?? 0));
    setMinQuantity(String(p.minQuantity ?? 0));
    setUnit(p.unit || UNITS[0]);
    setCostPrice(p.costPrice != null && p.costPrice !== '' ? String(p.costPrice) : '');
  };

  const handleDelete = async (id) => {
    if (!canWrite) return;
    if (!confirm('حذف المنتج؟')) return;
    const dr = await deleteProduct(id);
    if (!dr.ok) {
      if (dr.error === 'subscription_required' || dr.code === 'SUBSCRIPTION_REQUIRED') {
        onToast?.('انتهت الفترة التجريبية أو الاشتراك — لا يمكن الحذف.', 'error');
        onGoToSubscription?.();
      } else {
        onToast?.('تعذر حذف المنتج محلياً.', 'error');
      }
      return;
    }
    void refreshProductCursor();
    reloadLowStock();
  };

  const lowStock = lowStockRows;
  const settings = getSettings();
  const marginPct = Number(settings.defaultProfitMargin) || 0;
  const suggestedPrice = (cost) => (cost != null && cost > 0 && marginPct > 0 ? cost * (1 + marginPct / 100) : 0);

  const tableEmpty = useMemo(() => !tableLoading && displayItems.length === 0, [tableLoading, displayItems.length]);

  return (
    <>
      <LimitReachedModal
        open={limitModalOpen}
        onClose={() => setLimitModalOpen(false)}
        onGoToSubscription={onGoToSubscription}
      />
      <SectionHeader title="المخزون" subtitle="تابع الجرد وأضف المنتجات بسهولة." />

      {!canWrite && (
        <Card className="border-rose-500/35 bg-rose-950/25">
          <p className="text-sm text-gray-300">
            <strong>وضع العرض فقط.</strong>{' '}
            {isExpired
              ? 'انتهت الفترة التجريبية أو الاشتراك. لا يمكن إضافة أو تعديل أو حذف المنتجات حتى التجديد.'
              : 'لا يمكن تعديل المخزون حالياً — تحقق من الاتصال أو جدّد الاشتراك.'}
          </p>
          {onGoToSubscription && (
            <AppButton className="mt-3" onClick={onGoToSubscription}>
              صفحة الاشتراك
            </AppButton>
          )}
        </Card>
      )}

      {lowStock.length > 0 && (
        <Card className="border-amber-200/80 bg-amber-50/40">
          <CardHeader title="تنبيه: نقص مخزون" subtitle="الكمية الحالية أقل من أو تساوي حد التنبيه." />
          <ul className="mt-4 list-none space-y-2 p-0">
            {lowStock.map((p) => (
              <li key={p.id} className="rounded-xl border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-sm text-gray-100">
                <strong>{p.name}</strong> — المتوفر: {p.quantity} {p.unit || 'قطعة'} (الحد: {p.minQuantity})
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canWrite && (
        <Card>
          <CardHeader title="إضافة سريعة" subtitle="اسم وكمية فقط — باقي التفاصيل من النموذج أدناه عند الحاجة." />
          <form onSubmit={handleQuickAdd} className="mt-6 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
            <div className="form-group min-w-[200px] flex-1">
              <label className="text-sm font-medium text-gray-400">اسم المنتج</label>
              <input
                type="text"
                className="mt-1 w-full rounded-2xl border border-white/10 bg-[#1f2937] px-3 py-2.5 text-white"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="مثال: ماء ١.٥ لتر"
              />
            </div>
            <div className="form-group w-full md:w-32">
              <label className="text-sm font-medium text-gray-400">الكمية</label>
              <input
                type="number"
                min="0"
                className="mt-1 w-full rounded-2xl border border-white/10 bg-[#1f2937] px-3 py-2.5 text-white"
                value={quickQty}
                onChange={(e) => setQuickQty(e.target.value)}
              />
            </div>
            <AppButton type="submit" variant="primary" disabled={!quickName.trim()}>
              إضافة سريعة
            </AppButton>
          </form>
        </Card>
      )}

      {canWrite && (
        <div ref={formCardRef}>
        <Card>
          <CardHeader
            title={editingId ? 'تعديل المنتج' : 'إضافة منتج (كامل)'}
            subtitle="تكلفة الوحدة لحساب الربح عند البيع."
          />
          <form onSubmit={handleAdd} className="mt-6 space-y-6">
            <div className="form-row">
              <div className="form-group">
                <label>اسم المنتج</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المنتج" required />
              </div>
              <div className="form-group">
                <label>تكلفة الوحدة (ج.م)</label>
                <input type="number" min="0" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="سعر التكلفة" />
                {marginPct > 0 && parseFloat(costPrice) > 0 && (
                  <p className="product-suggested-price mt-2 text-sm">
                    سعر بيع مقترح (ربح {marginPct}%): {formatCurrency(parseFloat(costPrice) * (1 + marginPct / 100))}
                  </p>
                )}
              </div>
              <div className="form-group">
                <label>الكمية الحالية</label>
                <input type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label>حد التنبيه (نقص مخزون)</label>
                <input type="number" min="0" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label>الوحدة</label>
                <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <AppButton type="submit">{editingId ? 'حفظ التعديل' : 'إضافة'}</AppButton>
              {editingId && (
                <AppButton type="button" variant="secondary" onClick={() => setEditingId(null)}>
                  إلغاء
                </AppButton>
              )}
            </div>
          </form>
        </Card>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <CardHeader title="قائمة المنتجات" subtitle="جرد المخزون الحالي." className="mb-0 md:flex-1" />
          <div className="w-full min-w-0 md:max-w-sm">
            <label className="text-sm font-medium text-gray-400">بحث في القائمة</label>
            <input
              type="search"
              className="mt-1 w-full rounded-2xl border border-white/10 bg-[#1f2937] px-3 py-2.5 text-white shadow-sm"
              placeholder="ابحث بالاسم..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              aria-label="بحث في المنتجات"
            />
          </div>
        </div>
        {tableError && <p className="mt-4 text-sm text-rose-600">تعذر تحميل القائمة: {tableError}</p>}
        <div className="mt-6">
        {tableLoading && displayItems.length === 0 ? (
          <EmptyState title="جاري تحميل المنتجات..." />
        ) : tableEmpty ? (
          <EmptyState
            title="لا يوجد منتجات حالياً"
            subtitle={canWrite ? 'أضف أول منتج بالإضافة السريعة أو النموذج الكامل.' : 'لتتمكن من الإضافة، جدّد الاشتراك من صفحة الاشتراك.'}
          />
        ) : filteredDisplayItems.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/15 bg-white/[0.04] py-8 text-center text-sm text-gray-400">لا توجد نتائج للبحث.</p>
        ) : (
          <div ref={tableScrollRef} className="table-wrap rounded-2xl border border-gray-100" style={{ maxHeight: 'min(70vh, 640px)', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>تكلفة الوحدة</th>
                  <th>سعر مقترح</th>
                  <th>الكمية</th>
                  <th>حد التنبيه</th>
                  <th>الوحدة</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <VirtualTableBody
                parentRef={tableScrollRef}
                items={filteredDisplayItems}
                rowHeight={54}
                colCount={8}
                renderRow={(p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{formatCurrency(p.costPrice ?? 0)}</td>
                    <td>{suggestedPrice(p.costPrice) > 0 ? formatCurrency(suggestedPrice(p.costPrice)) : '—'}</td>
                    <td>
                      <strong>{p.quantity}</strong>
                    </td>
                    <td>{p.minQuantity ?? 0}</td>
                    <td>{p.unit || 'قطعة'}</td>
                    <td>
                      {p.minQuantity != null && p.minQuantity > 0 && p.quantity <= p.minQuantity ? (
                        <span className="badge badge-expense">نقص</span>
                      ) : (
                        <span className="badge badge-paid">متوفر</span>
                      )}
                    </td>
                    <td className="actions-cell">
                      {canWrite ? (
                        <div className="flex flex-nowrap gap-1">
                          <AppButton type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => startEdit(p)}>
                            تعديل
                          </AppButton>
                          <AppButton type="button" variant="danger" className="!px-2 !py-1 text-xs" onClick={() => handleDelete(p.id)}>
                            حذف
                          </AppButton>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                )}
              />
            </table>
            {hasMore && <div ref={loadMoreSentinelRef} style={{ height: 1 }} aria-hidden />}
            {loadingMore && (
              <div className="mt-3 text-center text-sm text-gray-400">جاري تحميل المزيد…</div>
            )}
          </div>
        )}
        </div>
      </Card>

    </>
  );
}
