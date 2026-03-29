import { useEffect, useMemo, useState } from 'react';
import { useSubscription } from './useSubscription';
import { TRIAL_DAYS } from '../data/subscriptionApi';

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function computeTrialEnd(subscription) {
  if (!subscription) return null;
  if (subscription.trial_end_date) {
    const d = new Date(subscription.trial_end_date);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (subscription.created_at && TRIAL_DAYS > 0) {
    const c = new Date(subscription.created_at);
    if (!Number.isNaN(c.getTime())) return new Date(c.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  }
  return null;
}

export function useTrialCountdown() {
  const { subscription, loading, isTrial, isExpired, daysRemaining } = useSubscription();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isTrial) return undefined;
    const t = setInterval(() => setNow(Date.now()), 60_000); // update every minute
    return () => clearInterval(t);
  }, [isTrial]);

  const end = useMemo(() => computeTrialEnd(subscription), [subscription]);
  const diffMs = end ? end.getTime() - now : 0;
  const hoursRemaining = diffMs > 0 ? Math.floor(diffMs / (60 * 60 * 1000)) : 0;
  const totalMs = TRIAL_DAYS > 0 ? TRIAL_DAYS * 24 * 60 * 60 * 1000 : 0;
  const progressPct = totalMs > 0 && end
    ? clamp(((totalMs - diffMs) / totalMs) * 100, 0, 100)
    : 0;

  const warning = isTrial && daysRemaining <= 2;

  return {
    loading,
    isTrial,
    isExpired,
    subscription,
    daysRemaining,
    hoursRemaining,
    progressPct,
    warning,
  };
}

