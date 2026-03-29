import { useState, useEffect, useCallback } from 'react';
import { getCurrentAccountId } from '../data/store';
import {
  getCurrentUsage,
  getUsageLimitsForPlan,
  checkUsageLimit,
  getBillingPlanForUsage,
  LIMIT_REACHED_MESSAGE,
} from '../data/usageLimitsApi';
import { getSubscription } from '../data/subscriptionApi';
import { isSupabaseEnabled } from '../supabase/config';

/**
 * Hook لحدود الاستخدام للـ workspace الحالي.
 * يرجع: limits, usage, canAddInvoice, canAddProduct, canExportReport, limitReachedMessage, refresh.
 */
export function useUsageLimits(workspaceId) {
  const wid = workspaceId || getCurrentAccountId();
  const [limits, setLimits] = useState(null);
  const [usage, setUsage] = useState({ invoicesCount: 0, productsCount: 0, reportsExportCount: 0 });
  const [loading, setLoading] = useState(!!wid);

  const refresh = useCallback(async () => {
    if (typeof window !== 'undefined' && localStorage.getItem('e2e_skip_auth') === '1') {
      setLimits({ max_invoices: 999999, max_products: 999999, max_reports: 999999 });
      setUsage({ invoicesCount: 0, productsCount: 0, reportsExportCount: 0 });
      setLoading(false);
      return;
    }
    if (!wid || !isSupabaseEnabled()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const sub = await getSubscription(wid);
      const plan = getBillingPlanForUsage(sub);
      const [lim, use] = await Promise.all([getUsageLimitsForPlan(plan), getCurrentUsage(wid)]);
      setLimits(lim);
      setUsage(use);
    } catch (_) {
      setLimits({ max_invoices: 999999, max_products: 999999, max_reports: 999999 });
      setUsage({ invoicesCount: 0, productsCount: 0, reportsExportCount: 0 });
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const canAddInvoice = limits != null && usage.invoicesCount < (limits.max_invoices ?? 20);
  const canAddProduct = limits != null && usage.productsCount < (limits.max_products ?? 10);
  const canExportReport = limits != null && usage.reportsExportCount < (limits.max_reports ?? 1);

  const limitReachedMessage = LIMIT_REACHED_MESSAGE;

  return {
    limits,
    usage,
    loading,
    refresh,
    canAddInvoice,
    canAddProduct,
    canExportReport,
    limitReachedMessage,
    checkLimit: (type) => checkUsageLimit(wid, type),
  };
}
