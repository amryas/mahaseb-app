import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getCurrentAccountId, getAccounts, setCurrentAccountId, saveAccounts } from './store';
import { getFirebaseDb } from '../firebase/config';
import {
  getTransactions,
  getInvoices,
  saveInvoices,
  getProducts,
  getSales,
  getDebts,
  saveDebts,
  getSettings,
  saveSettings,
  getClients,
  getSuppliers,
  saveSuppliers,
  getPurchases,
  savePurchases,
  getEmployees,
  saveEmployees,
  getStockMovements,
  saveStockMovements,
  getAppBranding,
  saveAppBranding,
  getWhatsappOrders,
  saveWhatsappOrders,
} from './store';
import {
  hydrateTransactionsFromList,
  hydrateProductsFromList,
  hydrateSalesFromList,
  hydrateClientsFromList,
} from './bulkHydration';
import { initFirebase, isFirebaseEnabled } from '../firebase/config';

const ACCOUNT_KEYS = [
  'transactions',
  'invoices',
  'products',
  'sales',
  'debts',
  'settings',
  'clients',
  'suppliers',
  'purchases',
  'employees',
  'stock_movements',
  'branding',
  'whatsapp_orders',
];

const getters = {
  transactions: getTransactions,
  invoices: getInvoices,
  products: getProducts,
  sales: getSales,
  debts: getDebts,
  settings: getSettings,
  clients: getClients,
  suppliers: getSuppliers,
  purchases: getPurchases,
  employees: getEmployees,
  stock_movements: getStockMovements,
  branding: () => getAppBranding(),
  whatsapp_orders: getWhatsappOrders,
};

const setters = {
  invoices: saveInvoices,
  debts: saveDebts,
  settings: saveSettings,
  suppliers: saveSuppliers,
  purchases: savePurchases,
  employees: saveEmployees,
  stock_movements: saveStockMovements,
  branding: saveAppBranding,
  whatsapp_orders: saveWhatsappOrders,
};

let currentUserId = null;

export function setSyncUserId(uid) {
  currentUserId = uid;
}

export function getSyncUserId() {
  return currentUserId;
}

function accountRef(uid, accountId) {
  const db = getFirebaseDb();
  if (!db) return null;
  return doc(db, 'users', uid, 'accounts', accountId);
}

/** مزامنة مفتاح واحد للحساب الحالي إلى السحابة (يُستدعى بعد أي حفظ محلي) */
export async function syncAccountKeyToCloud(accountId, key, data) {
  if (!isFirebaseEnabled() || !currentUserId) return;
  try {
    const db = getFirebaseDb();
    if (!db) return;
    const ref = accountRef(currentUserId, accountId);
    if (!ref) return;
    await setDoc(ref, { [key]: data, updatedAt: new Date().toISOString() }, { merge: true });
    if (key === 'settings' && data && data.whatsappPhoneNumberId) {
      const mapRef = doc(db, 'whatsapp_phone_to_account', String(data.whatsappPhoneNumberId).trim());
      await setDoc(mapRef, { uid: currentUserId, accountId, updatedAt: new Date().toISOString() }, { merge: true });
    }
  } catch (e) {
    console.warn('فشل المزامنة مع السحابة:', e);
  }
}

/** مزامنة كل بيانات الحساب الحالي إلى السحابة */
export async function syncFullAccountToCloud(accountId) {
  if (!isFirebaseEnabled() || !currentUserId) return;
  try {
    const ref = accountRef(currentUserId, accountId);
    if (!ref) return;
    const payload = {};
    for (const key of ACCOUNT_KEYS) {
      const getter = getters[key];
      if (getter) payload[key] = getter();
      else if (key === 'branding') payload[key] = getAppBranding();
    }
    payload.updatedAt = new Date().toISOString();
    await setDoc(ref, payload, { merge: true });
  } catch (e) {
    console.warn('فشل المزامنة الكاملة:', e);
  }
}

/** جلب بيانات حساب من السحابة ودمجها في التخزين المحلي */
export async function loadAccountFromCloud(uid, accountId) {
  if (!isFirebaseEnabled()) return;
  try {
    setCurrentAccountId(accountId);
    const ref = accountRef(uid, accountId);
    if (!ref) return;
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    for (const key of ACCOUNT_KEYS) {
      if (data[key] === undefined) continue;
      if (key === 'transactions') {
        await hydrateTransactionsFromList(data[key]);
        continue;
      }
      if (key === 'products') {
        await hydrateProductsFromList(data[key]);
        continue;
      }
      if (key === 'sales') {
        await hydrateSalesFromList(data[key]);
        continue;
      }
      if (key === 'clients') {
        await hydrateClientsFromList(data[key]);
        continue;
      }
      const setter = setters[key];
      if (setter) setter(data[key]);
    }
  } catch (e) {
    console.warn('فشل جلب البيانات من السحابة:', e);
  }
}

/** جلب قائمة الحسابات وبياناتها من السحابة عند تسجيل الدخول. onLoaded() يُستدعى بعد التحميل لتحديث واجهة التطبيق. */
export async function loadUserDataFromCloud(uid, onLoaded) {
  if (!isFirebaseEnabled()) return;
  try {
    const db = getFirebaseDb();
    if (!db) {
      if (typeof onLoaded === 'function') onLoaded();
      return;
    }
    const accountsRef = doc(db, 'users', uid, 'meta', 'accounts');
    const snap = await getDoc(accountsRef);
    if (snap.exists() && snap.data().list && snap.data().list.length > 0) {
      saveAccounts(snap.data().list);
      const currentId = snap.data().currentAccountId;
      if (currentId) setCurrentAccountId(currentId);
      const accountId = getCurrentAccountId();
      if (accountId) await loadAccountFromCloud(uid, accountId);
    } else {
      syncAccountsListToCloud(uid);
      const accountId = getCurrentAccountId();
      if (accountId) await syncFullAccountToCloud(accountId);
    }
    if (typeof onLoaded === 'function') onLoaded();
  } catch (e) {
    console.warn('فشل جلب بيانات المستخدم:', e);
    if (typeof onLoaded === 'function') onLoaded();
  }
}

/** جلب طلبات واتساب الواردة من السحابة (بعد كتابة الويب هوك لها) */
export async function fetchWhatsappOrdersFromCloud(uid, accountId) {
  if (!isFirebaseEnabled() || !uid || !accountId) return null;
  try {
    const ref = accountRef(uid, accountId);
    if (!ref) return null;
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data()?.whatsapp_orders;
    if (Array.isArray(data)) {
      saveWhatsappOrders(data);
      return data;
    }
    return null;
  } catch (e) {
    console.warn('فشل جلب طلبات واتساب:', e);
    return null;
  }
}

/** حفظ قائمة الحسابات والحساب الحالي في السحابة */
export async function syncAccountsListToCloud(uid) {
  if (!isFirebaseEnabled() || !uid) return;
  try {
    const db = getFirebaseDb();
    if (!db) return;
    const ref = doc(db, 'users', uid, 'meta', 'accounts');
    await setDoc(ref, {
      list: getAccounts(),
      currentAccountId: getCurrentAccountId(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    console.warn('فشل حفظ قائمة الحسابات في السحابة:', e);
  }
}
