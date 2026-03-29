/**
 * API الاشتراكات — قراءة فقط من الفرونت إند. Trial والتفعيل عبر Edge Functions.
 * يدعم التخزين المؤقت (localStorage) للعمل دون اتصال.
 */

import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { getCurrentAccountId } from './store';
import { createTrialSubscriptionViaEdge } from './subscriptionApiSecure';
import { getSubscriptionCache as getSubscriptionCacheFromIndexedDb, saveSubscriptionCache as saveSubscriptionCacheToIndexedDb } from './indexedDbStore';

const CACHE_PREFIX = 'mahaseb_sub_';

const viteEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
/** أيام السماح بعد انتهاء subscription_end_date قبل اعتبار الحالة منتهية */
export const SUBSCRIPTION_GRACE_DAYS = Math.max(
  0,
  parseInt(String(viteEnv.VITE_SUBSCRIPTION_GRACE_DAYS || '3'), 10) || 3
);

/** أيام التجربة المجانية للحساب الجديد */
export const TRIAL_DAYS = Math.max(
  0,
  parseInt(String(viteEnv.VITE_TRIAL_DAYS || '3'), 10) || 3
);

function cacheKey(workspaceId) {
  return `${CACHE_PREFIX}${workspaceId || ''}`;
}

/** قراءة الاشتراك من الـ cache (للعمل دون اتصال) */
export function getSubscriptionFromCache(workspaceId) {
  const key = cacheKey(workspaceId || getCurrentAccountId());
  if (!key || key === CACHE_PREFIX) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** حفظ الاشتراك في الـ cache */
export function setSubscriptionCache(workspaceId, subscription) {
  const key = cacheKey(workspaceId || getCurrentAccountId());
  if (!key || key === CACHE_PREFIX) return;
  try {
    if (subscription) {
      localStorage.setItem(key, JSON.stringify(subscription));
    } else {
      localStorage.removeItem(key);
    }
  } catch (_) {}

  // Write-through to IndexedDB cache (best-effort, non-blocking).
  try {
    if (typeof indexedDB === 'undefined') return;
    if (!workspaceId) return; // if we don't have workspaceId, keep backward-compat localStorage only
    const userId = getCurrentAccountId();
    if (!userId) return;
    if (subscription) {
      // Keep minimal shape; IDB cache is best-effort.
      void saveSubscriptionCacheToIndexedDb(workspaceId, userId, { ...subscription }).catch(() => {});
    }
  } catch (_) {}
}

/**
 * حالة فعّالة للعرض والحراسة: trial منتهي → expired، اشتراك منتهي → grace ثم expired.
 * @param {Record<string, unknown> | null} sub
 * @returns {'trial'|'active'|'grace'|'expired'|'cancelled'|string|null}
 */
export function computeEffectiveStatus(sub) {
  try {
    if (sub == null || typeof sub !== 'object' || Array.isArray(sub)) return null;
    const raw = sub.status;
    if (typeof raw !== 'string') return null;
    if (raw === 'cancelled') return 'cancelled';
    if (raw === 'expired') return 'expired';
    if (raw === 'trial' && sub.trial_end_date) {
      const trialEnd = new Date(sub.trial_end_date);
      if (!Number.isNaN(trialEnd.getTime()) && trialEnd <= new Date()) return 'expired';
      return 'trial';
    }
    if (raw === 'trial') {
      // fallback: لو trial_end_date غير موجود (بيانات قديمة/تجربة)، نحسبها من created_at
      if (sub.created_at && TRIAL_DAYS > 0) {
        const created = new Date(sub.created_at);
        if (!Number.isNaN(created.getTime())) {
          const end = new Date(created.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
          if (end <= new Date()) return 'expired';
        }
      }
      return 'trial';
    }

    if (raw === 'active') {
      const expiresAt = sub?.expires_at ?? sub?.subscription_end_date;
      if (!expiresAt) return 'active';
      const end = new Date(expiresAt);
      if (Number.isNaN(end.getTime())) return 'active';
      const now = new Date();
      if (end > now) return 'active';
      const graceMs = SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000;
      const graceEnd = new Date(end.getTime() + graceMs);
      if (now <= graceEnd) return 'grace';
      return 'expired';
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * جلب اشتراك مساحة العمل من Supabase مع fallback للـ cache
 */
export async function getSubscription(workspaceId) {
  const wid = workspaceId || getCurrentAccountId();
  if (!wid) return null;

  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('e2e_billing_simulate_saas') === '1') {
      const cachedOnly = getSubscriptionFromCache(wid);
      if (cachedOnly) {
        return { ...cachedOnly, effectiveStatus: computeEffectiveStatus(cachedOnly) };
      }
    }
  } catch (_) {}

  if (isSupabaseEnabled()) {
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('No client');
      const { data, error } = await sb
        .from('subscriptions')
        .select('id, user_id, workspace_id, plan, status, trial_end_date, subscription_end_date, created_at')
        .eq('workspace_id', wid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const effective = computeEffectiveStatus(data);
        const out = { ...data, effectiveStatus: effective };
        setSubscriptionCache(wid, out);
        return out;
      }
    } catch (e) {
      console.warn('Subscription fetch failed, using cache', e);
    }
  }

  // Prefer IndexedDB cache when available (async), then fallback to localStorage.
  let cachedIdb = null;
  try {
    if (typeof indexedDB !== 'undefined') {
      const userId = getCurrentAccountId();
      if (workspaceId && userId) cachedIdb = await getSubscriptionCacheFromIndexedDb(workspaceId, userId);
    }
  } catch (_) {}
  const cached = cachedIdb || getSubscriptionFromCache(wid);
  if (cached) return { ...cached, effectiveStatus: computeEffectiveStatus(cached) };
  return null;
}

/**
 * التأكد من وجود اشتراك لمساحة العمل — إن لم يوجد يُنشأ trial عبر Edge Function.
 */
export async function ensureSubscriptionForWorkspace(userId, workspaceId) {
  if (!userId || !workspaceId) return null;
  const existing = await getSubscription(workspaceId);
  if (existing) return existing;
  const created = await createTrialSubscriptionViaEdge(workspaceId);
  if (created) return getSubscription(workspaceId);
  return null;
}

/** أيام متبقية في التجربة (عدد صحيح >= 0) */
export function getTrialDaysRemaining(sub) {
  if (!sub || sub.effectiveStatus !== 'trial') return 0;
  const end = (() => {
    if (sub.trial_end_date) return new Date(sub.trial_end_date);
    if (sub.created_at && TRIAL_DAYS > 0) {
      const created = new Date(sub.created_at);
      if (!Number.isNaN(created.getTime())) return new Date(created.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    }
    return null;
  })();
  if (!end || Number.isNaN(end.getTime())) return 0;
  const now = new Date();
  const diff = end - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

/** هل الاشتراك فعّال (يسمح بالكتابة)؟ يشمل فترة السماح grace */
export function isSubscriptionActive(sub) {
  if (!sub) return false;
  const status = sub?.effectiveStatus ?? computeEffectiveStatus(sub);
  if (status === 'trial' || status === 'grace') return true;
  if (status !== 'active') return false;

  const expiresAt = sub?.expires_at ?? sub?.subscription_end_date;
  if (!expiresAt) return true;
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return true;
  return end > new Date();
}

/** أيام حتى انتهاء الاشتراك المفعّل (عدد صحيح، 0 = انتهى اليوم أو انتهى) */
export function getSubscriptionEndDaysRemaining(sub) {
  if (!sub) return null;
  const eff = sub.effectiveStatus ?? computeEffectiveStatus(sub);
  if (eff !== 'active' || !sub.subscription_end_date) return null;
  const end = new Date(sub.subscription_end_date);
  const now = new Date();
  const diff = end - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

/** أيام متبقية في فترة السماح بعد انتهاء تاريخ الاشتراك (0 = آخر يوم أو انتهت) */
export function getGraceDaysRemaining(sub) {
  if (!sub) return null;
  const eff = sub.effectiveStatus ?? computeEffectiveStatus(sub);
  if (eff !== 'grace') return null;
  const expiresAt = sub?.expires_at ?? sub?.subscription_end_date;
  if (!expiresAt) return SUBSCRIPTION_GRACE_DAYS;
  const paidEnd = new Date(expiresAt);
  if (Number.isNaN(paidEnd.getTime())) return SUBSCRIPTION_GRACE_DAYS;
  const graceEnd = new Date(paidEnd.getTime() + SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const diff = graceEnd - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

/** للتوافق مع الشاشات القديمة التي تستدعي getCurrentSubscription بدون workspace */
export async function getCurrentSubscription() {
  return getSubscription(getCurrentAccountId());
}
