import { useMemo, useEffect, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  formatCurrency,
  formatDate,
  getSettings,
  getDebts,
  getNotifications,
  addNotification,
  getSaleTotal,
  getSaleProfit,
  getSaleSummary,
  getProducts,
  getSales,
} from '../data/store';
import { getCurrentAccountId } from '../data/store';
import SmartInsights from './SmartInsights';
import { useDashboardAggregates } from '../hooks/useDashboardAggregates';
import { getDailyProfitTrend } from '../data/aggregatesService';
import { PackagePlus, ShoppingCart, ReceiptText, BarChart3, RefreshCw, MessageCircle } from 'lucide-react';
import Card, { CardHeader } from './ui/Card';
import { maybeSendDailyWhatsAppReport } from '../hooks/useWhatsAppReportSettings';
import AppButton from './ui/AppButton';
import { StatCard, ActionButton, SectionCard } from './layout';
import { StarterChecklist, StarterWelcomeHero, SmartUpgradeNudge, MotivationMessages } from './engagement';
import { useSubscription } from '../hooks/useSubscription';
import { isWorkspaceSaaSEnabled } from '../data/workspaceApi';

export default function Dashboard({
  transactions: _transactions,
  invoices,
  onGoToSales,
  onGoToExpense,
  onGoToProducts,
  onGoToReports = () => {},
  onGoToPricing = () => {},
  hideEngagementChrome = false,
  onToast,
  bannerImage,
}) {
  const settings = getSettings();
  const salesTarget = Number(settings.salesTargetMonthly) || 0;
  const { readModel, loading, error, refresh } = useDashboardAggregates();
  const { isTrial, isGrace, isActive, loading: subLoading } = useSubscription();
  const [trendDays, setTrendDays] = useState(7);
  const [profitTrend, setProfitTrend] = useState(null);
  const [profitTrendLoading, setProfitTrendLoading] = useState(false);
  const [profitTrendError, setProfitTrendError] = useState(null);
  const [guideStep, setGuideStep] = useState(-1);
  const [sendingNow, setSendingNow] = useState(false);
  const [showSixMonth, setShowSixMonth] = useState(false);
  const [showCharts, setShowCharts] = useState(true);
  const [guideEnabled, setGuideEnabled] = useState(false);
  const workspaceId = getCurrentAccountId();

  useEffect(() => {
    try {
      if (!workspaceId) return;
      const wide = typeof window !== 'undefined' ? window.innerWidth >= 1024 : false;
      setGuideEnabled(wide);
      if (!wide) {
        setGuideStep(-1);
        return;
      }
      const key = `mahaseb_dashboard_guide_seen_${workspaceId}`;
      const seen = localStorage.getItem(key) === '1';
      if (!seen) setGuideStep(0);
    } catch (_) {}
  }, [workspaceId]);

  const closeGuide = useCallback(() => {
    try {
      if (workspaceId) localStorage.setItem(`mahaseb_dashboard_guide_seen_${workspaceId}`, '1');
    } catch (_) {}
    setGuideStep(-1);
  }, [workspaceId]);

  const loadProfitTrend = useCallback(async (days) => {
    setProfitTrendLoading(true);
    setProfitTrendError(null);
    try {
      const rows = await getDailyProfitTrend(days, { pageSize: 120, maxPages: 200 });
      setProfitTrend(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setProfitTrendError(e?.message || 'profit_trend_failed');
      setProfitTrend(null);
    } finally {
      setProfitTrendLoading(false);
    }
  }, []);

  const dueInvoices = useMemo(() => {
    const todayD = new Date();
    todayD.setHours(0, 0, 0, 0);
    const in3Days = new Date(todayD);
    in3Days.setDate(in3Days.getDate() + 3);
    return invoices.filter((i) => {
      if (i.paid) return false;
      const d = new Date(i.dueDate);
      d.setHours(0, 0, 0, 0);
      return d.getTime() <= in3Days.getTime();
    });
  }, [invoices]);

  const debts = getDebts();
  const totalReceivablesFromDebts = debts.filter((d) => !d.paid).reduce((s, x) => s + x.amount, 0);

  const s = readModel?.sales;
  const tx = readModel?.tx;
  const last6Months = readModel?.last6Months ?? [];
  const lowStockProducts = readModel?.lowStockProducts ?? [];
  const recentSales = s?.recentSales ?? [];
  const recentTransactions = tx?.recentTransactions ?? [];
  const todaySales = s?.todaySales ?? 0;
  const todaySalesCount = s?.todaySalesCount ?? 0;
  const monthSalesCount = s?.monthSalesCount ?? 0;
  const monthSales = s?.monthSales ?? 0;
  const todayProfitFromSales = s?.todayProfitFromSales ?? 0;
  const monthProfitFromSales = s?.monthProfitFromSales ?? 0;
  const unpaidSalesReceivables = s?.unpaidSalesReceivables ?? 0;
  const totalReceivables = unpaidSalesReceivables + totalReceivablesFromDebts;

  const monthProfitCombined = monthProfitFromSales + (tx?.monthIncome ?? 0) - (tx?.monthExpense ?? 0);

  const hasProduct = getProducts().length > 0;
  const hasSale = getSales().length > 0;
  const hasExpense = useMemo(() => _transactions.some((t) => t.type === 'expense'), [_transactions]);
  const isWorkspaceEmpty = !hasProduct && !hasSale && !hasExpense;
  const showSmartPaywall =
    isWorkspaceSaaSEnabled() && !subLoading && (isTrial || isGrace) && !isActive;

  useEffect(() => {
    if (!readModel || !settings.notificationsEnabled) return;
    const today = new Date().toISOString().slice(0, 10);
    const notifs = getNotifications();
    if (lowStockProducts.length > 0) {
      const hasLowStockToday = notifs.some((n) => n.notificationType === 'low_stock' && n.createdAt && n.createdAt.startsWith(today));
      if (!hasLowStockToday) {
        addNotification({
          type: 'warning',
          title: 'تنبيه نقص مخزون',
          message: `لديك ${lowStockProducts.length} منتج تحت حد التنبيه. راجع المخزون لتجديد الكميات.`,
          link: 'products',
          linkLabel: 'فتح المخزون',
          notificationType: 'low_stock',
        });
      }
    }
    if (totalReceivables > 0) {
      const hasUnpaidToday = notifs.some((n) => n.notificationType === 'unpaid_sales' && n.createdAt && n.createdAt.startsWith(today));
      if (!hasUnpaidToday) {
        addNotification({
          type: 'info',
          title: 'مستحقات',
          message: `مبيعات وديون بانتظار الاستلام: ${formatCurrency(totalReceivables)}. راجع المبيعات أو الديون.`,
          link: 'sales',
          linkLabel: 'فتح المبيعات',
          notificationType: 'unpaid_sales',
        });
      }
    }
  }, [readModel, settings.notificationsEnabled, lowStockProducts.length, totalReceivables]);

  const showBody = !!readModel && !loading;

  useEffect(() => {
    if (!showBody) return;
    void loadProfitTrend(trendDays === 30 ? 30 : 7);
  }, [showBody, trendDays, loadProfitTrend]);

  const netProfitTrendLabel =
    monthProfitCombined > 0 ? '↑ صافي إيجابي (الشهر)' : monthProfitCombined < 0 ? '↓ صافي سالب (الشهر)' : null;

  /** عرض فقط — يُشتق من profitTrend والبيانات المعروضة أصلاً على اللوحة */
  const insightMessages = useMemo(() => {
    const items = [];
    const rows = profitTrend;
    if (Array.isArray(rows) && rows.length >= 2) {
      const last = Number(rows[rows.length - 1]?.sales) || 0;
      const prev = Number(rows[rows.length - 2]?.sales) || 0;
      if (prev > 0) {
        const pct = Math.round(((last - prev) / prev) * 100);
        if (pct > 0) items.push({ key: 'sales_up', text: `🔥 مبيعاتك زادت ${pct}% عن اليوم السابق في الرسم` });
        else if (pct < 0) items.push({ key: 'sales_down', text: `📉 مبيعات آخر يوم أقل بنسبة ${Math.abs(pct)}% عن اليوم الذي قبله` });
      } else if (prev === 0 && last > 0) {
        items.push({ key: 'sales_kick', text: '🔥 نشاط مبيعات ظهر في آخر يومين على الرسم' });
      }
    }
    if (lowStockProducts.length > 0) {
      items.push({ key: 'stock', text: `⚠️ ${lowStockProducts.length} منتج قارب على النفاد` });
    }
    if (dueInvoices.length > 0) {
      items.push({ key: 'due', text: `📅 ${dueInvoices.length} فاتورة مستحقة خلال أيام` });
    }
    if (totalReceivables > 0) {
      items.push({ key: 'recv', text: `💰 مستحقات ${formatCurrency(totalReceivables)} بانتظار التحصيل` });
    }
    if (items.length === 0 && monthProfitCombined > 0) {
      items.push({ key: 'profit_ok', text: '✨ صافي شهرك إيجابي — أداء جيد حتى الآن' });
    }
    return items.slice(0, 5);
  }, [profitTrend, lowStockProducts.length, dueInvoices.length, totalReceivables, monthProfitCombined]);

  const chartHasNoSales =
    !profitTrendLoading &&
    Array.isArray(profitTrend) &&
    (profitTrend.length === 0 || profitTrend.every((r) => !(Number(r.sales) > 0)));

  if (loading && !readModel) {
    return (
      <div className="flex min-w-0 flex-col gap-8 pb-2">
        {bannerImage && (
          <div className="overflow-hidden rounded-2xl border border-white/10 shadow-sm">
            <img src={bannerImage} alt="" className="max-h-32 w-full object-cover" />
          </div>
        )}
        <div className="space-y-3">
          <div className="admin-skeleton h-8 w-48 rounded-lg" />
          <div className="admin-skeleton h-40 w-full rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="admin-skeleton h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-8">
            <div className="admin-skeleton h-72 rounded-xl" />
            <div className="admin-skeleton h-72 rounded-xl" />
          </div>
          <div className="flex flex-col gap-6 lg:col-span-4">
            <div className="admin-skeleton h-40 rounded-xl" />
            <div className="admin-skeleton h-40 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !readModel) {
    return (
      <div className="flex min-w-0 flex-col gap-8 pb-4">
        <h1 className="text-2xl font-bold text-white">لوحة التحكم</h1>
        <SectionCard title="حدث خطأ مؤقت" subtitle="البيانات لم تُحمَّل — يمكنك المحاولة فوراً">
          <p className="text-sm leading-relaxed text-gray-300">{error}</p>
          <AppButton
            variant="primary"
            size="md"
            className="mt-6 bg-saas-primary shadow-md transition-all duration-200 hover:scale-105 active:scale-95 motion-reduce:hover:scale-100"
            onClick={() => void refresh()}
          >
            إعادة المحاولة
          </AppButton>
        </SectionCard>
      </div>
    );
  }

  const chartToolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2 transition-all duration-200">
      <button
        type="button"
        className="rounded-xl border border-white/10 bg-[#1f2937] px-3 py-2 text-xs font-semibold text-gray-200 shadow-sm transition-all duration-200 hover:scale-105 hover:bg-white/10 active:scale-95 motion-reduce:hover:scale-100"
        onClick={() => setShowCharts((v) => !v)}
      >
        {showCharts ? 'إخفاء الرسوم' : 'عرض الرسوم'}
      </button>
      {showCharts && (
        <>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 hover:scale-105 active:scale-95 motion-reduce:hover:scale-100 ${
              trendDays === 7 ? 'bg-saas-primary text-saas-shell shadow-md' : 'border border-white/10 bg-[#1f2937] text-gray-200 hover:bg-white/10'
            }`}
            onClick={() => setTrendDays(7)}
          >
            7 أيام
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 hover:scale-105 active:scale-95 motion-reduce:hover:scale-100 ${
              trendDays === 30 ? 'bg-saas-primary text-saas-shell shadow-md' : 'border border-white/10 bg-[#1f2937] text-gray-200 hover:bg-white/10'
            }`}
            onClick={() => setTrendDays(30)}
          >
            30 يوم
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-8 pb-6 md:gap-10">
      {bannerImage && (
        <div className="overflow-hidden rounded-2xl border border-white/10 shadow-soft transition-all duration-200 hover:shadow-md">
          <img src={bannerImage} alt="" className="max-h-32 w-full object-cover transition-transform duration-300 hover:scale-[1.02] md:max-h-36 motion-reduce:hover:scale-100" />
        </div>
      )}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <header className="min-w-0 text-right">
          <p className="text-sm font-medium text-gray-400">لوحة التحكم</p>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">نظرة عامة</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-400">
            مبيعات اليوم {formatCurrency(todaySales)} · {todaySalesCount} طلب
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#1f2937] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:scale-105 hover:bg-white/10 active:scale-95 motion-reduce:hover:scale-100"
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2} aria-hidden />
            تحديث
          </button>
          <button
            type="button"
            disabled={sendingNow}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#1f2937] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:scale-105 hover:bg-white/10 active:scale-95 disabled:opacity-60 motion-reduce:hover:scale-100"
            onClick={async () => {
              setSendingNow(true);
              try {
                const r = await maybeSendDailyWhatsAppReport({ onToast, reason: 'manual_dashboard', ignoreTime: true });
                if (r?.ok && !r?.skipped) onToast?.('تم إرسال التقرير الآن');
                else if (r?.ok && r?.skipped) onToast?.('تم التخطي: تم الإرسال مسبقاً أو لا توجد حركة اليوم');
                else onToast?.('تعذر إرسال التقرير الآن', 'error');
              } catch {
                onToast?.('تعذر إرسال التقرير الآن', 'error');
              } finally {
                setSendingNow(false);
              }
            }}
          >
            <MessageCircle className="h-4 w-4 text-emerald-600" strokeWidth={2} aria-hidden />
            {sendingNow ? 'جاري الإرسال...' : 'واتساب'}
          </button>
        </div>
      </div>

      {showBody && (
        <div className="flex flex-col gap-6">
          <SmartUpgradeNudge
            todaySalesCount={todaySalesCount}
            monthSalesCount={monthSalesCount}
            onGoToPricing={onGoToPricing}
            showUpsell={showSmartPaywall && (todaySalesCount >= 10 || monthSalesCount >= 50)}
          />
          <MotivationMessages
            todaySales={todaySales}
            todaySalesCount={todaySalesCount}
            profitTrend={profitTrend}
            last6Months={last6Months}
          />
          {!hideEngagementChrome && isWorkspaceEmpty && (
            <StarterWelcomeHero
              onAddProduct={onGoToProducts}
              onCreateSale={onGoToSales}
              onAddExpense={onGoToExpense}
            />
          )}
          <StarterChecklist
            hasProduct={hasProduct}
            hasSale={hasSale}
            hasExpense={hasExpense}
          />
        </div>
      )}

      {!showBody && !loading && !error && (
        <SectionCard title="لم نتمكن من عرض اللوحة" subtitle="غالباً تحتاج مساحة عمل نشطة أو اتصالاً بالخادم">
          <p className="text-sm leading-relaxed text-gray-300">
            تأكد من تسجيل الدخول واختيار مساحة العمل الصحيحة، ثم حاول التحديث.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <AppButton variant="primary" size="md" className="bg-saas-primary hover:brightness-105" onClick={() => void refresh()}>
              إعادة التحميل
            </AppButton>
            <AppButton variant="secondary" size="md" onClick={onGoToProducts}>
              فتح المخزون
            </AppButton>
          </div>
        </SectionCard>
      )}

      {showBody && (
        <>
          <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-7" aria-label="مؤشرات رئيسية">
            <StatCard
              label="مبيعات اليوم"
              value={formatCurrency(todaySales)}
              hint={`${todaySalesCount} طلب`}
            />
            <StatCard
              label="صافي الربح"
              value={formatCurrency(monthProfitCombined)}
              hint="هذا الشهر (مبيعات + حركات)"
              trend={netProfitTrendLabel}
            />
            <StatCard label="عدد الطلبات" value={String(todaySalesCount)} hint="طلبات اليوم" />
            <StatCard label="منتجات ناقصة" value={String(lowStockProducts.length)} hint="تحت حد التنبيه" />
          </section>

          <SectionCard title="لمحة ذكية" subtitle="من نفس أرقام لوحتك والرسم البياني">
            {insightMessages.length === 0 ? (
              <p className="text-sm font-medium leading-relaxed text-gray-400">
                ✓ لا تنبيهات عاجلة — يمكنك متابعة يومك بثقة.
              </p>
            ) : (
              <ul className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
                {insightMessages.map((m) => (
                  <li
                    key={m.key}
                    className="flex-1 rounded-2xl border border-white/10 bg-gradient-to-br from-[#1f2937] to-[#111827] px-4 py-3 text-sm font-semibold leading-snug text-gray-100 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:border-saas-primary/35 hover:shadow-md motion-reduce:hover:scale-100 lg:min-w-[240px] lg:flex-none"
                  >
                    {m.text}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="إجراءات سريعة" subtitle="أهم المهام على بُعد نقرة">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
              <div className="relative">
                <ActionButton variant="hero" icon={ShoppingCart} onClick={onGoToSales}>
                  بيع جديد
                </ActionButton>
                {guideEnabled && guideStep === 1 && (
                  <div className="absolute -bottom-2 right-0 z-20 w-52 translate-y-full rounded-xl border border-white/10 bg-[#111827] p-3 text-xs text-white shadow-lg">
                    اضغط لتسجيل أول بيع.
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="rounded-lg bg-saas-primary/25 px-2 py-1 transition-all duration-200 hover:bg-saas-primary/35" onClick={() => setGuideStep(2)}>
                        التالي
                      </button>
                      <button type="button" className="rounded-lg bg-saas-primary/25 px-2 py-1 transition-all duration-200 hover:bg-saas-primary/35" onClick={closeGuide}>
                        تخطي
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <ActionButton icon={PackagePlus} onClick={onGoToProducts}>
                  إضافة منتج
                </ActionButton>
                {guideEnabled && guideStep === 0 && (
                  <div className="absolute -bottom-2 right-0 z-20 w-52 translate-y-full rounded-xl border border-white/10 bg-[#111827] p-3 text-xs text-white shadow-lg">
                    اضغط لإضافة أول منتج.
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="rounded-lg bg-saas-primary/25 px-2 py-1 transition-all duration-200 hover:bg-saas-primary/35" onClick={() => setGuideStep(1)}>
                        التالي
                      </button>
                      <button type="button" className="rounded-lg bg-saas-primary/25 px-2 py-1 transition-all duration-200 hover:bg-saas-primary/35" onClick={closeGuide}>
                        تخطي
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {onGoToExpense && (
                <div className="relative">
                  <ActionButton icon={ReceiptText} onClick={onGoToExpense}>
                    تسجيل مصروف
                  </ActionButton>
                  {guideEnabled && guideStep === 2 && (
                    <div className="absolute -bottom-2 right-0 z-20 w-52 translate-y-full rounded-xl border border-white/10 bg-[#111827] p-3 text-xs text-white shadow-lg">
                      سجّل أي مصروف من هنا.
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="rounded-lg bg-saas-primary/25 px-2 py-1 transition-all duration-200 hover:bg-saas-primary/35" onClick={closeGuide}>
                          تم
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <ActionButton icon={BarChart3} onClick={onGoToReports}>
                عرض التقارير
              </ActionButton>
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
            <div className="flex min-w-0 flex-col gap-8 lg:col-span-7 xl:col-span-8">
              {showCharts && profitTrendError && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm font-medium text-rose-200">
                  تعذر تحميل الرسم. {profitTrendError}
                </div>
              )}

              {showCharts && (
                <SectionCard
                  title="نظرة على المبيعات"
                  subtitle="مبيعات حسب اليوم — آخر 7 أو 30 يوماً"
                  right={chartToolbar}
                >
                  <div className="min-h-[18rem] rounded-2xl border border-white/10 bg-black/20 p-3 md:min-h-[20rem]">
                    {profitTrendLoading && !profitTrend ? (
                      <div className="h-72 w-full animate-pulse rounded-xl bg-white/10 md:h-80" />
                    ) : chartHasNoSales ? (
                      <div className="flex h-72 flex-col items-center justify-center gap-4 px-4 text-center md:h-80">
                        <p className="text-base font-semibold text-gray-200">لا بيانات مبيعات في هذه الفترة بعد</p>
                        <p className="max-w-sm text-sm leading-relaxed text-gray-400">
                          عندما تسجّل مبيعات ستظهر هنا منحنى واضح لآخر {trendDays} أيام.
                        </p>
                        <AppButton
                          variant="primary"
                          size="md"
                          className="bg-gradient-to-l from-teal-500 to-saas-primary shadow-md transition-all duration-200 hover:scale-105 active:scale-95 motion-reduce:hover:scale-100"
                          onClick={onGoToSales}
                        >
                          ابدأ ببيعة جديدة
                        </AppButton>
                      </div>
                    ) : (
                      <div className="h-72 w-full md:h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={profitTrend || []}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                            <Tooltip formatter={(v) => formatCurrency(v)} />
                            <Bar dataKey="sales" name="مبيعات" fill="#00C896" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {showCharts && last6Months.some((m) => m.income > 0 || m.expense > 0 || m.sales > 0) && (
                <div className="space-y-4">
                  <button
                    type="button"
                    className="text-sm font-semibold text-saas-primary transition-all duration-200 hover:scale-105 hover:text-saas-primary-hover active:scale-95 motion-reduce:hover:scale-100"
                    onClick={() => setShowSixMonth((v) => !v)}
                  >
                    {showSixMonth ? 'إخفاء ملخص 6 أشهر' : 'عرض ملخص 6 أشهر'}
                  </button>
                  {showSixMonth && (
                    <SectionCard title="آخر 6 أشهر" subtitle="مبيعات وحركات مجمّعة">
                      <div className="h-72 rounded-2xl border border-white/10 bg-black/20 p-3 md:h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={last6Months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} />
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                            <Legend />
                            <Bar dataKey="sales" name="المبيعات" fill="#00C896" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="salesProfit" name="ربح المبيعات" fill="#0d9488" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="income" name="الإيرادات" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="expense" name="المصروفات" fill="#f43f5e" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="profit" name="صافي الرصيد" fill="#64748b" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </SectionCard>
                  )}
                </div>
              )}
            </div>

            <aside className="flex min-w-0 flex-col gap-8 lg:col-span-5 xl:col-span-4">
              {salesTarget > 0 && (
                <SectionCard title="هدف الشهر" subtitle={`${formatCurrency(monthSales)} من ${formatCurrency(salesTarget)}`}>
                  <div className="space-y-2">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-saas-primary transition-[width] duration-300"
                        style={{ width: `${Math.min(100, (monthSales / salesTarget) * 100)}%` }}
                      />
                    </div>
                    <p className="text-sm font-bold text-gray-200">{Math.round((monthSales / salesTarget) * 100)}%</p>
                  </div>
                </SectionCard>
              )}

              <SectionCard title="نشاط حديث" subtitle="آخر المبيعات والحركات">
                <div className="space-y-5">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">آخر المبيعات</h3>
                    {recentSales.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-gradient-to-b from-[#1f2937]/80 to-[#111827] p-6 text-center">
                        <p className="text-sm font-semibold text-gray-200">لا مبيعات مسجّلة بعد</p>
                        <p className="mt-2 text-xs leading-relaxed text-gray-400">أول عملية بيع ستظهر هنا فوراً مع المبلغ والتاريخ.</p>
                        <AppButton
                          variant="primary"
                          size="md"
                          className="mt-5 bg-gradient-to-l from-teal-500 to-saas-primary shadow-md transition-all duration-200 hover:scale-105 active:scale-95 motion-reduce:hover:scale-100"
                          onClick={onGoToSales}
                        >
                          تسجيل أول بيع
                        </AppButton>
                      </div>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {recentSales.slice(0, 5).map((sale) => (
                          <li
                            key={sale.id}
                            className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm shadow-sm transition-all duration-200 hover:scale-[1.01] hover:border-white/20 hover:shadow-md motion-reduce:hover:scale-100"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="truncate font-medium text-white">{getSaleSummary(sale)}</span>
                              <span className="shrink-0 font-bold text-white">{formatCurrency(getSaleTotal(sale))}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                              <span>{formatDate(sale.date)}</span>
                              <span
                                className={
                                  getSaleProfit(sale) < 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'
                                }
                              >
                                {getSaleProfit(sale) < 0 ? '−' : '+'}
                                {formatCurrency(Math.abs(getSaleProfit(sale)))}
                              </span>
                              {sale.paid ? (
                                <span className="badge badge-paid">مدفوع</span>
                              ) : (
                                <span className="badge badge-unpaid">آجل</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="border-t border-white/10 pt-5">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">آخر الحركات</h3>
                    {recentTransactions.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-gradient-to-b from-[#1f2937]/80 to-[#111827] p-6 text-center">
                        <p className="text-sm font-semibold text-gray-200">لا حركات محاسبية بعد</p>
                        <p className="mt-2 text-xs leading-relaxed text-gray-400">سجّل مصروفاً أو إيراداً من صفحة المصروفات.</p>
                        {onGoToExpense && (
                          <AppButton
                            variant="secondary"
                            size="md"
                            className="mt-5 transition-all duration-200 hover:scale-105 active:scale-95 motion-reduce:hover:scale-100"
                            onClick={onGoToExpense}
                          >
                            تسجيل مصروف
                          </AppButton>
                        )}
                      </div>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {recentTransactions.slice(0, 5).map((t) => (
                          <li
                            key={t.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm transition-all duration-200 hover:scale-[1.01] hover:border-white/20 hover:shadow-md motion-reduce:hover:scale-100"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-white">{t.description}</p>
                              <p className="text-xs text-gray-400">{formatDate(t.date)}</p>
                            </div>
                            <span className={`badge badge-${t.type}`}>{t.type === 'income' ? 'إيراد' : 'مصروف'}</span>
                            <span
                              className={
                                t.type === 'income' ? 'shrink-0 font-bold text-emerald-700' : 'shrink-0 font-bold text-rose-700'
                              }
                            >
                              {t.type === 'income' ? '+' : '−'} {formatCurrency(t.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </SectionCard>

              <Card className={`p-5 ${lowStockProducts.length > 0 ? 'border-rose-500/35 bg-rose-950/25' : ''}`}>
                <CardHeader title="نقص مخزون" subtitle={lowStockProducts.length > 0 ? 'يحتاج تعبئة فورية' : 'لا يوجد تنبيه'} />
                {lowStockProducts.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {lowStockProducts.slice(0, 5).map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2.5 text-sm"
                      >
                        <span className="truncate font-semibold text-white">{p.name}</span>
                        <span className="shrink-0 text-xs font-medium text-rose-300">
                          {p.quantity} {p.unit || 'قطعة'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-gray-400">المخزون ضمن الحدود.</p>
                )}
              </Card>

              <Card className={`p-5 ${dueInvoices.length > 0 ? 'border-amber-500/35 bg-amber-950/25' : ''}`}>
                <CardHeader title="فواتير قريبة" subtitle={dueInvoices.length > 0 ? 'استحقاق خلال أيام' : 'لا يوجد'} />
                {dueInvoices.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {dueInvoices.slice(0, 5).map((i) => (
                      <li
                        key={i.id}
                        className="flex flex-col gap-1 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="truncate font-semibold text-white">{i.client || '—'}</span>
                        <span className="font-bold text-gray-200">{formatCurrency(i.amount || 0)}</span>
                        <span className="text-xs font-medium text-amber-300">{formatDate(i.dueDate)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-gray-400">لا توجد فواتير مستحقة قريباً.</p>
                )}
              </Card>

              <Card
                className={`p-5 ${
                  Array.isArray(readModel?.topProducts) && readModel.topProducts.length > 0
                    ? 'border-emerald-500/35 bg-emerald-950/20'
                    : ''
                }`}
              >
                <CardHeader title="أفضل المنتجات" subtitle="أداء هذا الشهر" />
                {Array.isArray(readModel?.topProducts) && readModel.topProducts.length > 0 ? (
                  <ul className="mt-4 divide-y divide-emerald-500/20 rounded-xl border border-emerald-500/25 bg-[#1f2937]/50">
                    {readModel.topProducts.slice(0, 5).map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                        <span className="truncate font-medium text-white">{p.name || '—'}</span>
                        <span className="shrink-0 font-bold text-emerald-300">{formatCurrency(p.revenue ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-gray-400">لا توجد بيانات بعد.</p>
                )}
              </Card>

              <SmartInsights invoices={invoices} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
