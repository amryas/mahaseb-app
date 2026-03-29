import { useState, useEffect, useMemo, useRef } from 'react';
import {
  getProducts,
  getTransactions,
  getSettings,
  addNotification,
  formatCurrency,
  formatDate,
  getSaleTotal,
  getSaleProfit,
  getSaleSummary,
  getClients,
  getCurrentAccountId,
  parseAmount,
} from '../data/store';
import { buildSaleInvoiceForWhatsApp, openWhatsAppWithMessage } from '../utils/whatsappReport';
import { exportSaleInvoicePdf } from '../utils/saleInvoicePdf';
import { useSubscription } from '../hooks/useSubscription';
import { isWorkspaceSaaSEnabled } from '../data/workspaceApi';
import { getCacheUserId } from '../data/cacheStore';
import { getArchivedSalesFromServer, putSaleRecord } from '../data/indexedDbStore';
import { addSale, updateSale } from '../data/salesWriteService';
import { applyStockDeltas, PRODUCTS_EVENTS } from '../data/productsWriteService';
import { useSalesCursor } from '../hooks/useSalesCursor';
import VirtualTableBody from './VirtualTableBody';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';
import AppButton from './ui/AppButton';
import Card, { CardHeader } from './ui/Card';

/** @param {Record<string, unknown>} sale @param {1|-1} sign +1 restore to stock, −1 deduct */
function stockDeltasFromSale(sale, sign) {
  const d = {};
  if (!sale || typeof sale !== 'object') return d;
  if (Array.isArray(sale.items) && sale.items.length > 0) {
    for (const line of sale.items) {
      const pid = line.productId;
      if (!pid) continue;
      d[pid] = (d[pid] || 0) + sign * (Number(line.quantity) || 0);
    }
  } else if (sale.productId) {
    d[sale.productId] = (d[sale.productId] || 0) + sign * (Number(sale.quantity) || 0);
  }
  return d;
}

/** سطر في سلة الفاتورة */
function cartLine(productId, productName, quantity, unitPrice, unitCost) {
  return { productId, productName, quantity, unitPrice: Number(unitPrice) || 0, unitCost: Number(unitCost) || 0 };
}

