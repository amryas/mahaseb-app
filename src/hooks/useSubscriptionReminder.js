import { useMemo } from 'react';
import { useSubscription } from './useSubscription';
import {
  getTrialDaysRemaining,
  getSubscriptionEndDaysRemaining,
  getGraceDaysRemaining,
  computeEffectiveStatus,
} from '../data/subscriptionApi';

const EXPIRED_POPUP_KEY = 'subscription_expired_popup_shown';

/**
 * Reminder state مشتق من useSubscription — حساب واحد، آمن أوفلاين (الـ subscription من cache عند الفشل).
 */
export function useSubscriptionReminder(workspaceId) {
  const { subscription, loading } = useSubscription(workspaceId);
  return useMemo(() => {
    if (loading || !subscription) {
      return {
        showTrialWarning: false,
        showExpiredPopup: false,
        showRenewWarning: false,
        showGraceWarning: false,
        graceDaysRemaining: null,
        daysRemaining: 0,
        endDaysRemaining: null,
      };
    }
    let status;
    try {
      status =
        typeof subscription === 'object' && subscription !== null && !Array.isArray(subscription)
          ? subscription.effectiveStatus ?? computeEffectiveStatus(subscription)
          : null;
    } catch {
      status = null;
    }
    const isTrial = status === 'trial';
    const isExpired = status === 'expired';
    const isActive = status === 'active';
    const isGrace = status === 'grace';
    const graceDaysRemaining = isGrace ? getGraceDaysRemaining(subscription) : null;
    const daysRemaining = isTrial ? getTrialDaysRemaining(subscription) : 0;
    const endDaysRemaining = isActive ? getSubscriptionEndDaysRemaining(subscription) : null;

    let showExpiredPopup = false;
    if (isExpired) {
      try {
        showExpiredPopup = !localStorage.getItem(EXPIRED_POPUP_KEY);
      } catch {
        showExpiredPopup = true;
      }
    }

    return {
      showTrialWarning: isTrial && daysRemaining <= 1,
      showExpiredPopup,
      showRenewWarning: isActive && endDaysRemaining != null && endDaysRemaining <= 3,
      showGraceWarning: isGrace,
      graceDaysRemaining,
      daysRemaining,
      endDaysRemaining: endDaysRemaining ?? null,
    };
  }, [subscription, loading]);
}

export function setExpiredPopupShown() {
  try {
    localStorage.setItem(EXPIRED_POPUP_KEY, '1');
  } catch (_) {}
}
