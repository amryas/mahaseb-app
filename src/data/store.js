/**
 * عند تفعيل Supabase: المصدر الأساسي للبيانات هو PostgreSQL (عبر supabaseApi).
 * localStorage يُستخدم كـ cache فقط: يُملأ من Supabase عند التحميل، ويُحدَّث عند كل حفظ (مع المزامنة إلى Supabase).
 */
import {
  getCacheUserId,
  getWorkspaceSlice,
  setWorkspaceSlice,
  clearAllWorkspaceCache,
} from './cacheStore';
import {
  saveSales as saveSalesToIndexedDb,
  saveProducts as saveProductsToIndexedDb,
  saveInvoices as saveInvoicesToIndexedDb,
  saveTransactions as saveTransactionsToIndexedDb,
  saveCustomers as saveCustomersToIndexedDb,
} from './indexedDbStore';
const ACCOUNTS_KEY = 'mahaseb_accounts';
const CURRENT_ACCOUNT_KEY = 'mahaseb_current_account';

export const DATA_SUFFIXES = {
  TRANSACTIONS: 'transactions',
  INVOICES: 'invoices',
  SETTINGS: 'settings',
  CLIENTS: 'clients',
  EASY_ORDER_IDS: 'easy_order_synced',
  SHOPIFY_SYNCED_IDS: 'shopify_synced_ids',
  WEBSITE_SYNCED_IDS: 'website_synced_ids',
  WOOCOMMERCE_SYNCED_IDS: 'woocommerce_synced_ids',
  DAILY_OPENING: 'daily_opening',
  BRANDING: 'branding',
  ADMIN_PIN: 'admin_pin',
  PRODUCTS: 'products',
  SALES: 'sales',
  DEBTS: 'debts',
  STOCK_MOVEMENTS: 'stock_movements',
  SUPPLIERS: 'suppliers',
  PURCHASES: 'purchases',
  EMPLOYEES: 'employees',
  NOTIFICATIONS: 'notifications',
  WHATSAPP_ORDERS: 'whatsapp_orders',
  CAPITAL: 'capital',
};

export function getCurrentAccountId() {
  try {
    const scopedKey = `${CURRENT_ACCOUNT_KEY}_${getCacheUserId()}`;
    return localStorage.getItem(scopedKey) || localStorage.getItem(CURRENT_ACCOUNT_KEY) || null;
  } catch {
    return null;
  }
}

const activeWorkspaceListeners = new Set();

/** اشتراك React (useSyncExternalStore) عند تغيير مساحة العمل النشطة */
export function subscribeActiveWorkspace(listener) {
  activeWorkspaceListeners.add(listener);
  return () => activeWorkspaceListeners.delete(listener);
}

function notifyActiveWorkspaceChanged() {
  activeWorkspaceListeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });
}

export function setCurrentAccountId(id) {
  try {
    const scopedKey = `${CURRENT_ACCOUNT_KEY}_${getCacheUserId()}`;
    if (id) {
      localStorage.setItem(scopedKey, id);
      localStorage.setItem(CURRENT_ACCOUNT_KEY, id);
    } else {
      localStorage.removeItem(scopedKey);
      localStorage.removeItem(CURRENT_ACCOUNT_KEY);
    }
    notifyActiveWorkspaceChanged();
  } catch (e) {
    console.warn('فشل حفظ الحساب الحالي:', e);
  }
}

/** مسح كل الـ cache المحلي (عند تسجيل الخروج — أمان على الأجهزة المشتركة) */
export function clearAppCache() {
  clearAllWorkspaceCache();
}