export default function Sales({ onToast, onGoToSubscription }) {
  const { isExpired, canWrite } = useSubscription();
  const {
    sales,
    loading: salesLoading,
    loadingMore,
    hasMore,
    loadMore,
    refresh: refreshSalesList,
    readOnlySafeMode,
    queueBacklogWarning,
    prependSale,
    replaceSaleInList,
    pageSize: SALES_PAGE_SIZE,
  } = useSalesCursor();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [clientName, setClientName] = useState('');
  const [paid, setPaid] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** فاتورة متعددة / تعديل — داخل نافذة منبثقة */
  const [advancedSaleModalOpen, setAdvancedSaleModalOpen] = useState(false);
  const [cart, setCart] = useState([]);
  const [whatsappSale, setWhatsappSale] = useState(null);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappWelcome, setWhatsappWelcome] = useState('');
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [archivedPage, setArchivedPage] = useState(0);
  const [archivedHasMore, setArchivedHasMore] = useState(true);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [quickProductFilter, setQuickProductFilter] = useState('');
  const quickSaleFormRef = useRef(null);
  const productSearchInputRef = useRef(null);
  const lastProductHydratedRef = useRef(false);

  const workspaceIdForSales = getCurrentAccountId();
  useEffect(() => {
    setArchivedPage(0);
    setArchivedHasMore(true);
  }, [workspaceIdForSales]);

  useEffect(() => {
    if (editingSaleId) setAdvancedSaleModalOpen(true);
  }, [editingSaleId]);

  const editingSale = editingSaleId ? sales.find((s) => s.id === editingSaleId) : null;
  useEffect(() => {
    if (!editingSaleId) return;
    if (!editingSale) {
      setEditingSaleId(null);
      return;
    }
    setClientName(editingSale.clientName || '');
    setDate(editingSale.date || new Date().toISOString().slice(0, 10));
    setDiscount(String(editingSale.discount ?? ''));
    setPaid(false);
    if (Array.isArray(editingSale.items) && editingSale.items.length > 0) {
      setCart(editingSale.items.map((i) => ({ ...i })));
      setProductId('');
      setQuantity('');
      setUnitPrice('');
    } else {
      setCart([]);
      setProductId(editingSale.productId || '');
      setQuantity(String(editingSale.quantity ?? ''));
      setUnitPrice(String(editingSale.unitPrice ?? ''));
    }
    setDetailsOpen(true);
  }, [editingSaleId]);

  const [inventoryVersion, setInventoryVersion] = useState(0);
  useEffect(() => {
    const onInv = () => setInventoryVersion((v) => v + 1);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(PRODUCTS_EVENTS.CHANGED, onInv);
    return () => window.removeEventListener(PRODUCTS_EVENTS.CHANGED, onInv);
  }, []);

  const productsRaw = useMemo(() => getProducts(), [inventoryVersion]);
  // Dedup للعرض فقط: يمنع تكرار نفس الاسم في قائمة اختيار المنتج.
  const products = useMemo(() => {
    const list = Array.isArray(productsRaw) ? productsRaw : [];
    const bestByKey = new Map();
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const name = String(p.name || '').trim();
      if (!name) continue;
      const unit = String(p.unit || '').trim();
      const key = `${name.toLowerCase()}::${unit.toLowerCase()}`;
      const prev = bestByKey.get(key);
      const t = new Date(p.updatedAt || p.createdAt || 0).getTime() || 0;
      const tp = prev ? (new Date(prev.updatedAt || prev.createdAt || 0).getTime() || 0) : -1;
      if (!prev || t >= tp) bestByKey.set(key, p);
    }
    return Array.from(bestByKey.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
  }, [productsRaw]);

  const lastProductStorageKey = workspaceIdForSales ? `mahaseb_last_product_${workspaceIdForSales}` : '';

  useEffect(() => {
    lastProductHydratedRef.current = false;
  }, [workspaceIdForSales]);

  useEffect(() => {
    if (!lastProductStorageKey || lastProductHydratedRef.current || !products.length || editingSaleId) return;
    try {
      const id = localStorage.getItem(lastProductStorageKey);
      if (id && products.some((p) => p.id === id)) {
        setProductId(id);
        setQuantity((q) => (q === '' || q === '0' ? '1' : q));
      }
    } catch (_) {}
    lastProductHydratedRef.current = true;
  }, [products, lastProductStorageKey, editingSaleId]);

  useEffect(() => {
    if (!canWrite || editingSaleId || products.length === 0) return;
    const t = window.setTimeout(() => {
      productSearchInputRef.current?.focus?.();
    }, 100);
    return () => window.clearTimeout(t);
  }, [canWrite, editingSaleId, products.length, workspaceIdForSales]);

  const settings = getSettings();
  const selectedProduct = products.find((p) => p.id === productId);
  const costPerUnit = selectedProduct?.costPrice ?? 0;
  const marginPct = Number(settings.defaultProfitMargin) || 0;
  const suggestedUnitPrice = costPerUnit > 0 && marginPct > 0 ? costPerUnit * (1 + marginPct / 100) : 0;
  const showSuggested = settings.suggestPriceFromCost && suggestedUnitPrice > 0;

  // تسجيل بيع سريع: تعبئة السعر تلقائياً عند اختيار المنتج
  useEffect(() => {
    if (!productId || !selectedProduct || cart.length > 0 || editingSaleId) return;
    if (settings.suggestPriceFromCost && suggestedUnitPrice > 0 && (!unitPrice || parseAmount(unitPrice) === 0)) {
      setUnitPrice(suggestedUnitPrice.toFixed(2));
    }
  }, [productId, suggestedUnitPrice, settings.suggestPriceFromCost]);

  const filteredProductsForQuick = useMemo(() => {
    const q = (quickProductFilter || '').trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => (p.name || '').toLowerCase().includes(q));
  }, [products, quickProductFilter]);

  const qtyNum = parseInt(quantity, 10) || 0;
  const priceNum = parseAmount(unitPrice) || 0;
  const discountNum = parseAmount(discount) || 0;
  const subtotal = qtyNum * priceNum;
  const totalSale = subtotal - discountNum;
  const totalCost = qtyNum * costPerUnit;
  const profit = totalSale - totalCost;
  const profitMargin = totalSale > 0 ? (profit / totalSale) * 100 : 0;
  const isLoss = profit < 0;

  const cartSubtotal = cart.reduce((s, i) => s + (parseAmount(i.quantity) || 0) * parseAmount(i.unitPrice), 0);
  const cartDiscount = parseAmount(discount) || 0;
  const cartTotal = Math.max(0, cartSubtotal - cartDiscount);
  const cartCost = cart.reduce((s, i) => s + (parseAmount(i.quantity) || 0) * parseAmount(i.unitCost), 0);
  const cartProfit = cartTotal - cartCost;
  const cartProfitMargin = cartTotal > 0 ? (cartProfit / cartTotal) * 100 : 0;

  const handleAddToCart = (e) => {
    e.preventDefault();
    const prod = products.find((p) => p.id === productId);
    if (!prod) {
      onToast?.('المنتج غير موجود. اختر منتجاً من القائمة أو أضفه من المخزون أولاً.', 'error');
      return;
    }
    const qty = parseInt(quantity, 10);
    const price = parseFloat(unitPrice) || 0;
    if (qty <= 0 || price < 0) return;
    if (prod.quantity < qty) {
      onToast?.('الكمية غير كافية في المخزون', 'error');
      return;
    }
    setCart((prev) => [...prev, cartLine(prod.id, prod.name, qty, price, prod.costPrice ?? 0)]);
    setQuantity('');
    setUnitPrice('');
    onToast?.('تمت الإضافة للسلة');
  };

  const removeFromCart = (index) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitInvoice = async (e) => {
    e.preventDefault();
    if (cart.length === 0) {
      onToast?.('أضف منتجات للسلة أولاً أو استخدم «تسجيل البيع» لمنتج واحد.', 'error');
      return;
    }
    const prods = getProducts();
    const productIdsInCart = [...new Set(cart.map((c) => c.productId))];
    for (const pid of productIdsInCart) {
      const p = prods.find((x) => x.id === pid);
      if (!p) {
        onToast?.(`المنتج غير موجود في المخزون.`, 'error');
        return;
      }
      const needed = cart.filter((c) => c.productId === pid).reduce((s, c) => s + c.quantity, 0);
      if ((p.quantity ?? 0) < needed) {
        onToast?.(`الكمية غير كافية لـ "${p.name}". المتوفر: ${p.quantity ?? 0}`, 'error');
        return;
      }
    }
    const disc = parseAmount(discount) || 0;
    const total = Math.max(0, cartSubtotal - disc);
    const profitVal = total - cartCost;
    const margin = total > 0 ? (profitVal / total) * 100 : 0;
    const newSale = {
      id: crypto.randomUUID(),
      items: cart.map((c) => ({ ...c })),
      discount: disc,
      total,
      profit: profitVal,
      profitMargin: margin,
      date,
      clientName: clientName.trim() || 'نقدي',
      paid,
      status: 'completed',
      pending_sync: isWorkspaceSaaSEnabled() && !navigator.onLine,
    };
    const wr = await addSale(newSale);
    if (!wr.ok) {
      onToast?.('تعذر حفظ الفاتورة محلياً. حاول مرة أخرى.', 'error');
      return;
    }
    prependSale(newSale);

    const cartDeltas = {};
    for (const line of cart) {
      const pid = line.productId;
      if (!pid) continue;
      cartDeltas[pid] = (cartDeltas[pid] || 0) - (Number(line.quantity) || 0);
    }
    const stockRes = await applyStockDeltas(cartDeltas);
    if (!stockRes.ok) onToast?.('تم حفظ الفاتورة لكن تعذر تحديث كل بنود المخزون.', 'error');

    if (paid) {
      const desc = cart.map((i) => `${i.productName} × ${i.quantity}`).join('، ');
      const tr = await addTransaction({
        type: 'income',
        description: `بيع: ${desc} — ${clientName.trim() || 'نقدي'}`,
        amount: total,
        category: 'مبيعات',
        date,
        source: 'sale',
        saleId: newSale.id,
      });
      if (!tr.ok) onToast?.('تم حفظ البيع لكن تعذر تسجيل الإيراد في الحسابات.', 'error');
    }
    if (settings.notificationsEnabled && profitVal < 0) {
      addNotification({
        type: 'warning',
        title: 'تنبيه: بيع بخسارة',
        message: `تم تسجيل فاتورة بخسارة: ${formatCurrency(Math.abs(profitVal))}. راجع الأسعار أو التكلفة.`,
        link: 'sales',
        linkLabel: 'المبيعات',
        notificationType: 'sale_loss',
      });
    }
    onToast?.(paid ? 'تم تسجيل الفاتورة والإيراد' : 'تم تسجيل الفاتورة (دفع آجل)');
    try {
      const pid = cart[0]?.productId;
      if (lastProductStorageKey && pid) localStorage.setItem(lastProductStorageKey, pid);
    } catch (_) {}
    setCart([]);
    setDiscount('');
    setClientName('');
    setPaid(true);
    setAdvancedSaleModalOpen(false);
  };

  const handleSell = async (e) => {
    e.preventDefault();
    if (cart.length > 0) {
      await handleSubmitInvoice(e);
      return;
    }
    const prod = products.find((p) => p.id === productId);
    if (!prod) {
      onToast?.('المنتج غير موجود. اختر منتجاً من القائمة أو أضفه من المخزون أولاً.', 'error');
      return;
    }
    const qty = parseInt(quantity, 10);
    const price = parseAmount(unitPrice) || 0;
    const disc = parseAmount(discount) || 0;
    if (qty <= 0 || price < 0) return;
    if (prod.quantity < qty) {
      onToast?.('الكمية غير كافية في المخزون', 'error');
      return;
    }
    const total = Math.max(0, qty * price - disc);
    const unitCost = prod.costPrice ?? 0;
    const saleProfit = total - unitCost * qty;
    const saleMargin = total > 0 ? (saleProfit / total) * 100 : 0;
    const newSale = {
      id: crypto.randomUUID(),
      productId: prod.id,
      productName: prod.name,
      quantity: qty,
      unitPrice: price,
      unitCost,
      discount: disc,
      total,
      profit: saleProfit,
      profitMargin: saleMargin,
      date,
      clientName: clientName.trim() || 'نقدي',
      paid,
      status: 'completed',
      pending_sync: isWorkspaceSaaSEnabled() && !navigator.onLine,
    };
    const wr = await addSale(newSale);
    if (!wr.ok) {
      onToast?.('تعذر حفظ البيع محلياً. حاول مرة أخرى.', 'error');
      return;
    }
    prependSale(newSale);

    const stockRes = await applyStockDeltas({ [productId]: -qty });
    if (!stockRes.ok) onToast?.('تم حفظ البيع لكن تعذر تحديث المخزون.', 'error');

    if (paid) {
      const tr = await addTransaction({
        type: 'income',
        description: `بيع: ${prod.name} × ${qty} - ${clientName.trim() || 'نقدي'}`,
        amount: Math.max(0, total),
        category: 'مبيعات',
        date,
        source: 'sale',
        saleId: newSale.id,
      });
      if (!tr.ok) onToast?.('تم حفظ البيع لكن تعذر تسجيل الإيراد في الحسابات.', 'error');
    }
    if (settings.notificationsEnabled && saleProfit < 0) {
      addNotification({
        type: 'warning',
        title: 'تنبيه: بيع بخسارة',
        message: `تم تسجيل بيع بخسارة: ${prod.name} × ${qty} — الخسارة: ${formatCurrency(Math.abs(saleProfit))}. راجع الأسعار أو تكلفة المنتج.`,
        link: 'sales',
        linkLabel: 'المبيعات',
        notificationType: 'sale_loss',
      });
    }
    onToast?.(paid ? 'تم تسجيل البيع والإيراد' : 'تم تسجيل البيع (دفع آجل)');
    try {
      if (lastProductStorageKey && productId) localStorage.setItem(lastProductStorageKey, productId);
    } catch (_) {}
    setQuantity('1');
    setUnitPrice('');
    setDiscount('');
    setClientName('');
    setPaid(true);
    setAdvancedSaleModalOpen(false);
  };

  const markAsPaid = async (sale) => {
    if (sale.paid) return;
    const amount = getSaleTotal(sale);
    const desc = getSaleSummary(sale);
    const tr = await addTransaction({
      type: 'income',
      description: `استلام: ${desc} — ${sale.clientName || 'عميل'}`,
      amount,
      category: 'مبيعات',
      date: new Date().toISOString().slice(0, 10),
      source: 'sale_payment',
      saleId: sale.id,
    });
    if (!tr.ok) {
      onToast?.('تعذر تسجيل الإيراد محلياً.', 'error');
      return;
    }
    const ur = await updateSale(sale.id, { paid: true });
    if (!ur.ok) {
      onToast?.('تعذر تحديث حالة الدفع.', 'error');
      return;
    }
    replaceSaleInList(sale.id, (s) => ({ ...s, paid: true }));
    onToast?.('تم تسجيل الاستلام');
  };

  const cancelSale = async (sale) => {
    if (sale.status === 'cancelled' || sale.status === 'returned') return;
    if (!confirm('إلغاء هذه الفاتورة؟ سيتم إرجاع الكميات للمخزون وحذف أي إيراد مرتبط بها.')) return;
    const toRemove = getTransactions().filter((t) => t.saleId === sale.id);
    for (const t of toRemove) {
      const dr = await deleteTransaction(t.id);
      if (!dr.ok) {
        onToast?.('تعذر تحديث الحسابات المرتبطة بالإلغاء.', 'error');
        return;
      }
    }
    const restoreRes = await applyStockDeltas(stockDeltasFromSale(sale, 1));
    if (!restoreRes.ok) onToast?.('تعذر إرجاع كل الكميات للمخزون.', 'error');
    const ur = await updateSale(sale.id, { status: 'cancelled' });
    if (!ur.ok) {
      onToast?.('تعذر تحديث حالة الإلغاء.', 'error');
      return;
    }
    replaceSaleInList(sale.id, (s) => ({ ...s, status: 'cancelled' }));
    onToast?.('تم إلغاء الطلب');
  };

  const markAsReturned = async (sale) => {
    if (sale.status === 'cancelled' || sale.status === 'returned') return;
    const refundAmount = getSaleTotal(sale);
    const confirmMsg = `تسجيل مرتجع لهذه الفاتورة؟\n\nسيتم:\n• إرجاع الكميات للمخزون\n• تسجيل مصروف مرتجع: ${formatCurrency(refundAmount)}\n\nالمتابعة؟`;
    if (!confirm(confirmMsg)) return;
    if (refundAmount > 0) {
      const tr = await addTransaction({
        type: 'expense',
        description: `مرتجع: ${getSaleSummary(sale)} — ${sale.clientName || 'عميل'}`,
        amount: refundAmount,
        category: 'مرتجع',
        date: new Date().toISOString().slice(0, 10),
        source: 'refund',
        saleId: sale.id,
      });
      if (!tr.ok) {
        onToast?.('تعذر تسجيل مصروف المرتجع محلياً.', 'error');
        return;
      }
    }
    const restoreRes = await applyStockDeltas(stockDeltasFromSale(sale, 1));
    if (!restoreRes.ok) onToast?.('تعذر إرجاع كل الكميات للمخزون.', 'error');
    const patch = {
      status: 'returned',
      deliveryStatus: sale.source ? 'returned' : undefined,
    };
    const ur = await updateSale(sale.id, patch);
    if (!ur.ok) {
      onToast?.('تعذر تسجيل المرتجع في التخزين المحلي.', 'error');
      return;
    }
    replaceSaleInList(sale.id, (s) => ({
      ...s,
      status: 'returned',
      deliveryStatus: s.source ? 'returned' : s.deliveryStatus,
    }));
    onToast?.('تم تسجيل المرتجع');
  };

  /** للطلبات القادمة من المتجر: تسجيل «تم التسليم» فقط (بدون تغيير إيراد أو مخزون) */
  const setOrderDelivered = async (sale) => {
    if (!sale.source || sale.deliveryStatus === 'delivered' || sale.status !== 'completed') return;
    const ur = await updateSale(sale.id, { deliveryStatus: 'delivered' });
    if (!ur.ok) {
      onToast?.('تعذر حفظ حالة التسليم.', 'error');
      return;
    }
    replaceSaleInList(sale.id, (s) => ({ ...s, deliveryStatus: 'delivered' }));
    onToast?.('تم تسجيل التسليم');
  };

  const openSaleWhatsApp = (sale) => {
    setWhatsappSale(sale);
    const clients = getClients();
    const byName = clients.find((c) => (c.name || '').trim() === (sale.clientName || '').trim());
    setWhatsappPhone(byName?.phone || '');
    setWhatsappWelcome('');
  };

  const sendSaleWhatsApp = () => {
    if (!whatsappSale || !whatsappPhone.trim()) {
      onToast?.('أدخل رقم واتساب العميل (مثال: 01234567890)', 'error');
      return;
    }
    const text = buildSaleInvoiceForWhatsApp(whatsappSale, whatsappWelcome.trim());
    openWhatsAppWithMessage(whatsappPhone.trim(), text);
    setWhatsappSale(null);
    setWhatsappPhone('');
    setWhatsappWelcome('');
    onToast?.('تم فتح واتساب — الصق الرسالة وأرسل للعميل');
  };

  const copySaleInvoiceToClipboard = () => {
    if (!whatsappSale) return;
    const text = buildSaleInvoiceForWhatsApp(whatsappSale, whatsappWelcome.trim());
    navigator.clipboard?.writeText(text).then(() => {
      onToast?.('تم نسخ نص الفاتورة — الصق في واتساب يدوياً');
    }).catch(() => {
      onToast?.('تعذر النسخ. أدخل الرقم واضغط «فتح واتساب».', 'error');
    });
  };

  const cancelEdit = () => {
    setEditingSaleId(null);
    setCart([]);
    setQuantity('1');
    setUnitPrice('');
    setDiscount('');
    setClientName('');
    setDate(new Date().toISOString().slice(0, 10));
    setPaid(true);
    setAdvancedSaleModalOpen(false);
  };

  const requestCloseAdvancedModal = () => {
    if (editingSaleId) return;
    setAdvancedSaleModalOpen(false);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingSale) return;
    const restoreRes0 = await applyStockDeltas(stockDeltasFromSale(editingSale, 1));
    if (!restoreRes0.ok) onToast?.('تعذر إرجاع المخزون القديم قبل التعديل.', 'error');
    if (cart.length > 0) {
      const productIdsInCart = [...new Set(cart.map((c) => c.productId))];
      for (const pid of productIdsInCart) {
        const p = getProducts().find((x) => x.id === pid);
        if (!p || (p.quantity ?? 0) < cart.filter((c) => c.productId === pid).reduce((s, c) => s + c.quantity, 0)) {
          onToast?.('الكمية غير كافية في المخزون. عدّل الكميات وأعد الحفظ.', 'error');
          return;
        }
      }
      const disc = parseAmount(discount) || 0;
      const total = Math.max(0, cartSubtotal - disc);
      const profitVal = total - cartCost;
      const margin = total > 0 ? (profitVal / total) * 100 : 0;
      const updatedSale = {
        ...editingSale,
        items: cart.map((c) => ({ ...c })),
        discount: disc,
        total,
        profit: profitVal,
        profitMargin: margin,
        date,
        clientName: clientName.trim() || 'نقدي',
      };
      const editCartDeltas = {};
      for (const line of cart) {
        const pid = line.productId;
        if (!pid) continue;
        editCartDeltas[pid] = (editCartDeltas[pid] || 0) - (Number(line.quantity) || 0);
      }
      const stockEdit = await applyStockDeltas(editCartDeltas);
      if (!stockEdit.ok) onToast?.('تم تعديل البيانات لكن تعذر خصم المخزون بالكامل.', 'error');
      const ur = await updateSale(editingSaleId, updatedSale);
      if (!ur.ok) {
        onToast?.('تعذر حفظ تعديل الفاتورة.', 'error');
        return;
      }
      replaceSaleInList(editingSaleId, () => updatedSale);
    } else {
      const prod = products.find((p) => p.id === productId);
      if (!prod) {
        onToast?.('اختر منتجاً صحيحاً.', 'error');
        return;
      }
      const qty = parseInt(quantity, 10);
      const price = parseAmount(unitPrice) || 0;
      const disc = parseAmount(discount) || 0;
      if (qty <= 0 || price < 0) return;
      if ((prod.quantity ?? 0) < qty) {
        onToast?.('الكمية غير كافية في المخزون.', 'error');
        return;
      }
      const total = Math.max(0, qty * price - disc);
      const unitCost = prod.costPrice ?? 0;
      const profitVal = total - unitCost * qty;
      const margin = total > 0 ? (profitVal / total) * 100 : 0;
      const updatedSale = {
        ...editingSale,
        productId: prod.id,
        productName: prod.name,
        quantity: qty,
        unitPrice: price,
        unitCost,
        discount: disc,
        total,
        profit: profitVal,
        profitMargin: margin,
        date,
        clientName: clientName.trim() || 'نقدي',
      };
      const se = await applyStockDeltas({ [productId]: -qty });
      if (!se.ok) onToast?.('تعذر خصم المخزون بعد التعديل.', 'error');
      const ur = await updateSale(editingSaleId, updatedSale);
      if (!ur.ok) {
        onToast?.('تعذر حفظ تعديل الفاتورة.', 'error');
        return;
      }
      replaceSaleInList(editingSaleId, () => updatedSale);
    }
    onToast?.('تم حفظ تعديل الفاتورة');
    cancelEdit();
  };

  const completedSales = sales.filter((s) => (s.status || 'completed') === 'completed');
  const unpaidSales = completedSales.filter((s) => !s.paid);

  const handleQuickSaleSubmit = async (e) => {
    e.preventDefault();
    if (cart.length > 0) {
      await handleSubmitInvoice(e);
      return;
    }
    await handleSell(e);
  };

  const sentinelRef = useRef(null);
  const tableScrollRef = useRef(null);

  const loadMoreSales = async () => {
    if (!canWrite && isExpired) return;
    if (!hasMore || loadingMore) return;
    await loadMore();
  };

  const loadArchivedOlderSales = async () => {
    if (loadingArchived || loadingMore) return;
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    if (!wid || !uid) return;
    setLoadingArchived(true);
    try {
      const nextPage = archivedPage + 1;
      const archived = await getArchivedSalesFromServer(wid, nextPage, SALES_PAGE_SIZE);
      if (!Array.isArray(archived) || archived.length === 0) {
        setArchivedHasMore(false);
        return;
      }
      for (const s of archived) {
        if (s?.id) await putSaleRecord(wid, uid, { ...s, syncStatus: 'synced' });
      }
      setArchivedPage(nextPage);
      setArchivedHasMore(archived.length === SALES_PAGE_SIZE);
      await refreshSalesList();
    } finally {
      setLoadingArchived(false);
    }
  };

  useEffect(() => {
    if (!sentinelRef.current) return;
    if (!hasMore) return;
    const el = sentinelRef.current;
    const root = tableScrollRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        void loadMoreSales();
      },
      { root: root || null, rootMargin: '80px', threshold: 0.01 }
    );
    obs.observe(el);
    // Scroll-stall recovery: if IntersectionObserver misses, check near-bottom periodically.
    const interval = window.setInterval(() => {
      if (!hasMore || loadingMore || !el) return;
      const rootBottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
      const sentinelTop = el.getBoundingClientRect().top;
      if (sentinelTop <= rootBottom + 140) void loadMoreSales();
    }, 2500);

    return () => {
      obs.disconnect();
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, sales.length]);

  return (
    <>
      <SectionHeader title="البيع" subtitle="سجل المبيعات بسرعة وتابع التحصيل." />

      {readOnlySafeMode && (
        <Card className="border-amber-500/35 bg-amber-950/25">
          <p className="text-sm text-gray-200">
            <strong>تعذر الكتابة على التخزين المحلي.</strong> يمكنك عرض المبيعات فقط. أعد تحميل الصفحة أو تحقق من مساحة المتصفح.
          </p>
        </Card>
      )}
      {queueBacklogWarning && (
        <Card className="border-sky-500/35 bg-sky-950/25">
          <p className="m-0 text-sm text-gray-200">يوجد طابور مزامنة كبير — سيتم الإرسال تلقائياً عند استقرار الاتصال.</p>
        </Card>
      )}

      {isExpired && (
        <Card className="border-rose-500/35 bg-rose-950/25">
          <p className="text-sm text-gray-200">
            <strong>وضع العرض فقط.</strong> انتهت الفترة التجريبية. لا يمكن تسجيل بيع جديد حتى تجديد الاشتراك.
          </p>
          {onGoToSubscription && (
            <AppButton variant="primary" className="mt-3" onClick={onGoToSubscription}>
              صفحة الاشتراك
            </AppButton>
          )}
        </Card>
      )}

      {/* تسجيل بيع — بسيط: منتج + كمية + زر واحد */}
      {canWrite && !editingSaleId && products.length > 0 && (
        <Card className="border-white/10 p-5 md:p-6">
          <CardHeader title="تسجيل بيع سريع" subtitle="اختر المنتج والكمية، ثم سجّل." />
          <form
            ref={quickSaleFormRef}
            onSubmit={handleQuickSaleSubmit}
            className="mt-8 space-y-5"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              if (e.target.tagName === 'TEXTAREA') return;
              e.preventDefault();
              handleQuickSaleSubmit(e);
            }}
          >
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">المنتج</label>
                <input
                  ref={productSearchInputRef}
                  type="text"
                  className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-3 py-2.5 text-white shadow-sm focus:border-saas-primary focus:outline-none focus:ring-2 focus:ring-saas-primary/25"
                  placeholder="ابحث بالاسم..."
                  value={quickProductFilter}
                  onChange={(e) => setQuickProductFilter(e.target.value)}
                  aria-label="بحث عن المنتج"
                />
                <select
                  className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-3 py-2.5 text-white shadow-sm focus:border-saas-primary focus:outline-none focus:ring-2 focus:ring-saas-primary/25"
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    if (!quantity || quantity === '0') setQuantity('1');
                  }}
                  required
                  aria-label="اختيار المنتج"
                >
                  <option value="">— اختر المنتج —</option>
                  {filteredProductsForQuick.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (متوفر: {p.quantity ?? 0})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">الكمية</label>
                <input
                  type="number"
                  min="1"
                  className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-3 py-2.5 text-white shadow-sm focus:border-saas-primary focus:outline-none focus:ring-2 focus:ring-saas-primary/25 md:max-w-[160px]"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
            </div>
            {selectedProduct && qtyNum > 0 && (
              <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                <span className="text-sm text-gray-400">الإجمالي</span>
                <strong className="text-xl font-bold text-saas-primary">{formatCurrency(totalSale)}</strong>
              </div>
            )}
            <AppButton
              type="submit"
              size="lg"
              className="w-full md:w-auto md:min-w-[200px]"
              disabled={!productId || !quantity || qtyNum < 1}
            >
              تسجيل بيع
            </AppButton>
            <p className="text-xs text-gray-400">Enter للتسجيل السريع · السعر يُقترح تلقائياً عند اختيار المنتج</p>
          </form>
        </Card>
      )}

      {canWrite && !editingSaleId && products.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <AppButton variant="outline" onClick={() => setAdvancedSaleModalOpen(true)}>
            فاتورة متعددة الأصناف أو تعديل السعر
          </AppButton>
        </div>
      )}

      {canWrite && !editingSaleId && products.length === 0 && (
        <Card>
          <p className="text-sm text-gray-300">
            لا يوجد منتجات حتى الآن. أضف منتجات من صفحة <strong>المخزون</strong> ثم ارجع لتسجيل البيع.
          </p>
        </Card>
      )}

      {(advancedSaleModalOpen || editingSaleId) && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="advanced-sale-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="إغلاق"
            onClick={requestCloseAdvancedModal}
          />
          <div className="relative z-[101] flex max-h-[min(92dvh,880px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#111827] text-white shadow-2xl sm:max-w-2xl sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <h2 id="advanced-sale-title" className="text-lg font-bold text-white">
                {editingSaleId ? 'تعديل الفاتورة (آجل)' : 'فاتورة متعددة'}
              </h2>
              {!editingSaleId && (
                <AppButton type="button" variant="ghost" className="shrink-0 text-gray-400" onClick={requestCloseAdvancedModal}>
                  إغلاق
                </AppButton>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {products.length === 0 && !editingSaleId ? (
                <p className="text-sm text-gray-300">لا يوجد منتجات. أضف من المخزون أولاً.</p>
              ) : (
                <form
                  className="flex flex-col gap-6"
                  onSubmit={(e) => {
                    if (editingSaleId) {
                      e.preventDefault();
                      handleSaveEdit(e);
                    } else {
                      handleSell(e);
                    }
                  }}
                >
                  <div className="sale-form-main form-row">
                    <div className="form-group">
                      <label>المنتج</label>
                      <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                        <option value="">— اختر المنتج —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} (متوفر: {p.quantity})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>الكمية</label>
                      <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label>سعر الوحدة (ج.م)</label>
                      <input type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
                      {showSuggested && (
                        <div className="sale-suggested-price mt-2 flex flex-wrap items-center gap-2 text-sm">
                          <span>مقترح: {formatCurrency(suggestedUnitPrice)}</span>
                          <AppButton
                            type="button"
                            variant="secondary"
                            size="md"
                            onClick={() => setUnitPrice(suggestedUnitPrice.toFixed(2))}
                          >
                            استخدم
                          </AppButton>
                        </div>
                      )}
                    </div>
                  </div>
                  {quantity && unitPrice && (
                    <div className={`sale-preview-card rounded-2xl ${isLoss ? 'sale-preview-loss' : ''}`}>
                      <div className="sale-preview-row">
                        <span>الإجمالي</span>
                        <strong>{formatCurrency(totalSale)}</strong>
                      </div>
                      <div className="sale-preview-row">
                        <span>الربح</span>
                        <strong className={isLoss ? 'amount-expense' : 'amount-income'}>
                          {isLoss ? '−' : '+'}
                          {formatCurrency(Math.abs(profit))}
                        </strong>
                      </div>
                      {isLoss && <p className="sale-preview-warn">البيع أقل من التكلفة.</p>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {!editingSaleId ? (
                      <>
                        <AppButton type="button" variant="secondary" onClick={handleAddToCart}>
                          إضافة للسلة
                        </AppButton>
                        <AppButton type="submit" variant="primary">
                          {cart.length > 0 ? 'تسجيل الفاتورة' : 'تسجيل البيع'}
                        </AppButton>
                      </>
                    ) : (
                      <>
                        <AppButton type="button" variant="primary" onClick={handleSaveEdit}>
                          حفظ التعديل
                        </AppButton>
                        <AppButton type="button" variant="secondary" onClick={cancelEdit}>
                          إلغاء التعديل
                        </AppButton>
                      </>
                    )}
                  </div>

                  {cart.length > 0 && (
                    <Card className="border-teal-100/80 bg-teal-50/30">
                      <CardHeader title={`سلة الفاتورة (${cart.length} صنف)`} />
                      <ul className="mt-3 list-none space-y-2 p-0">
                        {cart.map((line, i) => (
                          <li
                            key={i}
                            className="flex items-center justify-between gap-2 border-b border-gray-100 py-2 text-sm last:border-0"
                          >
                            <span>
                              {line.productName} × {line.quantity} — {formatCurrency(line.quantity * line.unitPrice)}
                            </span>
                            <AppButton type="button" variant="ghost" size="md" className="text-rose-600" onClick={() => removeFromCart(i)}>
                              حذف
                            </AppButton>
                          </li>
                        ))}
                      </ul>
                      <div className="sale-preview-row mt-3">
                        <span>المجموع قبل الخصم</span>
                        <strong>{formatCurrency(cartSubtotal)}</strong>
                      </div>
                      <div className="sale-preview-row">
                        <span>الخصم</span>
                        <strong>{formatCurrency(cartDiscount)}</strong>
                      </div>
                      <div className="sale-preview-row">
                        <span>الإجمالي</span>
                        <strong>{formatCurrency(cartTotal)}</strong>
                      </div>
                      <div className={`sale-preview-row ${cartProfit < 0 ? 'sale-preview-loss' : ''}`}>
                        <span>الربح</span>
                        <strong className={cartProfit < 0 ? 'amount-expense' : 'amount-income'}>
                          {cartProfit < 0 ? '−' : '+'}
                          {formatCurrency(Math.abs(cartProfit))} ({cartProfitMargin.toFixed(0)}%)
                        </strong>
                      </div>
                    </Card>
                  )}

                  <div className="sale-details-toggle">
                    <AppButton type="button" variant="ghost" size="md" onClick={() => setDetailsOpen((o) => !o)} aria-expanded={detailsOpen}>
                      {detailsOpen ? '▼ إخفاء التفاصيل' : '▶ تفاصيل إضافية (عميل، خصم، تاريخ)'}
                    </AppButton>
                  </div>
                  {detailsOpen && (
                    <div className="sale-form-details form-row">
                      <div className="form-group">
                        <label>خصم (ج.م)</label>
                        <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
                      </div>
                      <div className="form-group">
                        <label>العميل</label>
                        <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="اسم العميل أو نقدي" />
                      </div>
                      <div className="form-group">
                        <label>التاريخ</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                      </div>
                      <div className="form-group form-group-checkbox">
                        <label>
                          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
                          تم الاستلام نقداً الآن
                        </label>
                      </div>
                    </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {whatsappSale && (
        <Card className="border-teal-100/80 bg-teal-50/35">
          <CardHeader
            title="إرسال الفاتورة واتساب"
            subtitle={`العميل: ${whatsappSale.clientName || '—'} | الإجمالي: ${formatCurrency(getSaleTotal(whatsappSale))}`}
          />
          <div className="form-row mt-4">
            <div className="form-group">
              <label>رقم واتساب العميل</label>
              <input
                type="tel"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="01234567890"
                dir="ltr"
                inputMode="numeric"
              />
            </div>
            <div className="form-group" style={{ flex: '1 1 100%' }}>
              <label>رسالة ترحيبية (اختياري)</label>
              <textarea
                value={whatsappWelcome}
                onChange={(e) => setWhatsappWelcome(e.target.value)}
                placeholder="مثال: أهلاً بيك، تفاصيل فاتورتك كالتالي:"
                rows={2}
                style={{ width: '100%', maxWidth: '400px' }}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <AppButton variant="primary" onClick={sendSaleWhatsApp} disabled={!whatsappPhone.trim()}>
              فتح واتساب وإرسال الفاتورة
            </AppButton>
            <AppButton variant="secondary" onClick={copySaleInvoiceToClipboard}>
              نسخ نص الفاتورة
            </AppButton>
            <AppButton
              variant="ghost"
              onClick={() => {
                setWhatsappSale(null);
                setWhatsappPhone('');
                setWhatsappWelcome('');
              }}
            >
              إلغاء
            </AppButton>
          </div>
        </Card>
      )}

      {unpaidSales.length > 0 && (
        <Card className="border-amber-200/80 bg-amber-50/30">
          <CardHeader title="مبيعات بانتظار الاستلام (دفع آجل)" />
          <div className="table-wrap mt-4">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المنتج</th>
                  <th>العميل</th>
                  <th>المبلغ</th>
                  <th>الربح</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unpaidSales.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDate(s.date)}</td>
                    <td>{getSaleSummary(s)}</td>
                    <td>{s.clientName}</td>
                    <td className="amount-income">{formatCurrency(getSaleTotal(s))}</td>
                    <td className={(getSaleProfit(s)) < 0 ? 'amount-expense' : 'amount-income'}>
                      {(getSaleProfit(s)) < 0 ? '−' : '+'}{formatCurrency(Math.abs(getSaleProfit(s)))} ({(s.profitMargin ?? 0).toFixed(0)}%)
                    </td>
                    <td>
                      {canWrite && (
                        <AppButton variant="primary" className="!px-3 !py-1.5 text-xs" onClick={() => markAsPaid(s)}>
                          تسجيل استلام
                        </AppButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="آخر المبيعات" />
        <div className="mt-4">
        {salesLoading && sales.length === 0 ? (
          <EmptyState title="جاري تحميل المبيعات..." />
        ) : sales.length === 0 ? (
          <EmptyState title="لا توجد مبيعات مسجلة" subtitle="ابدأ بأول عملية بيع من النموذج أعلاه." />
        ) : (
          <div ref={tableScrollRef} className="table-wrap rounded-2xl border border-gray-100" style={{ maxHeight: 'min(70vh, 640px)', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المنتج</th>
                  <th>الكمية</th>
                  <th>المبلغ</th>
                  <th>الربح</th>
                  <th>العميل</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <VirtualTableBody
                parentRef={tableScrollRef}
                items={sales}
                rowHeight={56}
                colCount={8}
                renderRow={(s) => {
                  const status = s.status || 'completed';
                  const isCompleted = status === 'completed';
                  const isStoreOrder = !!s.source;
                  const pendingDelivery = isStoreOrder && (s.deliveryStatus === 'pending' || s.deliveryStatus === 'shipped');
                  return (
                    <tr key={s.id} className={status !== 'completed' ? 'sale-row-cancelled' : ''}>
                      <td>{formatDate(s.date)}</td>
                      <td>{getSaleSummary(s)}</td>
                      <td>{Array.isArray(s.items) ? s.items.reduce((sum, i) => sum + (i.quantity || 0), 0) : (s.quantity ?? 0)}</td>
                      <td className="amount-income">{formatCurrency(getSaleTotal(s))}</td>
                      <td className={(getSaleProfit(s) < 0) ? 'amount-expense' : 'amount-income'}>
                        {(getSaleProfit(s) < 0) ? '−' : '+'}{formatCurrency(Math.abs(getSaleProfit(s)))} ({(s.profitMargin ?? 0).toFixed(0)}%)
                      </td>
                      <td>{s.clientName}</td>
                      <td>
                        {status === 'cancelled' && <span className="badge badge-expense">ملغى</span>}
                        {status === 'returned' && <span className="badge" style={{ background: '#94a3b8', color: '#fff' }}>مرتجع</span>}
                        {isCompleted && !isStoreOrder && (s.paid ? <span className="badge badge-paid">مدفوع</span> : <span className="badge badge-unpaid">آجل</span>)}
                        {isCompleted && isStoreOrder && (
                          <>
                            {s.deliveryStatus === 'delivered' && <span className="badge" style={{ background: 'var(--income)', color: '#fff' }}>تم التسليم</span>}
                            {pendingDelivery && <span className="badge badge-unpaid">قيد التوصيل</span>}
                            {s.deliveryStatus !== 'delivered' && !pendingDelivery && (s.paid ? <span className="badge badge-paid">مدفوع</span> : null)}
                          </>
                        )}
                      </td>
                      <td>
                        {isCompleted && (
                          <div className="flex flex-nowrap items-center gap-1">
                            <AppButton
                              type="button"
                              variant="outline"
                              className="!px-2 !py-1 text-xs"
                              onClick={async () => await exportSaleInvoicePdf(s)}
                              title="تحميل فاتورة بيع PDF"
                            >
                              PDF
                            </AppButton>
                            <AppButton type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => openSaleWhatsApp(s)} title="إرسال فاتورة واتساب">
                              واتساب
                            </AppButton>
                            {canWrite && (
                              <>
                                {!s.paid && !pendingDelivery && (
                                  <AppButton type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setEditingSaleId(s.id)} title="تعديل الفاتورة (آجل)">
                                    تعديل
                                  </AppButton>
                                )}
                                {pendingDelivery && (
                                  <>
                                    <AppButton type="button" variant="primary" className="!px-2 !py-1 text-xs" onClick={() => setOrderDelivered(s)}>
                                      تم التسليم
                                    </AppButton>
                                    <AppButton type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => markAsReturned(s)}>
                                      مرتجع
                                    </AppButton>
                                  </>
                                )}
                                {!pendingDelivery && (
                                  <>
                                    <AppButton type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => cancelSale(s)}>
                                      إلغاء
                                    </AppButton>
                                    <AppButton type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => markAsReturned(s)}>
                                      مرتجع
                                    </AppButton>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                }}
              />
            </table>
            {isWorkspaceSaaSEnabled() && navigator.onLine && archivedHasMore && (
              <div className="mt-3 text-center">
                <AppButton variant="secondary" disabled={loadingArchived} onClick={() => void loadArchivedOlderSales()}>
                  تحميل بيانات أقدم
                </AppButton>
              </div>
            )}

            <div ref={sentinelRef} style={{ height: 1 }} />
            {loadingMore && <div className="mt-3 text-center text-sm text-gray-400">جاري تحميل المزيد...</div>}
          </div>
        )}
        </div>
      </Card>
    </>
  );
}
