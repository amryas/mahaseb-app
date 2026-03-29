import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import {
  getCurrentAccountId,
  getAccounts,
  setCurrentAccountId,
  saveAccounts,
  ensureSingleAccount,
  DATA_SUFFIXES,
} from './store';
import {
  CACHE_KEYS,
  apiCreateDevice,
  apiGetAccountsByDevice,
  apiUpsertAccount,
  apiUpdateAccountsUser,
  apiUpdateDeviceUser,
  apiGetAccountData,
  apiSetAccountKey,
  apiWriteCacheToSupabase,
  hydrateCacheFromApi,
  cacheSet,
  cacheGet,
} from './supabaseApi';
import { getWorkspaceSlice } from './cacheStore';
import { ensureSubscriptionForWorkspace } from './subscriptionApi';
import { getSubscription } from './subscriptionApi';
import {
  resolvePrimaryWorkspaceForCurrentUser,
  apiGetAllProducts,
  apiGetAllTransactions,
  apiGetAllInvoices,
  apiGetAllSales,
  apiGetAllCustomers,
  apiTrackEvent,
  apiUpsertSales,
} from './workspaceApi';
import { addToSyncQueueSafe, processSyncQueue } from './syncQueue';
import { logSystemEvent } from '../services/monitoring';

const LAST_SYNC_SETUP_ERROR_KEY = 'mahaseb_last_sync_setup_error';

/** يمنع استدعاء bootstrap مزدوج لنفس المستخدم بالتوازي (سباق تسجيل الدخول / إعادة التحميل) */
const workspaceBootstrapInflight = new Map();

export function resetWorkspaceBootstrapState(userId) {
  if (userId) {
    workspaceBootstrapInflight.delete(userId);
    try {
      localStorage.removeItem(`mahaseb_last_resolved_workspace_${userId}`);
    } catch (_) {}
  }
}

export function getLastSyncSetupError() {
  try {
    return localStorage.getItem(LAST_SYNC_SETUP_ERROR_KEY) || null;
  } catch {
    return null;
  }
}
function setLastSyncSetupError(msg) {
  try {
    if (msg) localStorage.setItem(LAST_SYNC_SETUP_ERROR_KEY, msg);
    else localStorage.removeItem(LAST_SYNC_SETUP_ERROR_KEY);
  } catch (_) {}
}
function clearLastSyncSetupError() {
  setLastSyncSetupError(null);
}

/** دفع بيانات الحساب المحلي إلى السحابة تحت workspace جديد (عند الانتقال من حساب محلي لـ workspace حقيقي) */
async function pushLocalCacheToSupabase(fromAccountId, toWorkspaceId) {
  if (!fromAccountId || !toWorkspaceId || fromAccountId === toWorkspaceId) return;
  const keys = Object.values(DATA_SUFFIXES).filter((k) => k !== DATA_SUFFIXES.ADMIN_PIN);
  for (const key of keys) {
    try {
      const value = getWorkspaceSlice(fromAccountId, key, undefined);
      if (value === undefined) continue;
      await apiSetAccountKey(toWorkspaceId, key, value);
      if (key === DATA_SUFFIXES.SALES && Array.isArray(value) && value.length > 0) {
        await apiUpsertSales(toWorkspaceId, value);
      }
    } catch (_) {}
  }
}

function shouldWriteDataset(accountId, suffix, incoming) {
  if (!Array.isArray(incoming)) return false;
  const cached = cacheGet(accountId, suffix, []);
  // لا نستبدل بيانات محلية موجودة بقائمة فارغة من السحابة: يحدث عند workspace خاطئ، RLS، أو فشل مزامنة —
  // وكان سيمسح أسبوعين+ من العمل محلياً عند أول تحميل أونلاين.
  if (incoming.length === 0 && Array.isArray(cached) && cached.length > 0) return false;
  return true;
}

/**
 * Loader مركزي لبيانات مساحة العمل.
 * يحمّل كل البيانات اللازمة للـ UI دفعة واحدة ويملأ cache موحد.
 */
