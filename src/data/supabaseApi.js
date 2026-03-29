/**
 * طبقة API للوصول إلى Supabase (PostgreSQL).
 * التدفق: App → Store → هذا الملف (API) → Supabase → PostgreSQL
 * لا يستدعي أي جزء من التطبيق Supabase مباشرة إلا عبر هذا الملف.
 */

import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { DATA_SUFFIXES } from './store';
import { buildWorkspaceCacheKey, getWorkspaceSlice, setWorkspaceSlice } from './cacheStore';

/** تحويل القيمة للحفظ في account_data (كائن أو مصفوفة أو قيمة بسيطة) */
function normalizeValue(key, value) {
  if (value === undefined || value === null) return {};
  if (key === DATA_SUFFIXES.ADMIN_PIN) return typeof value === 'string' ? value : String(value?.value ?? '');
  if (typeof value === 'object') return value;
  return { value };
}

/** تحويل قيمة admin_pin من الصف (قد تكون string أو { value }) */
function parseAdminPin(rowValue) {
  if (rowValue == null) return '';
  if (typeof rowValue === 'string') return rowValue;
  return String(rowValue?.value ?? '');
}

/** تحويل الصف القادم من account_data إلى قيمة للـ cache */
function parseValue(key, rowValue) {
  if (key === DATA_SUFFIXES.ADMIN_PIN) return parseAdminPin(rowValue);
  if (rowValue == null) return [];
  if (typeof rowValue === 'string') return rowValue;
  return rowValue;
}

// ——— Devices ———

export async function apiCreateDevice(userId = null) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  const payload = (userId || user?.id) ? { user_id: userId || user.id } : {};
  const { data, error } = await sb.from('devices').insert(payload).select('id').single();
  if (error || !data?.id) return null;
  return data.id;
}

export async function apiUpdateDeviceUser(deviceId, userId) {
  const sb = getSupabase();
  if (!sb || !deviceId || !userId) return false;
  const { error } = await sb.from('devices').update({ user_id: userId }).eq('id', deviceId);
  return !error;
}

// ——— Accounts ———

export async function apiGetAccountsByDevice(deviceId) {
  const sb = getSupabase();
  if (!sb || !deviceId) return [];
  const { data, error } = await sb
    .from('accounts')
    .select('id, name, created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []).map((a) => ({ id: a.id, name: a.name || 'حسابي', createdAt: a.created_at }));
}

export async function apiGetAccountsByUser(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return [];
  const { data, error } = await sb
    .from('accounts')
    .select('id, name, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []).map((a) => ({ id: a.id, name: a.name || 'حسابي', createdAt: a.created_at }));
}

export async function apiUpsertAccount(accountId, deviceId, name, userId = null) {
  const sb = getSupabase();
  if (!sb || !accountId || !deviceId) return { ok: false, error: !accountId || !deviceId ? 'معرّف الحساب أو الجهاز ناقص' : 'الاتصال غير متاح' };
  const { data: { user } } = await sb.auth.getUser();
  const uid = userId || user?.id || null;
  const { error } = await sb.from('accounts').upsert(
    {
      id: accountId,
      device_id: deviceId,
      name: name || 'حسابي',
      created_at: new Date().toISOString(),
      user_id: uid,
    },
    { onConflict: 'id' }
  );
  if (error) return { ok: false, error: error.message || 'فشل حفظ الحساب في السحابة' };
  return { ok: true, error: null };
}

export async function apiUpdateAccountsUser(deviceId, userId) {
  const sb = getSupabase();
  if (!sb || !deviceId) return false;
  const { error } = await sb.from('accounts').update({ user_id: userId }).eq('device_id', deviceId);
  return !error;
}

// ——— Account Data (Primary storage: كل بيانات الحساب) ———

/** جلب كل مفاتيح حساب من PostgreSQL (المصدر الأساسي) */
export async function apiGetAccountData(accountId) {
  const sb = getSupabase();
  if (!sb || !accountId) return null;
  const { data: rows, error } = await sb
    .from('account_data')
    .select('key, value')
    .eq('account_id', accountId);
  if (error || !rows || !rows.length) return null;
  const out = {};
  for (const { key, value } of rows) {
    if (key === DATA_SUFFIXES.ADMIN_PIN) continue;
    out[key] = parseValue(key, value);
  }
  return out;
}

/** حفظ مفتاح واحد في PostgreSQL (الكتابة تتم هنا أولاً ثم الـ cache يُحدَّث من الـ Store) */
export async function apiSetAccountKey(accountId, key, value) {
  if (!isSupabaseEnabled() || !accountId) return false;
  if (key === DATA_SUFFIXES.ADMIN_PIN) return true;
  const sb = getSupabase();
  if (!sb) return false;
  const jsonValue = normalizeValue(key, value);
  const payload = {
    account_id: accountId,
    key,
    value: jsonValue,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('account_data').upsert(payload, { onConflict: 'account_id,key' });
  return !error;
}

/** كتابة بيانات الحساب من الـ cache إلى PostgreSQL (للمزامنة الأولية أو الاستعادة) */
export async function apiWriteCacheToSupabase(accountId, getCacheItem) {
  if (!getCacheItem || !accountId) return;
  const sb = getSupabase();
  if (!sb) return;
  const keys = Object.values(DATA_SUFFIXES).filter((k) => k !== DATA_SUFFIXES.ADMIN_PIN);
  for (const key of keys) {
    const value = getCacheItem(key);
    if (value === undefined) continue;
    await apiSetAccountKey(accountId, key, value);
  }
}

// ——— Cache helpers (للـ Store: قراءة/كتابة localStorage كـ cache فقط) ———

export const CACHE_KEYS = {
  ACCOUNTS: 'mahaseb_accounts',
  CURRENT_ACCOUNT: 'mahaseb_current_account',
  DEVICE_ID: 'mahaseb_device_id',
};

export function cacheKey(accountId, suffix) {
  // Legacy compat only. New cache is unified per workspace/user.
  return suffix ? `${buildWorkspaceCacheKey(accountId)}::${suffix}` : `${buildWorkspaceCacheKey(accountId)}`;
}

/** قراءة من الـ cache فقط (يستخدمها Store عند عدم وجود Supabase أو للقراءة الفورية) */
export function cacheGet(accountId, suffix, defaultValue = []) {
  if (!accountId) return Array.isArray(defaultValue) ? defaultValue : defaultValue;
  try {
    const parsed = getWorkspaceSlice(accountId, suffix, defaultValue);
    return Array.isArray(defaultValue) && !Array.isArray(parsed) ? defaultValue : parsed;
  } catch {
    return defaultValue;
  }
}

/** كتابة في الـ cache فقط (بعد النجاح من API أو للقراءة المحلية) */
export function cacheSet(accountId, suffix, value, isArray = true) {
  if (!accountId) return;
  try {
    const out = isArray ? (Array.isArray(value) ? value : []) : value;
    setWorkspaceSlice(accountId, suffix, out);
  } catch (e) {
    console.warn('فشل كتابة الـ cache:', suffix, e);
  }
}

/** ملء الـ cache من نتيجة apiGetAccountData (بعد جلب من PostgreSQL). لا نكتب admin_pin من السحابة (يبقى محلياً فقط). */
export function hydrateCacheFromApi(accountId, data) {
  if (!accountId || !data || typeof data !== 'object') return;
  for (const [key, value] of Object.entries(data)) {
    if (key === DATA_SUFFIXES.ADMIN_PIN) continue;
    setWorkspaceSlice(accountId, key, value);
  }
}

export function isSupabasePrimary() {
  return isSupabaseEnabled();
}
