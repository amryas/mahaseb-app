/**
 * API لوحة الأدمن — يُستدعى فقط بعد التحقق من أن المستخدم في admin_users.
 */

import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { computeEffectiveStatus } from './subscriptionApi';

/** هل المستخدم الحالي أدمن؟ (بريده في admin_users) */
export async function isCurrentUserAdmin() {
  if (!isSupabaseEnabled()) return false;
  const sb = getSupabase();
  if (!sb) return false;
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return false;
  const { data, error } = await sb
    .from('admin_users')
    .select('id')
    .eq('email', user.email)
    .maybeSingle();
  return !error && !!data;
}

/** عدد المستخدمين النشطين اليوم (دخول في آخر 24 ساعة من usage_events) */
export async function getActiveUsersTodayCount() {
  if (!isSupabaseEnabled()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const { data, error } = await sb
    .from('usage_events')
    .select('user_id')
    .eq('event_type', 'login')
    .gte('created_at', since.toISOString());
  if (error) return 0;
  const unique = new Set((data || []).map((r) => r.user_id));
  return unique.size;
}

/** إجمالي عدد المستخدمين (من workspace_members أو auth - نستخدم أعضاء المساحات) */
export async function getTotalUsersCount() {
  if (!isSupabaseEnabled()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data, error } = await sb.from('workspace_members').select('user_id');
  if (error) return 0;
  const unique = new Set((data || []).map((r) => r.user_id));
  return unique.size;
}

const EMPTY_METRICS = {
  activePaid: 0,
  inGrace: 0,
  activeTrials: 0,
  effectiveActiveSubscriptions: 0,
  monthlyRevenueEstimate: 0,
};

/**
 * مقاييس اشتراك موحّدة (effectiveStatus — تجارب منتهية لا تُحسب نشطة).
 */
export async function getSubscriptionMetrics() {
  if (!isSupabaseEnabled()) return { ...EMPTY_METRICS };
  const sb = getSupabase();
  if (!sb) return { ...EMPTY_METRICS };
  const { data: rows, error } = await sb
    .from('subscriptions')
    .select('status, trial_end_date, subscription_end_date, plan');
  if (error || !rows?.length) return { ...EMPTY_METRICS };

  let activePaid = 0;
  let inGrace = 0;
  let activeTrials = 0;
  for (const r of rows) {
    const eff = computeEffectiveStatus(r);
    if (eff === 'trial') activeTrials += 1;
    else if (eff === 'grace') inGrace += 1;
    else if (eff === 'active') activePaid += 1;
  }
  const effectiveActiveSubscriptions = activePaid + inGrace + activeTrials;
  const monthlyRevenueEstimate = (activePaid + inGrace) * 150;
  return {
    activePaid,
    inGrace,
    activeTrials,
    effectiveActiveSubscriptions,
    monthlyRevenueEstimate,
  };
}

/** عدد الاشتراكات «القابلة للاستخدام» (active / grace / trial غير منتهٍ) */
export async function getActiveSubscriptionsCount() {
  const m = await getSubscriptionMetrics();
  return m.effectiveActiveSubscriptions;
}

/** عدد التجارب الفعّالة فقط */
export async function getTrialUsersCount() {
  const m = await getSubscriptionMetrics();
  return m.activeTrials;
}

/** إيرادات شهرية تقديرية (مدفوع + سماح) × 150 */
export async function getMonthlyRevenue() {
  const m = await getSubscriptionMetrics();
  return m.monthlyRevenueEstimate;
}

/** عدد إثباتات الدفع المعلقة */
export async function getPendingPaymentProofsCount() {
  if (!isSupabaseEnabled()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { count, error } = await sb
    .from('payment_proofs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  return error ? 0 : (count ?? 0);
}

/** قائمة المساحات (للأدمن) مع بريد المالك وتفاصيل اشتراك */
export async function getWorkspacesForAdmin(page = 0, pageSize = 20) {
  if (!isSupabaseEnabled()) return { data: [], total: 0 };
  const sb = getSupabase();
  if (!sb) return { data: [], total: 0 };
  const offset = page * pageSize;
  let list = [];
  const { data: rpcData, error } = await sb.rpc('get_workspaces_with_owner_emails', {
    _limit: pageSize,
    _offset: offset,
  });
  if (!error && rpcData?.length) {
    list = rpcData;
  } else {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data: workspaces, error: e2 } = await sb
      .from('workspaces')
      .select('id, name, owner_id, created_at')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (e2) return { data: [], total: 0 };
    list = (workspaces || []).map((w) => ({ ...w, owner_email: null }));
  }
  const withSub = await Promise.all(
    list.map(async (w) => {
      const { data: sub } = await sb
        .from('subscriptions')
        .select('status, trial_end_date, subscription_end_date')
        .eq('workspace_id', w.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { ...w, subscription: sub };
    })
  );
  const { count } = await sb.from('workspaces').select('*', { count: 'exact', head: true });
  return { data: withSub, total: count ?? 0 };
}

/** سجل usage_logs (أو usage_events) للأدمن — صفحة */
export async function getUsageLogsForAdmin(page = 0, pageSize = 50) {
  if (!isSupabaseEnabled()) return { data: [], hasMore: false };
  const sb = getSupabase();
  if (!sb) return { data: [], hasMore: false };
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, error } = await sb
    .from('usage_logs')
    .select('id, workspace_id, event_type, metadata, created_at')
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: [], hasMore: false };
  const list = data || [];
  return { data: list, hasMore: list.length === pageSize };
}

/** إثباتات الدفع المعلقة مع تفاصيل */
export async function getPendingProofsForAdmin() {
  const { getPendingPaymentProofs } = await import('./paymentProofApi.js');
  return getPendingPaymentProofs();
}

/** تسجيل فعل أدمن في admin_logs */
export async function logAdminAction(action, targetWorkspace = null) {
  if (!isSupabaseEnabled()) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  await sb.from('admin_logs').insert({
    admin_id: user?.id || null,
    action,
    target_workspace: targetWorkspace,
  });
}