export async function loadWorkspaceData(workspaceId) {
  if (!workspaceId) return;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('e2e_billing_simulate_saas') === '1') {
      return null;
    }
    const [prods, tx, inv, sales, clients, subscription] = await Promise.all([
      apiGetAllProducts(workspaceId),
      apiGetAllTransactions(workspaceId),
      apiGetAllInvoices(workspaceId),
      apiGetAllSales(workspaceId),
      apiGetAllCustomers(workspaceId),
      getSubscription(workspaceId),
    ]);

    if (shouldWriteDataset(workspaceId, DATA_SUFFIXES.PRODUCTS, prods)) cacheSet(workspaceId, DATA_SUFFIXES.PRODUCTS, prods);
    if (shouldWriteDataset(workspaceId, DATA_SUFFIXES.TRANSACTIONS, tx)) cacheSet(workspaceId, DATA_SUFFIXES.TRANSACTIONS, tx);
    if (shouldWriteDataset(workspaceId, DATA_SUFFIXES.INVOICES, inv)) cacheSet(workspaceId, DATA_SUFFIXES.INVOICES, inv);
    if (shouldWriteDataset(workspaceId, DATA_SUFFIXES.SALES, sales)) cacheSet(workspaceId, DATA_SUFFIXES.SALES, sales);
    if (shouldWriteDataset(workspaceId, DATA_SUFFIXES.CLIENTS, clients)) cacheSet(workspaceId, DATA_SUFFIXES.CLIENTS, clients);

    await apiTrackEvent(workspaceId, 'sync_success', {});
    return { products: prods, transactions: tx, invoices: inv, sales, clients, subscription };
  } catch (e) {
    console.warn('Supabase: فشل تحميل بيانات الـ workspace إلى الـ cache', e);
    void logSystemEvent('sync_failure', 'workspace bootstrap failed', { workspaceId, error: e?.message || 'unknown' });
    await apiTrackEvent(workspaceId, 'sync_failed', { error: e?.message || 'unknown' }).catch(() => {});
    return null;
  }
}

// Backward compatibility.
export async function loadWorkspaceDataToCache(workspaceId) {
  return loadWorkspaceData(workspaceId);
}

/** الحصول على أو إنشاء device_id؛ يُحفظ في الـ cache (localStorage). يُمرَّر userId لضمان نجاح RLS عند إنشاء جهاز جديد. */
export async function getOrCreateDeviceId(userId = null) {
  try {
    let deviceId = localStorage.getItem(CACHE_KEYS.DEVICE_ID);
    if (deviceId) return deviceId;
    deviceId = await apiCreateDevice(userId || undefined);
    if (deviceId) localStorage.setItem(CACHE_KEYS.DEVICE_ID, deviceId);
    return deviceId;
  } catch (e) {
    console.warn('Supabase: فشل getOrCreateDeviceId', e);
    return null;
  }
}

/** حفظ مفتاح واحد في PostgreSQL (Primary) عبر الـ API */
export async function syncAccountKeyToSupabase(accountId, key, value) {
  if (!accountId) return false;
  try {
    await apiSetAccountKey(accountId, key, value);
    if (key === DATA_SUFFIXES.SALES && Array.isArray(value) && value.length > 0) {
      const validSales = value.filter((s) => {
        if (!s || typeof s !== 'object') return false;
        const hasItems = Array.isArray(s.items) && s.items.length > 0;
        const hasSingleProduct = !!s.productId;
        return hasItems || hasSingleProduct;
      });
      if (validSales.length > 0) await apiUpsertSales(accountId, validSales);
    }
    return true;
  } catch (e) {
    if (key === DATA_SUFFIXES.SALES && Array.isArray(value)) {
      void addToSyncQueueSafe('upsert_sales', accountId, { sales: value.map((s) => ({ ...s, pending_sync: true })) });
    }
    void logSystemEvent('sync_failure', 'syncAccountKeyToSupabase failed', { accountId, key, error: e?.message || 'unknown' });
    return false;
  }
}

/** حفظ قائمة الحسابات في PostgreSQL (عبر API) */
export async function syncAccountsListToSupabase(deviceId) {
  if (!isSupabaseEnabled() || !deviceId) return;
  const accounts = getAccounts();
  try {
    const { data: { user: authUser } } = await getSupabase().auth.getUser();
    const userId = authUser?.id || null;
    for (const acc of accounts) {
      await apiUpsertAccount(acc.id, deviceId, acc.name, userId);
    }
  } catch (e) {
    console.warn('Supabase: فشل حفظ قائمة الحسابات', e);
  }
}

/** جلب بيانات الحساب من PostgreSQL (Primary) وملء الـ cache */
export async function loadAccountDataFromSupabase(accountId) {
  if (!isSupabaseEnabled() || !accountId) return;
  try {
    const data = await apiGetAccountData(accountId);
    if (data) hydrateCacheFromApi(accountId, data);
  } catch (e) {
    console.warn('Supabase: فشل جلب بيانات الحساب', e);
  }
}

