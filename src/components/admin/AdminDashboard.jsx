import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  BadgeCheck,
  Building2,
  CreditCard,
  FileClock,
  Search,
  Users,
  Wallet,
  AlertTriangle,
  Wrench,
  ExternalLink,
} from 'lucide-react';
import { isCurrentUserAdmin, getWorkspacesForAdmin, getUsageLogsForAdmin, logAdminAction } from '../../data/adminApi';
import { getPendingPaymentProofs, updatePaymentProofStatus, getSignedProofUrl } from '../../data/paymentProofApi';
import { activateSubscriptionViaEdge } from '../../data/subscriptionApiSecure';
import { getSubscription, getTrialDaysRemaining, computeEffectiveStatus } from '../../data/subscriptionApi';
import { getSupabase } from '../../supabase/config';
import { getCurrentAccountId } from '../../data/store';
import { getCacheUserId } from '../../data/cacheStore';
import { getDeadLetterQueueBatch, getSyncQueueBatchAll } from '../../data/indexedDbStore';
import { replayDeadLetterQueueItem } from '../../data/syncQueue';
import { useAdminMetrics } from '../../hooks/useAdminMetrics';
import { fetchLastActiveForWorkspaces } from '../../services/adminAnalyticsService';
import AppButton from '../ui/AppButton';

const PAGE_SIZE = 25;

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

function formatInt(n) {
  const x = Number(n) || 0;
  try {
    return x.toLocaleString('ar-EG');
  } catch {
    return String(x);
  }
}

function formatCurrencyEgp(n) {
  const x = Number(n) || 0;
  try {
    return `${x.toLocaleString('ar-EG')} ج.م`;
  } catch {
    return `${x} ج.م`;
  }
}

function StatusBadge({ status }) {
  const s = status || '—';
  const map = {
    active: 'bg-emerald-950/40 text-emerald-300 ring-emerald-500/35',
    grace: 'bg-amber-950/40 text-amber-300 ring-amber-500/35',
    trial: 'bg-sky-950/40 text-sky-300 ring-sky-500/35',
    expired: 'bg-rose-950/40 text-rose-300 ring-rose-500/35',
    cancelled: 'bg-white/[0.06] text-gray-400 ring-white/10',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', map[s] || map.cancelled)}>
      {s === 'active' ? 'مدفوع' : s === 'trial' ? 'تجريبي' : s === 'grace' ? 'سماح' : s === 'expired' ? 'منتهي' : String(s)}
    </span>
  );
}

