/**
 * مزامنة العمليات مع جداول الـ workspace: Save to Supabase → Update cache → (يحدّث الـ UI من الـ App)
 */

import { getCurrentAccountId, setCurrentAccountId, ensureSingleAccount } from './store';
import { cacheGet, cacheSet } from './supabaseApi';
import { DATA_SUFFIXES } from './store';
import {
  isWorkspaceSaaSEnabled,
  apiGetMyWorkspaces,
  apiInsertInvoice,
  apiUpdateInvoice,
  apiDeleteInvoice,
  apiInsertTransaction,
  apiDeleteTransaction,
  apiInsertProduct,
  apiUpdateProduct,
  apiDeleteProduct,
  apiTrackEvent,
} from './workspaceApi';
import { addToSyncQueueSafe } from './syncQueue';

function getWorkspaceId() {
  return getCurrentAccountId();
}

/** مساحة العمل الحالية فقط إذا كانت مسجّلة للمستخدم في السحابة (تجنّب RLS) */
async function getValidWorkspaceId() {
  const wid = getCurrentAccountId();
  if (!wid) return null;
  try {
    const list = await apiGetMyWorkspaces();
    const validIds = new Set((list || []).map((w) => w.id));
    if (validIds.has(wid)) return wid;
    setCurrentAccountId(null);
    return null;
  } catch (_) {
    return wid;
  }
}

/** إضافة فاتورة: سحابة ثم cache؛ عند الفشل نضيف للطابور ونحدّث الـ cache (تفاؤلي) */
export async function saveInvoiceToCloud(invoice) {
  const wid = getWorkspaceId();
  if (!isWorkspaceSaaSEnabled() || !wid) return false;
  const payload = { id: invoice.id, client: invoice.client, amount: invoice.amount, description: invoice.description, dueDate: invoice.dueDate, paid: invoice.paid };
  const id = await apiInsertInvoice(wid, payload);
  if (id) {
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.INVOICES, []);
      list.unshift({ ...invoice, id });
      cacheSet(wid, DATA_SUFFIXES.INVOICES, list);
    } catch (_) {}
    await apiTrackEvent(wid, 'create_invoice', { invoice_id: id });
    return true;
  }
  void addToSyncQueueSafe('insert_invoice', wid, payload);
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.INVOICES, []);
    list.unshift({ ...invoice });
    cacheSet(wid, DATA_SUFFIXES.INVOICES, list);
  } catch (_) {}
  return true;
}

/** تحديث فاتورة (مثلاً paid) */
export async function updateInvoiceToCloud(invoiceId, updates) {
  const wid = getWorkspaceId();
  if (!isWorkspaceSaaSEnabled() || !wid) return false;
  const ok = await apiUpdateInvoice(wid, invoiceId, updates);
  if (!ok) {
    void addToSyncQueueSafe('update_invoice', wid, { invoiceId, updates });
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.INVOICES, []);
      const idx = list.findIndex((i) => i.id === invoiceId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...updates };
        if (updates.paid !== undefined) list[idx].paid = updates.paid;
        cacheSet(wid, DATA_SUFFIXES.INVOICES, list);
      }
    } catch (_) {}
    return true;
  }
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.INVOICES, []);
    const idx = list.findIndex((i) => i.id === invoiceId);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...updates };
      if (updates.paid !== undefined) list[idx].paid = updates.paid;
      cacheSet(wid, DATA_SUFFIXES.INVOICES, list);
    }
  } catch (_) {}
  return true;
}

/** حذف فاتورة */
export async function deleteInvoiceFromCloud(invoiceId) {
  const wid = getWorkspaceId();
  if (!isWorkspaceSaaSEnabled() || !wid) return false;
  const ok = await apiDeleteInvoice(wid, invoiceId);
  if (!ok) {
    // Fire-and-forget: safe-mode should not create unhandled rejections.
    void addToSyncQueueSafe('delete_invoice', wid, { invoiceId });
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.INVOICES, []);
      cacheSet(wid, DATA_SUFFIXES.INVOICES, list.filter((i) => i.id !== invoiceId));
    } catch (_) {}
    return true;
  }
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.INVOICES, []);
    cacheSet(wid, DATA_SUFFIXES.INVOICES, list.filter((i) => i.id !== invoiceId));
  } catch (_) {}
  return true;
}

/** إضافة حركة (إيراد/مصروف) */
export async function saveTransactionToCloud(transaction) {
  const wid = getWorkspaceId();
  if (!isWorkspaceSaaSEnabled() || !wid) return false;
  const payload = { id: transaction.id, type: transaction.type, description: transaction.description, amount: transaction.amount, category: transaction.category, date: transaction.date };
  const id = await apiInsertTransaction(wid, payload);
  if (id) {
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.TRANSACTIONS, []);
      list.unshift({ ...transaction, id });
      cacheSet(wid, DATA_SUFFIXES.TRANSACTIONS, list);
    } catch (_) {}
    return true;
  }
  void addToSyncQueueSafe('insert_transaction', wid, payload);
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.TRANSACTIONS, []);
    list.unshift({ ...transaction });
    cacheSet(wid, DATA_SUFFIXES.TRANSACTIONS, list);
  } catch (_) {}
  return true;
}