/** جلب قائمة الحسابات من PostgreSQL وملء الـ cache؛ إن لم توجد نرفع من الـ cache إلى Supabase */
export async function loadAccountsFromSupabase(deviceId) {
  if (!isSupabaseEnabled() || !deviceId) return;
  try {
    const cloudAccounts = await apiGetAccountsByDevice(deviceId);
    const localAccounts = getAccounts();
    if (cloudAccounts && cloudAccounts.length > 0) {
      saveAccounts(cloudAccounts);
      const current = getCurrentAccountId();
      if (!current || !cloudAccounts.find((a) => a.id === current)) setCurrentAccountId(cloudAccounts[0]?.id || null);
      return;
    }
    if (localAccounts.length > 0) {
      for (const acc of localAccounts) {
        await apiUpsertAccount(acc.id, deviceId, acc.name);
      }
      for (const acc of localAccounts) {
        await apiWriteCacheToSupabase(acc.id, (key) => cacheGet(acc.id, key, undefined));
      }
    }
  } catch (e) {
    console.warn('Supabase: فشل جلب الحسابات', e);
  }
}

/** تهيئة Supabase: جهاز، حسابات، ثم تحميل بيانات الحساب الحالي */
export async function initSupabaseAndLoad(onLoaded) {
  if (!isSupabaseEnabled()) {
    if (typeof onLoaded === 'function') onLoaded();
    return;
  }
  try {
    const deviceId = await getOrCreateDeviceId();
    if (!deviceId) {
      if (typeof onLoaded === 'function') onLoaded();
      return;
    }
    await loadAccountsFromSupabase(deviceId);
    await syncAccountsListToSupabase(deviceId);
    const currentId = getCurrentAccountId();
    if (currentId) await loadAccountDataFromSupabase(currentId);
    if (typeof onLoaded === 'function') onLoaded();
  } catch (e) {
    console.warn('Supabase: فشل التهيئة', e);
    void logSystemEvent('sync_failure', 'initSupabaseAndLoad failed', { error: e?.message || 'unknown' });
    if (typeof onLoaded === 'function') onLoaded();
  }
}

/** إضافة حساب جديد في PostgreSQL عند إنشائه من الواجهة */
export async function ensureAccountInSupabase(accountId, name, deviceId) {
  if (!isSupabaseEnabled() || !accountId) return;
  const did = deviceId || (await getOrCreateDeviceId());
  if (!did) return;
  await apiUpsertAccount(accountId, did, name);
}

/** التأكد من وجود كل الحسابات المحلية في Supabase (مفيد عند استخدام Firebase + Supabase) */
export async function ensureAllAccountsInSupabase() {
  if (!isSupabaseEnabled()) return;
  const deviceId = await getOrCreateDeviceId();
  if (!deviceId) return;
  const accounts = getAccounts();
  for (const acc of accounts) {
    await ensureAccountInSupabase(acc.id, acc.name, deviceId);
  }
}

/** ربط حسابات الجهاز الحالي بالمستخدم (بعد تسجيل الدخول) */
export async function linkDeviceAccountsToUser(userId) {
  if (!isSupabaseEnabled() || !userId) return;
  const deviceId = localStorage.getItem(CACHE_KEYS.DEVICE_ID);
  if (!deviceId) return;
  await apiUpdateAccountsUser(deviceId, userId);
}

/**
 * مسار واحد بعد تسجيل الدخول: RPC/عميل يختاران مساحة العمل «الأثقل» أو ينشئان واحدة فقط،
 * ثم دمج كاش الضيف (mahaseb_current_account القديم) إلى تلك المساحة.
 */