function CardShell({ title, hint, right, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827] text-white shadow-lg shadow-black/30">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold text-white">{title}</h2>
          {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        </div>
        {right}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function SkeletonBlock({ className }) {
  return <div className={cn('animate-pulse rounded-xl bg-[#1f2937]/10', className)} />;
}

function Kpi({ icon: Icon, label, value, trend }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#111827] p-4 text-white shadow-lg shadow-black/25 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
            <Icon className="h-5 w-5 text-gray-400" />
          </span>
          <div>
            <div className="text-[11px] font-medium text-gray-400">{label}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-white">{value}</div>
          </div>
        </div>
        {trend && (
          <div className={cn('text-xs font-bold', trend.dir === 'up' ? 'text-emerald-400' : 'text-rose-400')}>
            {trend.dir === 'up' ? '▲' : '▼'} {trend.pct}%
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard({ onToast, onLogout }) {
  const [adminOk, setAdminOk] = useState(null);
  const metrics = useAdminMetrics({ auto: false });

  // Users table / workspaces
  const [workspaceRows, setWorkspaceRows] = useState([]);
  const [workspaceSubs, setWorkspaceSubs] = useState({});
  const [lastActiveByWorkspace, setLastActiveByWorkspace] = useState({});
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState(null);
  const [wsPage, setWsPage] = useState(0);
  const [wsHasMore, setWsHasMore] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Proofs
  const [proofs, setProofs] = useState([]);
  const [proofActionId, setProofActionId] = useState(null);
  const [activatingId, setActivatingId] = useState(null);
  const proofsRef = useRef(null);
  const [focusWorkspaceId, setFocusWorkspaceId] = useState(null);

  // Dev mode
  const [devOpen, setDevOpen] = useState(false);
  const [usageLogs, setUsageLogs] = useState([]);
  const [usagePage, setUsagePage] = useState(0);
  const [usageHasMore, setUsageHasMore] = useState(true);
  const [usageLoading, setUsageLoading] = useState(false);

  const [dlqEntries, setDlqEntries] = useState([]);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [syncQueueEntries, setSyncQueueEntries] = useState([]);
  const [syncQueueLoading, setSyncQueueLoading] = useState(false);
  const [replayingDlqId, setReplayingDlqId] = useState(null);

  const loadAdminCheck = useCallback(async () => {
    const ok = await isCurrentUserAdmin();
    setAdminOk(ok);
    return ok;
  }, []);

  const loadProofs = useCallback(async () => {
    const list = await getPendingPaymentProofs();
    setProofs(Array.isArray(list) ? list : []);
  }, []);

  const loadWorkspacesPage = useCallback(async (page = 0) => {
    setWsLoading(true);
    setWsError(null);
    try {
      const { data } = await getWorkspacesForAdmin(page, PAGE_SIZE);
      const rows = Array.isArray(data) ? data : [];
      if (page === 0) setWorkspaceRows(rows);
      else setWorkspaceRows((prev) => [...prev, ...rows]);
      setWsPage(page);
      setWsHasMore(rows.length === PAGE_SIZE);

      // Keep a local map for quick badge + days remaining.
      rows.forEach((w) => {
        const sub = w.subscription ? { ...w.subscription } : null;
        if (!sub) return;
        const eff = sub.effectiveStatus ?? computeEffectiveStatus(sub);
        setWorkspaceSubs((prev) => ({ ...prev, [w.id]: { ...sub, effectiveStatus: eff } }));
      });

      // Last active (last 7 days) for this page only (bounded IN query)
      try {
        const ids = rows.map((r) => r.id).filter(Boolean);
        const map = await fetchLastActiveForWorkspaces({ workspaceIds: ids, days: 7 });
        if (map && typeof map.forEach === 'function') {
          setLastActiveByWorkspace((prev) => {
            const next = { ...(prev || {}) };
            map.forEach((v, k) => {
              if (k) next[k] = v;
            });
            return next;
          });
        }
      } catch (_) {}
    } catch (e) {
      setWsError(e?.message || 'workspaces_failed');
    } finally {
      setWsLoading(false);
    }
  }, []);

  const refreshTop = useCallback(async () => {
    await metrics.refreshAll();
    await loadProofs();
  }, [metrics, loadProofs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await loadAdminCheck();
      if (cancelled) return;
      if (!ok) return;
      await refreshTop();
      await loadWorkspacesPage(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAdminCheck, refreshTop, loadWorkspacesPage]);

  const handleActivate = useCallback(async (workspaceId) => {
    setActivatingId(workspaceId);
    try {
      const result = await activateSubscriptionViaEdge(workspaceId);
      if (result.ok) {
        onToast?.('تم تفعيل الاشتراك');
        void logAdminAction('activate_subscription', workspaceId);
        const sub = await getSubscription(workspaceId);
        if (sub) setWorkspaceSubs((prev) => ({ ...prev, [workspaceId]: sub }));
        await metrics.refreshKpis();
      } else {
        onToast?.(result.error || 'فشل التفعيل', 'error');
      }
    } finally {
      setActivatingId(null);
    }
  }, [metrics, onToast]);

  const handleApproveProof = useCallback(async (proof) => {
    if (!proof?.id) return;
    setProofActionId(proof.id);
    try {
      const result = await activateSubscriptionViaEdge(proof.workspace_id);
      if (!result.ok) {
        onToast?.(result.error || 'فشل التفعيل', 'error');
        return;
      }
      const sb = getSupabase();
      const { data: { user } } = sb ? await sb.auth.getUser() : { data: {} };
      const statusRes = await updatePaymentProofStatus(proof.id, 'approved', {
        approvedBy: user?.id || null,
        approvedAt: new Date().toISOString(),
      });
      if (!statusRes.ok) {
        onToast?.(statusRes.error || 'فشل تحديث حالة الإثبات', 'error');
        return;
      }
      void logAdminAction('approve_payment_proof', proof.workspace_id);
      onToast?.('تمت الموافقة وتفعيل الاشتراك');
      await refreshTop();
    } finally {
      setProofActionId(null);
    }
  }, [onToast, refreshTop]);

  const handleRejectProof = useCallback(async (proof) => {
    if (!proof?.id) return;
    setProofActionId(proof.id);
    try {
      await updatePaymentProofStatus(proof.id, 'rejected');
      void logAdminAction('reject_payment_proof', proof.workspace_id);
      onToast?.('تم الرفض');
      await refreshTop();
    } finally {
      setProofActionId(null);
    }
  }, [onToast, refreshTop]);

  const filteredWorkspaces = useMemo(() => {
    const query = (q || '').trim().toLowerCase();
    const list = Array.isArray(workspaceRows) ? workspaceRows : [];
    const bySearch = query
      ? list.filter((w) => String(w.name || '').toLowerCase().includes(query) || String(w.owner_email || '').toLowerCase().includes(query) || String(w.id || '').toLowerCase().includes(query))
      : list;
    if (!statusFilter || statusFilter === 'all') return bySearch;
    return bySearch.filter((w) => {
      const sub = workspaceSubs[w.id] || w.subscription || null;
      const eff = sub?.effectiveStatus ?? (sub ? computeEffectiveStatus(sub) : 'none');
      return eff === statusFilter;
    });
  }, [workspaceRows, q, statusFilter, workspaceSubs]);

  const handleMarkPayment = useCallback((workspaceId) => {
    setFocusWorkspaceId(workspaceId);
    proofsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    onToast?.('افتح إثبات الدفع لنفس المساحة ثم وافق عليه.', 'info');
  }, [onToast]);

  const loadUsageLogs = useCallback(async (page = 0) => {
    setUsageLoading(true);
    try {
      const { data, hasMore } = await getUsageLogsForAdmin(page, 50);
      const list = Array.isArray(data) ? data : [];
      if (page === 0) setUsageLogs(list);
      else setUsageLogs((prev) => [...prev, ...list]);
      setUsagePage(page);
      setUsageHasMore(!!hasMore);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadDlq = useCallback(async () => {
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    if (!wid || !uid) return;
    setDlqLoading(true);
    try {
      const rows = await getDeadLetterQueueBatch(wid, uid, 25);
      setDlqEntries(Array.isArray(rows) ? rows : []);
    } finally {
      setDlqLoading(false);
    }
  }, []);

  const loadSyncQueue = useCallback(async () => {
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    if (!wid || !uid) return;
    setSyncQueueLoading(true);
    try {
      const rows = await getSyncQueueBatchAll(wid, uid, 25);
      setSyncQueueEntries(Array.isArray(rows) ? rows : []);
    } finally {
      setSyncQueueLoading(false);
    }
  }, []);

  const handleDlqReplay = useCallback(async (dlqItem) => {
    if (!dlqItem?.id) return;
    setReplayingDlqId(dlqItem.id);
    try {
      const ok = await replayDeadLetterQueueItem(dlqItem, {});
      if (ok) onToast?.('تمت إعادة جدولة العملية من DLQ');
      else onToast?.('فشل إعادة جدولة العملية من DLQ', 'error');
      await loadDlq();
      await loadSyncQueue();
    } finally {
      setReplayingDlqId(null);
    }
  }, [loadDlq, loadSyncQueue, onToast]);

  useEffect(() => {
    if (!devOpen) return;
    void loadUsageLogs(0);
    void loadDlq();
    void loadSyncQueue();
  }, [devOpen, loadUsageLogs, loadDlq, loadSyncQueue]);

  if (adminOk === false) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#1f2937] p-6 shadow-sm">
        <p className="text-sm text-gray-300">ليس لديك صلاحية الدخول إلى لوحة الأدمن.</p>
      </div>
    );
  }

  const k = metrics.kpis;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-8">
      <div className="sticky top-0 z-20 -mx-1 border-b border-white/10 bg-[#0B0F19]/90 px-2 py-3 backdrop-blur-xl supports-[backdrop-filter]:bg-[#0B0F19]/85">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">لوحة الإدارة</h1>
            <p className="mt-0.5 text-xs text-gray-400">متابعة الاشتراك والدفع</p>
          </div>
          <div className="flex items-center gap-2">
            <AppButton size="md" className="gap-2" onClick={() => refreshTop()}>
              <Activity className="h-4 w-4" />
              تحديث
            </AppButton>
            {onLogout && (
              <AppButton variant="ghost" className="text-gray-300" onClick={onLogout}>
                خروج
              </AppButton>
            )}
          </div>
        </div>
      </div>

      {/* KPI GRID */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.loading.kpis && !k ? (
          <>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-[#1f2937] p-5 shadow-sm">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="mt-3 h-8 w-36" />
              </div>
            ))}
          </>
        ) : (
          <>
            <Kpi icon={Wallet} label="إيراد شهري (MRR)" value={formatCurrencyEgp(k?.monthlyRevenue)} trend={metrics.trend} />
            <Kpi icon={Users} label="مستخدمون نشطون (7 أيام)" value={formatInt(k?.activeUsers7d)} />
            <Kpi icon={Building2} label="إجمالي مساحات العمل" value={formatInt(k?.totalWorkspaces)} />
            <Kpi icon={CreditCard} label="اشتراكات مدفوعة" value={formatInt(k?.paidSubscriptionsCount)} />
            <Kpi icon={FileClock} label="مستخدمون تجريبي" value={formatInt(k?.trialUsersCount)} />
            <Kpi icon={AlertTriangle} label="اشتراكات منتهية" value={formatInt(k?.expiredSubscriptionsCount)} />
            <Kpi icon={BadgeCheck} label="إثباتات دفع معلّقة" value={formatInt(k?.pendingPaymentProofsCount)} />
          </>
        )}
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-9">
          <CardShell
            title="التحليلات"
            hint="اتجاه الإيراد + دخول مستخدمين جدد (تقريبي) + قمع الاشتراك."
            right={
              metrics.loading.charts ? (
                <span className="text-xs font-semibold text-gray-400">جاري التحميل…</span>
              ) : (
                <span className="text-xs font-semibold text-gray-400">آخر 30 يوم</span>
              )
            }
          >
            {metrics.error.charts ? (
              <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
                تعذر تحميل التحليلات: {metrics.error.charts}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="h-[260px] rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 text-xs font-extrabold text-gray-300">اتجاه الإيراد (آخر 30 يوم)</div>
                  {Array.isArray(metrics.charts.revenue30d) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={metrics.charts.revenue30d}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="revenue" stroke="#0d9488" fill="#ccfbf1" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full w-full animate-pulse rounded-xl bg-[#1f2937]/10" />
                  )}
                </div>

                <div className="h-[260px] rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 text-xs font-extrabold text-gray-300">مستخدمون جدد/يوم (آخر 14 يوم)</div>
                  {Array.isArray(metrics.charts.newUsers14d) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metrics.charts.newUsers14d}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="users" name="مستخدمون" fill="#1e3a5f" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full w-full animate-pulse rounded-xl bg-[#1f2937]/10" />
                  )}
                </div>

                <div className="rounded-xl border border-white/10 bg-black/25 p-3 lg:col-span-2">
                  <div className="mb-2 text-xs font-extrabold text-gray-300">قمع الاشتراك</div>
                  {metrics.charts.funnel ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-xl bg-[#1f2937] p-3 ring-1 ring-white/10">
                        <div className="text-[11px] font-semibold text-gray-400">تجريبي</div>
                        <div className="mt-1 text-xl font-black text-white">{formatInt(metrics.charts.funnel.trial)}</div>
                      </div>
                      <div className="rounded-xl bg-[#1f2937] p-3 ring-1 ring-white/10">
                        <div className="text-[11px] font-semibold text-gray-400">سماح</div>
                        <div className="mt-1 text-xl font-black text-white">{formatInt(metrics.charts.funnel.grace)}</div>
                      </div>
                      <div className="rounded-xl bg-[#1f2937] p-3 ring-1 ring-white/10">
                        <div className="text-[11px] font-semibold text-gray-400">مدفوع</div>
                        <div className="mt-1 text-xl font-black text-white">{formatInt(metrics.charts.funnel.paid)}</div>
                      </div>
                      <div className="rounded-xl bg-[#1f2937] p-3 ring-1 ring-white/10">
                        <div className="text-[11px] font-semibold text-gray-400">منتهي</div>
                        <div className="mt-1 text-xl font-black text-white">{formatInt(metrics.charts.funnel.expired)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-20 animate-pulse rounded-xl bg-[#1f2937]/10" />
                  )}
                </div>
              </div>
            )}
          </CardShell>

          {/* USERS TABLE */}
          <CardShell
            title="العملاء ومساحات العمل"
            hint="بحث + فلترة حسب حالة الاشتراك. الإجراءات لا تغيّر الداتا إلا عبر تفعيل الاشتراك / إثبات الدفع."
            right={
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="بحث بالاسم/الإيميل/المعرف…"
                    className="w-[240px] rounded-xl bg-[#1f2937] py-2 pr-9 pl-3 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-xl bg-[#1f2937] px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-teal-300"
                >
                  <option value="all">كل الحالات</option>
                  <option value="trial">تجريبي</option>
                  <option value="active">مدفوع</option>
                  <option value="grace">سماح</option>
                  <option value="expired">منتهي</option>
                </select>
              </div>
            }
          >
            {wsError && (
              <div className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
                تعذر تحميل الجدول: {wsError}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-white/10">
              <div className="overflow-x-auto">
                <table className="min-w-[900px] w-full text-right text-sm">
                  <thead className="bg-white/[0.06]">
                    <tr className="text-xs font-extrabold text-gray-300">
                      <th className="px-4 py-3">البريد</th>
                      <th className="px-4 py-3">المساحة</th>
                      <th className="px-4 py-3">الحالة</th>
                      <th className="px-4 py-3">أيام التجربة</th>
                      <th className="px-4 py-3">آخر نشاط</th>
                      <th className="px-4 py-3">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-[#1f2937]">
                    {wsLoading && workspaceRows.length === 0 ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-4 py-4" colSpan={6}>
                            <div className="grid grid-cols-6 gap-3">
                              <SkeletonBlock className="h-5 col-span-2" />
                              <SkeletonBlock className="h-5 col-span-2" />
                              <SkeletonBlock className="h-5 col-span-2" />
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : filteredWorkspaces.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-center text-gray-400" colSpan={6}>
                          لا توجد نتائج.
                        </td>
                      </tr>
                    ) : (
                      filteredWorkspaces.map((w) => {
                        const sub = workspaceSubs[w.id] || w.subscription || null;
                        const eff = sub?.effectiveStatus ?? (sub ? computeEffectiveStatus(sub) : '—');
                        const days = sub ? getTrialDaysRemaining({ ...sub, effectiveStatus: eff }) : 0;
                        const isActivatable = eff === 'expired' || eff === 'cancelled' || eff === '—';
                        const lastActiveRaw = lastActiveByWorkspace?.[w.id] || null;
                        const lastActive = lastActiveRaw ? new Date(lastActiveRaw).toLocaleString('ar-EG') : '—';
                        return (
                          <tr key={w.id} className={cn(focusWorkspaceId === w.id ? 'bg-amber-50/40' : '')}>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-white">{w.owner_email || '—'}</div>
                              <div className="mt-1 text-xs text-gray-400">{String(w.id).slice(0, 8)}…</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-white">{w.name || 'مساحة عمل'}</div>
                              <div className="mt-1 text-xs text-gray-400">تاريخ الإنشاء: {w.created_at ? new Date(w.created_at).toLocaleDateString('ar-EG') : '—'}</div>
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={eff} />
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-bold text-white">{eff === 'trial' ? `${days} يوم` : '—'}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-300">{lastActive}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
                                  disabled={!isActivatable || activatingId === w.id}
                                  onClick={() => handleActivate(w.id)}
                                >
                                  <BadgeCheck className="h-4 w-4" />
                                  {activatingId === w.id ? 'جاري…' : 'تفعيل'}
                                </button>

                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 rounded-xl bg-[#1f2937] px-3 py-2 text-xs font-extrabold text-gray-200 ring-1 ring-white/10"
                                  onClick={() => handleMarkPayment(w.id)}
                                >
                                  <CreditCard className="h-4 w-4" />
                                  استلام دفع
                                </button>

                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 rounded-xl bg-[#1f2937] px-3 py-2 text-xs font-extrabold text-gray-200 ring-1 ring-white/10"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(String(w.id));
                                      onToast?.('تم نسخ معرف المساحة');
                                    } catch {
                                      onToast?.('تعذر النسخ', 'error');
                                    }
                                  }}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  نسخ Workspace ID
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-gray-400">
                عرض {filteredWorkspaces.length} من {workspaceRows.length} (صفحة {wsPage + 1})
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-[#1f2937] px-3 py-2 text-sm font-bold text-gray-200 ring-1 ring-white/10 disabled:opacity-50"
                  disabled={wsLoading || !wsHasMore}
                  onClick={() => loadWorkspacesPage(wsPage + 1)}
                >
                  {wsLoading ? 'جاري…' : 'تحميل المزيد'}
                </button>
              </div>
            </div>
          </CardShell>

          {/* PAYMENT PROOFS */}
          <div ref={proofsRef} />
          <CardShell
            title="إثباتات الدفع"
            hint="الموافقة تُفعّل الاشتراك ثم تُحدّث حالة الإثبات."
            right={<span className="text-xs font-semibold text-gray-400">معلّق: {formatInt(proofs.length)}</span>}
          >
            {proofs.length === 0 ? (
              <div className="rounded-xl bg-white/[0.06] p-4 text-sm text-gray-300 ring-1 ring-white/10">
                لا توجد إثباتات دفع معلّقة.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {proofs.map((p) => (
                  <div key={p.id} className={cn('rounded-xl border border-white/10 bg-[#1f2937] p-3 shadow-sm', focusWorkspaceId === p.workspace_id ? 'ring-2 ring-amber-200' : '')}>
                    <div className="rounded-xl bg-white/[0.06] p-2 ring-1 ring-white/10">
                      <PaymentProofImage path={p.image_url} />
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-gray-400">Workspace</div>
                        <div className="mt-1 font-bold text-white">{String(p.workspace_id).slice(0, 8)}…</div>
                        <div className="mt-1 text-xs text-gray-400">{p.created_at ? new Date(p.created_at).toLocaleString('ar-EG') : '—'}</div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
                          disabled={proofActionId === p.id}
                          onClick={() => handleApproveProof(p)}
                        >
                          {proofActionId === p.id ? '…' : 'موافقة + تفعيل'}
                        </button>
                        <button
                          type="button"
                          className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
                          disabled={proofActionId === p.id}
                          onClick={() => handleRejectProof(p)}
                        >
                          رفض
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        </div>

        {/* ALERT PANEL */}
        <aside className="space-y-6 lg:col-span-3">
          <CardShell
            title="تنبيهات سريعة"
            hint="أشياء تحتاج قرار/متابعة اليوم."
            right={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          >
            {metrics.loading.alerts && !metrics.alerts.trialsEndingToday ? (
              <div className="space-y-3">
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-100 bg-amber-50/90 p-3">
                  <div className="text-xs font-extrabold text-amber-800">تجارب تنتهي اليوم</div>
                  <div className="mt-1 text-2xl font-black text-amber-900">
                    {formatInt(metrics.alerts?.trialsEndingToday?.length || 0)}
                  </div>
                  <div className="mt-2 text-xs text-amber-800">
                    {Array.isArray(metrics.alerts?.trialsEndingToday) && metrics.alerts.trialsEndingToday.length > 0
                      ? `أول مساحة: ${String(metrics.alerts.trialsEndingToday[0]?.workspace_id || '').slice(0, 8)}…`
                      : 'لا يوجد.'}
                  </div>
                </div>

                <div className="rounded-xl border border-sky-100 bg-sky-50/90 p-3">
                  <div className="text-xs font-extrabold text-sky-800">إثباتات تنتظر الموافقة</div>
                  <div className="mt-1 text-2xl font-black text-sky-900">{formatInt(k?.pendingPaymentProofsCount)}</div>
                  <div className="mt-2 text-xs text-sky-800">تابعها من قسم إثباتات الدفع.</div>
                </div>
              </div>
            )}
          </CardShell>

          {/* Developer Mode */}
          <CardShell
            title="وضع المطوّر"
            hint="مخبأ لتقليل التشويش على قرارات الأعمال."
            right={
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-[#1f2937] px-3 py-2 text-xs font-extrabold text-gray-200 ring-1 ring-white/10"
                onClick={() => setDevOpen((v) => !v)}
              >
                <Wrench className="h-4 w-4" />
                {devOpen ? 'إخفاء' : 'عرض'}
              </button>
            }
          >
            {!devOpen ? (
              <div className="text-sm text-gray-300">افتحه عند الحاجة فقط.</div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl bg-white/[0.06] p-3 text-xs text-gray-300 ring-1 ring-white/10">
                  ملاحظة: هذه الأقسام تخص جهاز الأدمن الحالي (IndexedDB) وليست رؤية على كل المستخدمين.
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-extrabold text-gray-200">Usage Logs</div>
                    <button
                      type="button"
                      className="rounded-lg bg-[#1f2937] px-2 py-1 text-xs font-bold text-gray-300 ring-1 ring-white/10"
                      onClick={() => loadUsageLogs(0)}
                    >
                      تحديث
                    </button>
                  </div>
                  <div className="max-h-56 overflow-auto rounded-xl bg-[#1f2937] ring-1 ring-white/10">
                    {usageLoading && usageLogs.length === 0 ? (
                      <div className="p-3"><SkeletonBlock className="h-10 w-full" /></div>
                    ) : usageLogs.length === 0 ? (
                      <div className="p-3 text-sm text-gray-300">لا يوجد.</div>
                    ) : (
                      <ul className="divide-y divide-white/10">
                        {usageLogs.slice(0, 30).map((x) => (
                          <li key={x.id} className="p-3 text-xs">
                            <div className="font-semibold text-white">{x.event_type}</div>
                            <div className="mt-1 text-gray-400">
                              {x.created_at ? new Date(x.created_at).toLocaleString('ar-EG') : '—'} • {x.workspace_id ? String(x.workspace_id).slice(0, 8) + '…' : '—'}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {usageHasMore && (
                    <button
                      type="button"
                      className="w-full rounded-xl bg-[#1f2937] px-3 py-2 text-xs font-extrabold text-gray-200 ring-1 ring-white/10"
                      onClick={() => loadUsageLogs(usagePage + 1)}
                    >
                      المزيد
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-extrabold text-gray-200">Sync Queue</div>
                    <button
                      type="button"
                      className="rounded-lg bg-[#1f2937] px-2 py-1 text-xs font-bold text-gray-300 ring-1 ring-white/10"
                      onClick={() => loadSyncQueue()}
                    >
                      تحديث
                    </button>
                  </div>
                  <div className="max-h-44 overflow-auto rounded-xl bg-[#1f2937] ring-1 ring-white/10">
                    {syncQueueLoading && syncQueueEntries.length === 0 ? (
                      <div className="p-3"><SkeletonBlock className="h-10 w-full" /></div>
                    ) : syncQueueEntries.length === 0 ? (
                      <div className="p-3 text-sm text-gray-300">لا يوجد.</div>
                    ) : (
                      <ul className="divide-y divide-white/10">
                        {syncQueueEntries.map((x) => (
                          <li key={x.id} className="p-3 text-xs">
                            <div className="font-semibold text-white">{x.type || '—'}</div>
                            <div className="mt-1 text-gray-400">
                              {x.createdAt ? new Date(x.createdAt).toLocaleString('ar-EG') : '—'} • محاولات: {x.retryCount ?? 0}/{x.maxRetry ?? '—'}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-extrabold text-gray-200">Dead Letter Queue</div>
                    <button
                      type="button"
                      className="rounded-lg bg-[#1f2937] px-2 py-1 text-xs font-bold text-gray-300 ring-1 ring-white/10"
                      onClick={() => loadDlq()}
                    >
                      تحديث
                    </button>
                  </div>
                  <div className="max-h-56 overflow-auto rounded-xl bg-[#1f2937] ring-1 ring-white/10">
                    {dlqLoading && dlqEntries.length === 0 ? (
                      <div className="p-3"><SkeletonBlock className="h-10 w-full" /></div>
                    ) : dlqEntries.length === 0 ? (
                      <div className="p-3 text-sm text-gray-300">لا يوجد.</div>
                    ) : (
                      <ul className="divide-y divide-white/10">
                        {dlqEntries.map((x) => (
                          <li key={x.id} className="p-3 text-xs">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-semibold text-white">{x.type || '—'}</div>
                                <div className="mt-1 text-gray-400">{x.deadLetterReason || '—'}</div>
                              </div>
                              <button
                                type="button"
                                className="rounded-lg bg-[#1f2937] px-2 py-1 text-xs font-extrabold text-gray-200 ring-1 ring-white/10 disabled:opacity-50"
                                disabled={replayingDlqId === x.id}
                                onClick={() => handleDlqReplay(x)}
                              >
                                {replayingDlqId === x.id ? '…' : 'إعادة'}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardShell>
        </aside>
      </div>
    </div>
  );
}

function PaymentProofImage({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let mounted = true;
    if (!path) return undefined;
    getSignedProofUrl(path)
      .then((u) => {
        if (mounted) setUrl(u);
      })
      .catch(() => setErr(true));
    return () => {
      mounted = false;
    };
  }, [path]);
  if (err || !url) return <div className="flex h-40 items-center justify-center rounded-xl bg-[#1f2937]/10 text-xs text-gray-400">لا تتوفر الصورة</div>;
  return <img src={url} alt="إثبات دفع" className="h-40 w-full rounded-xl object-contain" />;
}