/** حذف حركة */
export async function deleteTransactionFromCloud(transactionId) {
  const wid = getWorkspaceId();
  if (!isWorkspaceSaaSEnabled() || !wid) return false;
  const ok = await apiDeleteTransaction(wid, transactionId);
  if (!ok) {
    void addToSyncQueueSafe('delete_transaction', wid, { transactionId });
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.TRANSACTIONS, []);
      cacheSet(wid, DATA_SUFFIXES.TRANSACTIONS, list.filter((t) => t.id !== transactionId));
    } catch (_) {}
    return true;
  }
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.TRANSACTIONS, []);
    cacheSet(wid, DATA_SUFFIXES.TRANSACTIONS, list.filter((t) => t.id !== transactionId));
  } catch (_) {}
  return true;
}

/** إضافة منتج — يرجع { ok, error } */
export async function saveProductToCloud(product) {
  if (!isWorkspaceSaaSEnabled()) return { ok: false, error: 'المزامنة مع السحابة غير مفعّلة' };
  ensureSingleAccount();
  const wid = await getValidWorkspaceId();
  if (!wid) return { ok: false, error: 'لا توجد مساحة عمل. من الإعدادات اضغط «تحديث الاتصال ومزامنة الآن» بعد تسجيل الدخول.' };
  const payload = { id: product.id, name: product.name, quantity: product.quantity, minQuantity: product.minQuantity, unit: product.unit, costPrice: product.costPrice };
  const result = await apiInsertProduct(wid, payload);
  const id = result?.id ?? null;
  const err = result?.error;
  if (id) {
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.PRODUCTS, []);
      list.unshift({ ...product, id });
      cacheSet(wid, DATA_SUFFIXES.PRODUCTS, list);
    } catch (_) {}
    return { ok: true, error: null };
  }
  void addToSyncQueueSafe('insert_product', wid, payload);
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.PRODUCTS, []);
    list.unshift({ ...product });
    cacheSet(wid, DATA_SUFFIXES.PRODUCTS, list);
  } catch (_) {}
  return { ok: false, error: err || 'فشل الحفظ في السحابة' };
}

/** تحديث منتج — يرجع { ok, error } */
export async function updateProductToCloud(productId, updates) {
  if (!isWorkspaceSaaSEnabled()) return { ok: false, error: 'المزامنة مع السحابة غير مفعّلة' };
  const wid = await getValidWorkspaceId();
  if (!wid) return { ok: false, error: 'لا توجد مساحة عمل. من الإعدادات اضغط «تحديث الاتصال ومزامنة الآن» بعد تسجيل الدخول.' };
  const result = await apiUpdateProduct(wid, productId, updates);
  const ok = result?.ok;
  const err = result?.error;
  if (!ok) {
    void addToSyncQueueSafe('update_product', wid, { id: productId, updates });
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.PRODUCTS, []);
      const idx = list.findIndex((p) => p.id === productId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...updates };
        cacheSet(wid, DATA_SUFFIXES.PRODUCTS, list);
      }
    } catch (_) {}
    return { ok: false, error: err || 'فشل التحديث في السحابة' };
  }
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.PRODUCTS, []);
    const idx = list.findIndex((p) => p.id === productId);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...updates };
      cacheSet(wid, DATA_SUFFIXES.PRODUCTS, list);
    }
  } catch (_) {}
  return { ok: true, error: null };
}

/** حذف منتج — يرجع { ok, error } */
export async function deleteProductFromCloud(productId) {
  if (!isWorkspaceSaaSEnabled()) return { ok: false, error: 'المزامنة مع السحابة غير مفعّلة' };
  const wid = await getValidWorkspaceId();
  if (!wid) return { ok: false, error: 'لا توجد مساحة عمل. من الإعدادات اضغط «تحديث الاتصال ومزامنة الآن» بعد تسجيل الدخول.' };
  const result = await apiDeleteProduct(wid, productId);
  const ok = result?.ok;
  const err = result?.error;
  if (!ok) {
    void addToSyncQueueSafe('delete_product', wid, { productId });
    try {
      const list = cacheGet(wid, DATA_SUFFIXES.PRODUCTS, []);
      cacheSet(wid, DATA_SUFFIXES.PRODUCTS, list.filter((p) => p.id !== productId));
    } catch (_) {}
    return { ok: false, error: err || 'فشل الحذف في السحابة' };
  }
  try {
    const list = cacheGet(wid, DATA_SUFFIXES.PRODUCTS, []);
    cacheSet(wid, DATA_SUFFIXES.PRODUCTS, list.filter((p) => p.id !== productId));
  } catch (_) {}
  return { ok: true, error: null };
}

/** تسجيل حدث استيراد طلبات */
export async function trackImportOrders() {
  const wid = getWorkspaceId();
  if (!isWorkspaceSaaSEnabled() || !wid) return;
  await apiTrackEvent(wid, 'import_orders');
}