export async function performUserWorkspaceBootstrap(userId) {
  if (!isSupabaseEnabled() || !userId) return null;
  if (typeof localStorage !== 'undefined' && localStorage.getItem('e2e_billing_simulate_saas') === '1') {
    return null;
  }

  const previousLocalWorkspaceId = getCurrentAccountId();

  const resolved = await resolvePrimaryWorkspaceForCurrentUser();
  const primaryId = resolved.workspaceId;

  if (!primaryId) {
    setLastSyncSetupError(resolved.error || 'تعذّر تحديد مساحة العمل — راجع دالة get_or_create_primary_workspace في Supabase');
    ensureSingleAccount();
    return null;
  }

  clearLastSyncSetupError();

  if (resolved.createdNew) {
    void logSystemEvent(
      'workspace_created',
      'primary workspace created',
      { workspaceId: primaryId, source: 'bootstrap' },
      { force: true, userId },
    );
  }

  const lastKey = `mahaseb_last_resolved_workspace_${userId}`;
  let lastResolved = null;
  try {
    lastResolved = localStorage.getItem(lastKey);
  } catch (_) {}

  if (lastResolved && lastResolved !== primaryId) {
    void logSystemEvent(
      'workspace_switch',
      'primary workspace id changed',
      { fromWorkspaceId: lastResolved, toWorkspaceId: primaryId },
      { force: true, userId },
    );
  }
  try {
    localStorage.setItem(lastKey, primaryId);
  } catch (_) {}

  if (previousLocalWorkspaceId && primaryId && previousLocalWorkspaceId !== primaryId) {
    void logSystemEvent(
      'workspace_guest_migrate',
      'merging local workspace cache into primary',
      { fromWorkspaceId: previousLocalWorkspaceId, toWorkspaceId: primaryId },
      { force: true, userId },
    );
    await pushLocalCacheToSupabase(previousLocalWorkspaceId, primaryId);
  }

  let deviceId = localStorage.getItem(CACHE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = await getOrCreateDeviceId(userId);
  }
  if (deviceId) {
    await apiUpdateDeviceUser(deviceId, userId);
    const accountResult = await apiUpsertAccount(primaryId, deviceId, 'مساحة عملي', userId);
    if (accountResult && !accountResult.ok) {
      setLastSyncSetupError(`فشل ربط الحساب: ${accountResult.error || 'راجع سياسات جدول accounts في Supabase'}`);
    }
  } else {
    setLastSyncSetupError('لم يتم إنشاء الجهاز أو ربطه — راجع جدول devices وسياسات RLS');
  }

  const newAccount = { id: primaryId, name: 'مساحة عملي', createdAt: new Date().toISOString() };
  saveAccounts([newAccount]);
  setCurrentAccountId(primaryId);

  await ensureSubscriptionForWorkspace(userId, primaryId);
  await loadAccountDataFromSupabase(primaryId);
  await loadWorkspaceData(primaryId);

  return primaryId;
}

/** جلب/إنشاء مساحة العمل للمستخدم — idempotent عبر workspaceBootstrapInflight */
export async function loadAccountsForUser(userId, onLoaded) {
  if (!isSupabaseEnabled() || !userId) {
    if (typeof onLoaded === 'function') onLoaded();
    return;
  }
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('e2e_billing_simulate_saas') === '1') {
      if (typeof onLoaded === 'function') onLoaded();
      return;
    }
    let p = workspaceBootstrapInflight.get(userId);
    if (!p) {
      p = performUserWorkspaceBootstrap(userId).finally(() => {
        workspaceBootstrapInflight.delete(userId);
      });
      workspaceBootstrapInflight.set(userId, p);
    }
    await p;
  } catch (e) {
    console.warn('Supabase: فشل جلب حسابات المستخدم', e);
    void logSystemEvent('sync_failure', 'loadAccountsForUser failed', { userId, error: e?.message || 'unknown' });
    ensureSingleAccount();
  }
  if (typeof onLoaded === 'function') onLoaded();
}

/** تهيئة بعد تسجيل الدخول: إنشاء/ربط جهاز، ربط الحسابات بالمستخدم، جلب البيانات، ثم معالجة طابور المزامنة */
export async function initAfterSupabaseLogin(userId, onLoaded) {
  if (!isSupabaseEnabled() || !userId) {
    if (typeof onLoaded === 'function') onLoaded();
    return;
  }
  try {
    await getOrCreateDeviceId(userId);
    await linkDeviceAccountsToUser(userId);
    await loadAccountsForUser(userId, async () => {
      let workspaceId = getCurrentAccountId();
      if (!workspaceId) {
        await new Promise((r) => setTimeout(r, 2500));
        await loadAccountsForUser(userId, async () => {
          workspaceId = getCurrentAccountId();
          if (workspaceId) await apiTrackEvent(workspaceId, 'login');
          await processSyncQueue();
          if (typeof onLoaded === 'function') onLoaded();
        });
        return;
      }
      if (workspaceId) await apiTrackEvent(workspaceId, 'login');
      await processSyncQueue();
      if (typeof onLoaded === 'function') onLoaded();
    });
  } catch (e) {
    console.warn('Supabase: فشل التهيئة بعد الدخول', e);
    void logSystemEvent('sync_failure', 'initAfterSupabaseLogin failed', { userId, error: e?.message || 'unknown' });
    ensureSingleAccount();
    if (typeof onLoaded === 'function') onLoaded();
  }
}
