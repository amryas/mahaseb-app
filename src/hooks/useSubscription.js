import { useState, useEffect, useCallback, useMemo } from 'react';
import { getCurrentAccountId } from '../data/store';
import { isWorkspaceSaaSEnabled } from '../data/workspaceApi';
import {
  getSubscription,
  getTrialDaysRemaining,
  isSubscriptionActive,
  getSubscriptionFromCache,
  computeEffectiveStatus,
} from '../data/subscriptionApi';

/**
 * Hook حالة الاشتراك للـ workspace الحالي (أو المُمرّر).
 * يعمل مع الـ cache للعمل دون اتصال.
 */
export function useSubscription(workspaceId) {
  const wid = workspaceId || getCurrentAccountId();
  const [subscription, setSubscription] = useState(() => getSubscriptionFromCache(wid));
  const [loading, setLoading] = useState(!!wid);

  const refresh = useCallback(async () => {
    if (!wid) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const sub = await getSubscription(wid);
      setSubscription(sub);
    } catch (_) {
      setSubscription(getSubscriptionFromCache(wid));
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // الكاش المحلي قد لا يحتوي effectiveStatus — نحسبها بأمان (بيانات تالفة لا تسقط التطبيق)
  const status = (() => {
    if (subscription == null) return null;
    try {
      if (typeof subscription === 'object' && subscription !== null && !Array.isArray(subscription)) {
        return subscription.effectiveStatus ?? computeEffectiveStatus(subscription);
      }
    } catch (_) {}
    return null;
  })();
  const isTrial = status === 'trial';
  const isActive = status === 'active';
  const isGrace = status === 'grace';
  const isExpired = status === 'expired';
  const daysRemaining = getTrialDaysRemaining(subscription);

  const canWrite = useMemo(() => {
    const saas = isWorkspaceSaaSEnabled();
    if (!saas) return true;
    // اشتراك غير محمّل بعد أو غير موجود في الكاش: نعرض نماذج الإضافة/التعديل.
    // منع الكتابة الفعلي يبقى في خدمات الكتابة + الطابور (ensureSubscriptionAllowsWriteCentral).
    if (subscription == null) return true;
    if (isSubscriptionActive(subscription)) return true;
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return offline;
  }, [subscription]);

  return {
    subscription,
    loading,
    refresh,
    isTrial,
    isActive,
    isGrace,
    isExpired,
    daysRemaining,
    canWrite,
  };
}
