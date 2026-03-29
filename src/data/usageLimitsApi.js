/**
 * Usage limits API — حدود الاستخدام حسب الخطة (trial / monthly_150 / pro).
 * يُستخدم مع useUsageLimits وحراسة واجهات المنتجات، الفواتير، وتصدير التقارير.
 */

import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { getSubscription, computeEffectiveStatus } from './subscriptionApi';
import { BILLING_ERROR_CODES, BillingGuardError } from './billingErrors';
import {
  apiGetAllInvoices,
  apiGetAllProducts,
} from './workspaceApi';

// Trial: 3 أيام تجربة بدون حدود عملياً على المخزون/الفواتير/تصدير التقارير (المنع الحقيقي يكون بانتهاء trial_end_date).
// نستخدم رقم كبير بدل Infinity لأن الحدود تُخزَّن/تُرسل كأرقام عادية.
const DEFAULT_TRIAL = { max_invoices: 999999, max_products: 999999, max_reports: 999999 };

/** خطة الفوترة لحدود الاستخدام (تجريبي مقابل مدفوع/سماح) */
export function getBillingPlanForUsage(sub) {
  if (!sub) return 'trial';
  const eff = sub.effectiveStatus ?? computeEffectiveStatus(sub);
  if (eff === 'active' || eff === 'grace') return sub?.plan || 'monthly_150';
  return 'trial';
}

/**
 * يمنع المتابعة إذا وصل الاستخدام للحد (طبقة كتابة).
 * @param {string} workspaceId
 * @param {'invoice'|'product'|'report'} type
 */
export async function assertUsageLimitAllows(workspaceId, type) {
  if (typeof window !== 'undefined' && localStorage.getItem('e2e_skip_auth') === '1') return;
  const r = await checkUsageLimit(workspaceId, type);
  if (!r.allowed) {
    throw new BillingGuardError(BILLING_ERROR_CODES.PLAN_LIMIT_REACHED, type);
  }
}

/** جلب حدود الخطة من جدول usage_limits */
export async function getUsageLimitsForPlan(plan) {
  if (!plan) return DEFAULT_TRIAL;
  if (!isSupabaseEnabled()) return DEFAULT_TRIAL;
  const sb = getSupabase();
  if (!sb) return DEFAULT_TRIAL;
  const { data, error } = await sb
    .from('usage_limits')
    .select('max_invoices, max_products, max_reports')
    .eq('plan', plan === 'trial' ? 'trial' : plan === 'monthly_150' ? 'monthly_150' : 'pro')
    .maybeSingle();
  if (error || !data) return plan === 'trial' ? DEFAULT_TRIAL : { max_invoices: 500, max_products: 200, max_reports: 30 };
  return {
    max_invoices: data.max_invoices ?? 20,
    max_products: data.max_products ?? 10,
    max_reports: data.max_reports ?? 1,
  };
}

/** عدد الفواتير الحالية في المساحة */
export async function getInvoicesCount(workspaceId) {
  if (!workspaceId || !isSupabaseEnabled()) return 0;
  const res = await apiGetAllInvoices(workspaceId);
  return Array.isArray(res) ? res.length : 0;
}

/** عدد المنتجات الحالية في المساحة */
export async function getProductsCount(workspaceId) {
  if (!workspaceId || !isSupabaseEnabled()) return 0;
  const res = await apiGetAllProducts(workspaceId);
  return Array.isArray(res) ? res.length : 0;
}

/** عدد مرات تصدير التقرير (من usage_events حيث event_type = export_report) */
export async function getReportsExportCount(workspaceId) {
  if (!workspaceId || !isSupabaseEnabled()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { count, error } = await sb
    .from('usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('event_type', 'export_report');
  if (error) return 0;
  return count ?? 0;
}

/** جلب الاستخدام الحالي لمساحة عمل */
export async function getCurrentUsage(workspaceId) {
  if (!workspaceId) return { invoicesCount: 0, productsCount: 0, reportsExportCount: 0 };
  const [invoicesCount, productsCount, reportsExportCount] = await Promise.all([
    getInvoicesCount(workspaceId),
    getProductsCount(workspaceId),
    getReportsExportCount(workspaceId),
  ]);
  return { invoicesCount, productsCount, reportsExportCount };
}

/**
 * هل يمكن إضافة فاتورة/منتج/تصدير تقرير؟
 * يرجع { allowed, limit, current, plan }.
 */
export async function checkUsageLimit(workspaceId, type) {
  if (typeof window !== 'undefined' && localStorage.getItem('e2e_skip_auth') === '1') {
    return { allowed: true, limit: Infinity, current: 0, plan: 'e2e' };
  }
  const sub = await getSubscription(workspaceId);
  const plan = getBillingPlanForUsage(sub);
  const limits = await getUsageLimitsForPlan(plan);
  const usage = await getCurrentUsage(workspaceId);

  let max = 0;
  let current = 0;
  if (type === 'invoice') {
    max = limits.max_invoices;
    current = usage.invoicesCount;
  } else if (type === 'product') {
    max = limits.max_products;
    current = usage.productsCount;
  } else if (type === 'report') {
    max = limits.max_reports;
    current = usage.reportsExportCount;
  }

  return {
    allowed: current < max,
    limit: max,
    current,
    plan,
  };
}

/** رسالة ودية عند الوصول للحد (عربي) */
export const LIMIT_REACHED_MESSAGE = 'لقد وصلت للحد الأقصى في الفترة التجريبية — اشترك الآن للاستمرار';