export function getAccounts() {
  try {
    const scopedKey = `${ACCOUNTS_KEY}_${getCacheUserId()}`;
    const data = localStorage.getItem(scopedKey) || localStorage.getItem(ACCOUNTS_KEY);
    const list = data ? JSON.parse(data) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveAccounts(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  try {
    const scopedKey = `${ACCOUNTS_KEY}_${getCacheUserId()}`;
    localStorage.setItem(scopedKey, JSON.stringify(list));
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('فشل حفظ قائمة الحسابات:', e);
  }
}

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (_) {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

/** إنشاء حساب جديد واعتباره الحساب الحالي. إذا كانت أول مرة ويوجد بيانات قديمة، يتم نقلها. */
export function addAccount(name) {
  const id = randomId();
  const accounts = getAccounts();
  const isFirst = accounts.length === 0;
  accounts.push({ id, name: (name || 'حسابي').trim() || 'حسابي', createdAt: new Date().toISOString() });
  saveAccounts(accounts);
  setCurrentAccountId(id);

  if (isFirst) migrateLegacyToAccount(id);
  return id;
}

/** نقل البيانات من المفاتيح القديمة (بدون حساب) إلى الحساب الأول */
function migrateLegacyToAccount(accountId) {
  try {
    const suffixes = Object.values(DATA_SUFFIXES);
    suffixes.forEach((suffix) => {
      const oldKey = `mahaseb_${suffix}`;
      const val = localStorage.getItem(oldKey);
      if (val != null) {
        localStorage.setItem(`mahaseb_${accountId}_${suffix}`, val);
        localStorage.removeItem(oldKey);
      }
    });
  } catch (e) {
    console.warn('ترحيل البيانات القديمة:', e);
  }
}

/** قراءة من الـ cache (localStorage). عند تفعيل Supabase الـ cache يُملأ من PostgreSQL عند التحميل. */
function getData(suffix, defaultValue = []) {
  const workspaceId = getCurrentAccountId();
  if (!workspaceId) return Array.isArray(defaultValue) ? defaultValue : defaultValue;
  try {
    const value = getWorkspaceSlice(workspaceId, suffix, defaultValue);
    return Array.isArray(value) ? value : (Array.isArray(defaultValue) ? defaultValue : value);
  } catch {
    return defaultValue;
  }
}

let _afterSaveSync = null;
export function setAfterSaveSync(callback) {
  _afterSaveSync = callback;
}

/** كتابة في الـ cache ثم المزامنة إلى Supabase (عبر callback) عند التفاعل. Supabase = Primary. */
function setData(suffix, value, isArray = true) {
  let workspaceId = getCurrentAccountId();
  if (!workspaceId) {
    // Ensure we have a valid current workspace before writing cache/local data.
    try {
      ensureSingleAccount();
      workspaceId = getCurrentAccountId();
    } catch (_) {}
  }
  if (!workspaceId) return;
  try {
    const list = isArray ? (Array.isArray(value) ? value : []) : value;
    setWorkspaceSlice(workspaceId, suffix, list);
    const userId = getCacheUserId();
    const idbAvailable = typeof indexedDB !== 'undefined';
    if (idbAvailable && isArray) {
      if (suffix === DATA_SUFFIXES.SALES) void saveSalesToIndexedDb(workspaceId, userId, list).catch(() => {});
      if (suffix === DATA_SUFFIXES.PRODUCTS) void saveProductsToIndexedDb(workspaceId, userId, list).catch(() => {});
      if (suffix === DATA_SUFFIXES.INVOICES) void saveInvoicesToIndexedDb(workspaceId, userId, list).catch(() => {});
      if (suffix === DATA_SUFFIXES.TRANSACTIONS) void saveTransactionsToIndexedDb(workspaceId, userId, list).catch(() => {});
      if (suffix === DATA_SUFFIXES.CLIENTS) void saveCustomersToIndexedDb(workspaceId, userId, list).catch(() => {});
    }
    const accountId = getCurrentAccountId();
    if (accountId && _afterSaveSync) _afterSaveSync(accountId, suffix, list);
  } catch (e) {
    console.warn('فشل الحفظ:', suffix, e);
  }
}

// ——— منتجات ———
export function getProducts() {
  return getData(DATA_SUFFIXES.PRODUCTS, []);
}
export function saveProducts(products) {
  setData(DATA_SUFFIXES.PRODUCTS, products);
}

export function getSales() {
  return getData(DATA_SUFFIXES.SALES, []);
}
export function saveSales(sales) {
  const cleanSales = (Array.isArray(sales) ? sales : []).filter((s) => {
    if (!s || typeof s !== 'object') return false;
    const hasItems = Array.isArray(s.items) && s.items.length > 0;
    const hasSingleProduct = !!s.productId || !!s.productName;
    return hasItems || hasSingleProduct;
  });
  setData(DATA_SUFFIXES.SALES, cleanSales);
}

export function getDebts() {
  return getData(DATA_SUFFIXES.DEBTS, []);
}
export function saveDebts(debts) {
  setData(DATA_SUFFIXES.DEBTS, debts);
}

export function getStockMovements() {
  return getData(DATA_SUFFIXES.STOCK_MOVEMENTS, []);
}
export function saveStockMovements(movements) {
  setData(DATA_SUFFIXES.STOCK_MOVEMENTS, movements);
}

const DEFAULT_PIN = 'admin123';

export function getAppBranding() {
  const raw = getData(DATA_SUFFIXES.BRANDING, null);
  if (!raw || typeof raw !== 'object') return { appName: 'محاسب مشروعي', tagline: 'حساباتك بسهولة', logoBase64: '', bannerBase64: '' };
  return { ...raw, appName: raw.appName || 'محاسب مشروعي', tagline: raw.tagline || 'حساباتك بسهولة', logoBase64: raw.logoBase64 || '', bannerBase64: raw.bannerBase64 || '' };
}
export function saveAppBranding(branding) {
  setData(DATA_SUFFIXES.BRANDING, branding, false);
}

export function getAdminPin() {
  try {
    const workspaceId = getCurrentAccountId();
    if (!workspaceId) return DEFAULT_PIN;
    const value = getWorkspaceSlice(workspaceId, DATA_SUFFIXES.ADMIN_PIN, DEFAULT_PIN);
    return typeof value === 'string' && value ? value : DEFAULT_PIN;
  } catch {
    return DEFAULT_PIN;
  }
}
export function setAdminPin(pin) {
  const workspaceId = getCurrentAccountId();
  if (workspaceId) setWorkspaceSlice(workspaceId, DATA_SUFFIXES.ADMIN_PIN, String(pin || ''));
  const accountId = getCurrentAccountId();
  if (accountId && _afterSaveSync) _afterSaveSync(accountId, DATA_SUFFIXES.ADMIN_PIN, pin);
}

export function getDailyOpening() {
  const raw = getData(DATA_SUFFIXES.DAILY_OPENING, null);
  return raw && typeof raw === 'object' ? raw : {};
}
export function saveDailyOpening(obj) {
  setData(DATA_SUFFIXES.DAILY_OPENING, obj, false);
}

/** رأس المال: { amount: number, updatedAt: string } */
export function getCapital() {
  const raw = getData(DATA_SUFFIXES.CAPITAL, null);
  if (raw != null && typeof raw === 'object' && typeof raw.amount === 'number') return raw;
  return { amount: 0, updatedAt: new Date().toISOString() };
}
export function saveCapital(obj) {
  const value = { amount: Number(obj?.amount) || 0, updatedAt: new Date().toISOString() };
  setData(DATA_SUFFIXES.CAPITAL, value, false);
}

const defaultCategories = {
  income: ['مبيعات', 'خدمات', 'استثمار', 'هدية', 'طلبات Easy Order', 'أخرى'],
  expense: ['موردين', 'شراء بضاعة', 'رواتب', 'إيجار', 'مرافق', 'تسويق', 'صيانة', 'شحن', 'مرتجع', 'أخرى'],
};

export function getTransactions() {
  return getData(DATA_SUFFIXES.TRANSACTIONS, []);
}
export function saveTransactions(transactions) {
  setData(DATA_SUFFIXES.TRANSACTIONS, transactions);
}

export function getInvoices() {
  return getData(DATA_SUFFIXES.INVOICES, []);
}
export function saveInvoices(invoices) {
  setData(DATA_SUFFIXES.INVOICES, invoices);
}

const DEFAULT_SETTINGS = {
  companyName: '',
  companyAddress: '',
  companyTaxNumber: '',
  easyOrderApiKey: '',
  easyOrderBaseUrl: '',
  shopifyStoreUrl: '',
  shopifyAccessToken: '',
  websiteOrdersUrl: '',
  websiteOrdersApiKey: '',
  lastSyncEasyOrder: '',
  lastSyncShopify: '',
  lastSyncWebsite: '',
  lastSyncWooCommerce: '',
  autoSyncStoreOrders: false,
  woocommerceSiteUrl: '',
  woocommerceConsumerKey: '',
  woocommerceConsumerSecret: '',
  salesTargetMonthly: 0,
  shippingProvider: '',
  shippingApiKey: '',
  whatsappContactNumber: '',
  defaultProfitMargin: 0,
  notificationsEnabled: true,
  suggestPriceFromCost: true,
  whatsappPhoneNumberId: '',
  whatsappVerifyToken: '',
  dailyWhatsAppReportEnabled: false,
  dailyWhatsAppReportPhone: '',
  dailyWhatsAppReportTime: '21:00', // 9:00 PM
  dailyWhatsAppReportType: 'full', // 'sales' | 'profit' | 'full'
};
export function getSettings() {
  const raw = getData(DATA_SUFFIXES.SETTINGS, null);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...raw };
}
export function saveSettings(settings) {
  setData(DATA_SUFFIXES.SETTINGS, settings, false);
}

const MAX_NOTIFICATIONS = 100;
export function getNotifications() {
  const list = getData(DATA_SUFFIXES.NOTIFICATIONS, []);
  return Array.isArray(list) ? list : [];
}
export function saveNotifications(list) {
  const arr = Array.isArray(list) ? list.slice(0, MAX_NOTIFICATIONS) : [];
  setData(DATA_SUFFIXES.NOTIFICATIONS, arr);
}
export function addNotification({ type = 'info', title, message, link, linkLabel, notificationType }) {
  const list = getNotifications();
  list.unshift({
    id: crypto.randomUUID(),
    type: type || 'info',
    title: title || 'تنبيه',
    message: message || '',
    link: link || '',
    linkLabel: linkLabel || '',
    notificationType: notificationType || '',
    read: false,
    createdAt: new Date().toISOString(),
  });
  saveNotifications(list);
  return list;
}
export function markNotificationRead(id) {
  const list = getNotifications().map((n) => (n.id === id ? { ...n, read: true } : n));
  saveNotifications(list);
  return list;
}
export function markAllNotificationsRead() {
  const list = getNotifications().map((n) => ({ ...n, read: true }));
  saveNotifications(list);
  return list;
}

export function getClients() {
  return getData(DATA_SUFFIXES.CLIENTS, []);
}
export function saveClients(clients) {
  setData(DATA_SUFFIXES.CLIENTS, clients);
}

/** Notify Firebase/legacy sync hooks without rewriting full IndexedDB (caller updates IDB row). */
function notifyWorkspaceDataChanged(suffix, nextList) {
  const accountId = getCurrentAccountId();
  if (accountId && _afterSaveSync) _afterSaveSync(accountId, suffix, nextList);
}

/**
 * Merge one product into workspace cache only (avoids full-IDB replace; pair with upsertEntityRecord).
 * @param {Record<string, unknown>} product
 * @returns {boolean}
 */
export function mergeProductIntoCache(product) {
  if (!product?.id) return false;
  let workspaceId = getCurrentAccountId();
  if (!workspaceId) {
    try {
      ensureSingleAccount();
      workspaceId = getCurrentAccountId();
    } catch (_) {}
  }
  if (!workspaceId) return false;
  const list = getProducts();
  const idx = list.findIndex((p) => p.id === product.id);
  const next = idx >= 0 ? list.map((p) => (p.id === product.id ? { ...p, ...product } : p)) : [...list, product];
  setWorkspaceSlice(workspaceId, DATA_SUFFIXES.PRODUCTS, next);
  notifyWorkspaceDataChanged(DATA_SUFFIXES.PRODUCTS, next);
  return true;
}

/**
 * @param {string} productId
 * @returns {boolean}
 */
export function removeProductFromCache(productId) {
  if (!productId) return false;
  const workspaceId = getCurrentAccountId();
  if (!workspaceId) return false;
  const next = getProducts().filter((p) => p.id !== productId);
  setWorkspaceSlice(workspaceId, DATA_SUFFIXES.PRODUCTS, next);
  notifyWorkspaceDataChanged(DATA_SUFFIXES.PRODUCTS, next);
  return true;
}

/**
 * @param {Record<string, unknown>} transaction
 * @returns {boolean}
 */
export function mergeTransactionIntoCache(transaction) {
  if (!transaction?.id) return false;
  let workspaceId = getCurrentAccountId();
  if (!workspaceId) {
    try {
      ensureSingleAccount();
      workspaceId = getCurrentAccountId();
    } catch (_) {}
  }
  if (!workspaceId) return false;
  const list = getTransactions();
  const idx = list.findIndex((t) => t.id === transaction.id);
  const next = idx >= 0 ? list.map((t) => (t.id === transaction.id ? { ...t, ...transaction } : t)) : [...list, transaction];
  setWorkspaceSlice(workspaceId, DATA_SUFFIXES.TRANSACTIONS, next);
  notifyWorkspaceDataChanged(DATA_SUFFIXES.TRANSACTIONS, next);
  return true;
}

/**
 * @param {string} transactionId
 * @returns {boolean}
 */
export function removeTransactionFromCache(transactionId) {
  if (!transactionId) return false;
  const workspaceId = getCurrentAccountId();
  if (!workspaceId) return false;
  const next = getTransactions().filter((t) => t.id !== transactionId);
  setWorkspaceSlice(workspaceId, DATA_SUFFIXES.TRANSACTIONS, next);
  notifyWorkspaceDataChanged(DATA_SUFFIXES.TRANSACTIONS, next);
  return true;
}

/**
 * @param {Record<string, unknown>} client
 * @returns {boolean}
 */
export function mergeClientIntoCache(client) {
  if (!client?.id) return false;
  let workspaceId = getCurrentAccountId();
  if (!workspaceId) {
    try {
      ensureSingleAccount();
      workspaceId = getCurrentAccountId();
    } catch (_) {}
  }
  if (!workspaceId) return false;
  const list = getClients();
  const idx = list.findIndex((c) => c.id === client.id);
  const next = idx >= 0 ? list.map((c) => (c.id === client.id ? { ...c, ...client } : c)) : [...list, client];
  setWorkspaceSlice(workspaceId, DATA_SUFFIXES.CLIENTS, next);
  notifyWorkspaceDataChanged(DATA_SUFFIXES.CLIENTS, next);
  return true;
}

/**
 * @param {string} clientId
 * @returns {boolean}
 */
export function removeClientFromCache(clientId) {
  if (!clientId) return false;
  const workspaceId = getCurrentAccountId();
  if (!workspaceId) return false;
  const next = getClients().filter((c) => c.id !== clientId);
  setWorkspaceSlice(workspaceId, DATA_SUFFIXES.CLIENTS, next);
  notifyWorkspaceDataChanged(DATA_SUFFIXES.CLIENTS, next);
  return true;
}

/**
 * Merge one sale into workspace cache (no full IDB rewrite).
 * @param {Record<string, unknown>} sale
 * @returns {boolean}
 */
export function mergeSaleIntoCache(sale) {
  if (!sale?.id) return false;
  let workspaceId = getCurrentAccountId();
  if (!workspaceId) {
    try {
      ensureSingleAccount();
      workspaceId = getCurrentAccountId();
    } catch (_) {}
  }
  if (!workspaceId) return false;
  const list = getSales();
  const idx = list.findIndex((s) => s.id === sale.id);
  const next = idx >= 0 ? list.map((s) => (s.id === sale.id ? { ...s, ...sale } : s)) : [...list, sale];
  setWorkspaceSlice(workspaceId, DATA_SUFFIXES.SALES, next);
  notifyWorkspaceDataChanged(DATA_SUFFIXES.SALES, next);
  return true;
}

export function getEasyOrderSyncedIds() {
  return getData(DATA_SUFFIXES.EASY_ORDER_IDS, []);
}
export function saveEasyOrderSyncedIds(ids) {
  setData(DATA_SUFFIXES.EASY_ORDER_IDS, ids);
}
export function getShopifySyncedIds() {
  return getData(DATA_SUFFIXES.SHOPIFY_SYNCED_IDS, []);
}
export function saveShopifySyncedIds(ids) {
  setData(DATA_SUFFIXES.SHOPIFY_SYNCED_IDS, ids);
}
export function getWebsiteSyncedIds() {
  return getData(DATA_SUFFIXES.WEBSITE_SYNCED_IDS, []);
}
export function saveWebsiteSyncedIds(ids) {
  setData(DATA_SUFFIXES.WEBSITE_SYNCED_IDS, ids);
}
export function getWooCommerceSyncedIds() {
  return getData(DATA_SUFFIXES.WOOCOMMERCE_SYNCED_IDS, []);
}
export function saveWooCommerceSyncedIds(ids) {
  setData(DATA_SUFFIXES.WOOCOMMERCE_SYNCED_IDS, ids);
}

export function getCategories() {
  return defaultCategories;
}

export function getSuppliers() {
  return getData(DATA_SUFFIXES.SUPPLIERS, []);
}
export function saveSuppliers(suppliers) {
  setData(DATA_SUFFIXES.SUPPLIERS, suppliers);
}

export function getPurchases() {
  return getData(DATA_SUFFIXES.PURCHASES, []);
}
export function savePurchases(purchases) {
  setData(DATA_SUFFIXES.PURCHASES, purchases);
}

export function getEmployees() {
  return getData(DATA_SUFFIXES.EMPLOYEES, []);
}
export function saveEmployees(employees) {
  setData(DATA_SUFFIXES.EMPLOYEES, employees);
}

/** طلبات واتساب الواردة (من واتساب بيزنس API) */
export function getWhatsappOrders() {
  return getData(DATA_SUFFIXES.WHATSAPP_ORDERS, []);
}
export function saveWhatsappOrders(orders) {
  setData(DATA_SUFFIXES.WHATSAPP_ORDERS, orders);
}

/** التأكد من وجود حساب واحد واستخدامه (وضع الحساب الواحد فقط) */
export function ensureSingleAccount() {
  let accounts = getAccounts();
  if (accounts.length === 0) {
    addAccount('حسابي');
    accounts = getAccounts();
  }
  const current = getCurrentAccountId();
  if (!current || !accounts.find((a) => a.id === current)) {
    setCurrentAccountId(accounts[0]?.id || null);
  }
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ج.م';
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateLong(dateStr) {
  return new Date(dateStr).toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * تحويل أي قيمة إلى عدد للمبالغ — يقبل نقطة أو فاصلة عشرية وآلاف (١٬٢٣٤ أو 1,234.56)
 * يرجع 0 عند null/undefined/سطر فارغ/NaN
 */
export function parseAmount(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return Number.isNaN(val) ? 0 : val;
  const s = String(val).trim().replace(/\s/g, '').replace(/،/g, '.').replace(/٬/g, '');
  if (s === '') return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const decimalAt = lastDot >= 0 || lastComma >= 0 ? Math.max(lastDot, lastComma) : -1;
  let num;
  if (decimalAt >= 0) {
    const intPart = s.slice(0, decimalAt).replace(/[^\d-]/g, '');
    const decPart = s.slice(decimalAt + 1).replace(/\D/g, '').slice(0, 10);
    num = parseFloat(intPart + '.' + decPart);
  } else {
    num = parseFloat(s.replace(/[^\d.\-]/g, '').replace(/,/g, ''));
  }
  return Number.isNaN(num) ? 0 : num;
}

/** إجمالي مبيعة (تدعم الفاتورة أحادية المنتج أو متعددة المنتجات) */
export function getSaleTotal(sale) {
  if (!sale) return 0;
  if (Array.isArray(sale.items) && sale.items.length > 0) {
    const sub = sale.items.reduce((s, i) => s + (parseAmount(i.quantity) || 0) * parseAmount(i.unitPrice), 0);
    return Math.max(0, sub - parseAmount(sale.discount));
  }
  return parseAmount(sale.total);
}

/** ربح مبيعة (تدعم الفاتورة أحادية أو متعددة المنتجات) */
export function getSaleProfit(sale) {
  if (!sale) return 0;
  if (Array.isArray(sale.items) && sale.items.length > 0) {
    const total = getSaleTotal(sale);
    const totalCost = sale.items.reduce((s, i) => s + (parseAmount(i.quantity) || 0) * parseAmount(i.unitCost), 0);
    return total - totalCost;
  }
  return parseAmount(sale.profit);
}

/** وصف مختصر للمبيعة (للعرض في الجداول) */
export function getSaleSummary(sale) {
  if (!sale) return '—';
  if (Array.isArray(sale.items) && sale.items.length > 0) {
    return sale.items.map((i) => `${i.productName || 'منتج'} × ${i.quantity || 0}`).join('، ');
  }
  return `${sale.productName || 'منتج'} × ${sale.quantity || 0}`;
}

export function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('20') && digits.length >= 12) return digits;
  if (digits.length >= 10) return '20' + digits.replace(/^0/, '');
  return '20' + digits;
}
