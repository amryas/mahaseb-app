import { useState, useMemo, useEffect } from 'react';
import { getCategories, formatCurrency, formatDate, getClients, getSales, getProducts, getSaleTotal, getSaleProfit, getSaleSummary, parseAmount, getCapital, getCurrentAccountId } from '../data/store';
import { getFeatureFlag, FLAG_REPORTS_AGGREGATES } from '../data/featureFlags';
import { fetchReportsReadModel } from '../data/aggregatesService';
import { logSystemEvent } from '../services/monitoring';
import { getFriendlyErrorMessage, logError } from '../utils/userErrorHandler';
import { useUsageLimits } from '../hooks/useUsageLimits';
import { apiTrackEvent } from '../data/workspaceApi';
import { isSupabaseEnabled } from '../supabase/config';
import { assertUsageLimitAllows } from '../data/usageLimitsApi';
import { BILLING_ERROR_CODES } from '../data/billingErrors';
import { buildSummaryReport, buildMonthlyReport, buildDailyReport, buildProfitSummaryForWhatsApp, openWhatsAppWithMessage } from '../utils/whatsappReport';
import * as excelExport from '../utils/excelExport';
import { exportMonthlyPackagePdf, exportSalesReportPdf, exportExpensesReportPdf } from '../utils/accountantPackagePdf';
import { useSubscription } from '../hooks/useSubscription';
import SectionHeader from './ui/SectionHeader';
import Card, { CardHeader } from './ui/Card';
import AppButton from './ui/AppButton';
import { BarChart3, Wallet, FolderOpen, Briefcase, ChevronDown, ChevronUp } from 'lucide-react';

const REPORT_CARD_ICONS = {
  sales: BarChart3,
  expenses: Wallet,
  full: FolderOpen,
  accountant: Briefcase,
};

export default function Reports({ transactions, invoices, noTitle, onToast }) {
  const workspaceId = getCurrentAccountId();
  const useReportsAggregates = getFeatureFlag(FLAG_REPORTS_AGGREGATES, false);
  const [reportsAgg, setReportsAgg] = useState(null);
  const [reportsAggLoading, setReportsAggLoading] = useState(false);

  useEffect(() => {
    if (!useReportsAggregates || !workspaceId) {
      setReportsAgg(null);
      setReportsAggLoading(false);
      return;
    }
    let cancelled = false;
    setReportsAggLoading(true);
    (async () => {
      try {
        const row = await fetchReportsReadModel();
        if (!cancelled) setReportsAgg(row);
      } catch (e) {
        if (!cancelled) {
          setReportsAgg(null);
          void logSystemEvent('aggregate_failure', 'Reports fetchReportsReadModel', { error: e?.message || 'unknown' });
        }
      } finally {
        if (!cancelled) setReportsAggLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useReportsAggregates, workspaceId]);

  const { isExpired, canWrite } = useSubscription();
  const { canExportReport, limitReachedMessage, loading: limitsLoading, refresh: refreshLimits } = useUsageLimits(workspaceId);
  const [accountantOpen, setAccountantOpen] = useState(true);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [reportType, setReportType] = useState('daily');
  const [reportMonth, setReportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [profitReportMonth, setProfitReportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [accountantPackageMonth, setAccountantPackageMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedClientId, setSelectedClientId] = useState('');
  const [dailyReportDate, setDailyReportDate] = useState(() => new Date().toISOString().slice(0, 10));

  const clients = getClients();

  const legacyTxnBreakdown = useMemo(() => {
    if (useReportsAggregates) return null;
    const cats = getCategories();
    const income = transactions.filter((t) => t.type === 'income');
    const expense = transactions.filter((t) => t.type === 'expense');

    const byCatInc = {};
    cats.income.forEach((c) => { byCatInc[c] = 0; });
    income.forEach((t) => { byCatInc[t.category] = (byCatInc[t.category] || 0) + parseAmount(t.amount); });

    const byCatExp = {};
    cats.expense.forEach((c) => { byCatExp[c] = 0; });
    expense.forEach((t) => { byCatExp[t.category] = (byCatExp[t.category] || 0) + parseAmount(t.amount); });

    const monthlyMap = {};
    transactions.forEach((t) => {
      const key = t.date?.slice(0, 7);
      if (!key) return;
      if (!monthlyMap[key]) monthlyMap[key] = { income: 0, expense: 0 };
      if (t.type === 'income') monthlyMap[key].income += parseAmount(t.amount);
      else monthlyMap[key].expense += parseAmount(t.amount);
    });

    return {
      byCategoryIncome: Object.entries(byCatInc).filter(([, v]) => v > 0),
      byCategoryExpense: Object.entries(byCatExp).filter(([, v]) => v > 0),
      monthly: Object.entries(monthlyMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6),
      totalIncome: income.reduce((s, t) => s + parseAmount(t.amount), 0),
      totalExpense: expense.reduce((s, t) => s + parseAmount(t.amount), 0),
    };
  }, [useReportsAggregates, transactions]);

  const byCategoryIncome = useReportsAggregates ? (reportsAgg?.byCategoryIncome ?? []) : (legacyTxnBreakdown?.byCategoryIncome ?? []);
  const byCategoryExpense = useReportsAggregates ? (reportsAgg?.byCategoryExpense ?? []) : (legacyTxnBreakdown?.byCategoryExpense ?? []);
  const monthly = useReportsAggregates ? (reportsAgg?.monthly ?? []) : (legacyTxnBreakdown?.monthly ?? []);
  const totalIncome = useReportsAggregates ? (reportsAgg?.totalIncome ?? 0) : (legacyTxnBreakdown?.totalIncome ?? 0);
  const totalExpense = useReportsAggregates ? (reportsAgg?.totalExpense ?? 0) : (legacyTxnBreakdown?.totalExpense ?? 0);

  /** صافي الحركات = إيراد − مصروف */
  const balanceFromMovements = Math.round((totalIncome - totalExpense) * 100) / 100;
  const capitalData = getCapital();
  const capitalAmount = parseAmount(capitalData?.amount) ?? 0;
  const unpaidInvoices = invoices.filter((i) => !i.paid).reduce((s, i) => s + parseAmount(i.amount), 0);

  const sales = getSales();

  const legacySalesBlock = useMemo(() => {
    if (useReportsAggregates) return null;
    const completedSales = sales.filter((s) => (s.status || 'completed') === 'completed');
    const cancelledSales = sales.filter((s) => s.status === 'cancelled');
    const returnedSales = sales.filter((s) => s.status === 'returned');
    const totalSalesAmountVal = completedSales.reduce((s, x) => s + getSaleTotal(x), 0);
    const totalProfitFromSalesVal = completedSales.reduce((s, x) => s + getSaleProfit(x), 0);
    const todayStrLocal = new Date().toISOString().slice(0, 10);
    const monthStartLocal = todayStrLocal.slice(0, 7) + '-01';
    const todaySalesReportVal = completedSales.filter((x) => x.date === todayStrLocal).reduce((s, x) => s + getSaleTotal(x), 0);
    const monthSalesReportVal = completedSales.filter((x) => x.date >= monthStartLocal && x.date <= todayStrLocal).reduce((s, x) => s + getSaleTotal(x), 0);
    const map = {};
    completedSales.forEach((s) => {
      if (Array.isArray(s.items) && s.items.length > 0) {
        const saleTotal = getSaleTotal(s);
        const subtotal = s.items.reduce((sum, i) => sum + (parseAmount(i.quantity) || 0) * parseAmount(i.unitPrice), 0);
        const ratio = subtotal > 0 ? saleTotal / subtotal : 1;
        s.items.forEach((it) => {
          const key = it.productId || it.productName || 'غير معروف';
          if (!map[key]) map[key] = { name: it.productName || key, quantity: 0, total: 0, profit: 0 };
          const q = parseAmount(it.quantity) || 0;
          const itemRevenue = q * parseAmount(it.unitPrice);
          const itemCost = q * parseAmount(it.unitCost);
          const itemTotal = ratio * itemRevenue;
          const itemProfit = itemTotal - itemCost;
          map[key].quantity += q;
          map[key].total += itemTotal;
          map[key].profit += itemProfit;
        });
      } else {
        const key = s.productId || s.productName || 'غير معروف';
        if (!map[key]) map[key] = { name: s.productName || key, quantity: 0, total: 0, profit: 0 };
        map[key].quantity += parseAmount(s.quantity) || 0;
        map[key].total += getSaleTotal(s);
        map[key].profit += getSaleProfit(s);
      }
    });
    const salesByProductVal = Object.values(map).sort((a, b) => b.quantity - a.quantity);
    const clientMap = {};
    completedSales.filter((s) => !s.paid).forEach((s) => {
      const name = s.clientName || 'نقدي';
      clientMap[name] = (clientMap[name] || 0) + getSaleTotal(s);
    });
    const clientBalancesUnpaidVal = Object.entries(clientMap).sort((a, b) => b[1] - a[1]);
    return {
      completedSales,
      cancelledSales,
      returnedSales,
      totalSalesAmount: totalSalesAmountVal,
      totalProfitFromSales: totalProfitFromSalesVal,
      todaySalesReport: todaySalesReportVal,
      monthSalesReport: monthSalesReportVal,
      salesByProduct: salesByProductVal,
      clientBalancesUnpaid: clientBalancesUnpaidVal,
    };
  }, [useReportsAggregates, sales]);

  const cancelledReturnedRows = useMemo(() => {
    if (!useReportsAggregates) {
      const lb = legacySalesBlock;
      if (!lb) return [];
      return [...lb.cancelledSales, ...lb.returnedSales].sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    if (!reportsAgg || (reportsAgg.cancelledCount === 0 && reportsAgg.returnedCount === 0)) return [];
    return getSales()
      .filter((s) => s.status === 'cancelled' || s.status === 'returned')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [useReportsAggregates, legacySalesBlock, reportsAgg, sales]);

  const totalSalesAmount = useReportsAggregates ? (reportsAgg?.totalSalesAmount ?? 0) : (legacySalesBlock?.totalSalesAmount ?? 0);
  const totalProfitFromSales = useReportsAggregates ? (reportsAgg?.totalProfitFromSales ?? 0) : (legacySalesBlock?.totalProfitFromSales ?? 0);
  /** صافي الربح = ربح المبيعات + إيرادات الحركات − المصروفات */
  const netProfit = Math.round((totalProfitFromSales + totalIncome - totalExpense) * 100) / 100;
  /** الرصيد = رأس المال + صافي الربح (يعكس نتيجة النشاط)، أو صافي الربح إن لم يُدخل رأس مال */
  const totalBalance = capitalAmount > 0
    ? Math.round((capitalAmount + netProfit) * 100) / 100
    : netProfit;
  const completedSalesCount = useReportsAggregates ? (reportsAgg?.completedCount ?? 0) : (legacySalesBlock?.completedSales.length ?? 0);
  const cancelledSalesLength = useReportsAggregates ? (reportsAgg?.cancelledCount ?? 0) : (legacySalesBlock?.cancelledSales.length ?? 0);
  const returnedSalesLength = useReportsAggregates ? (reportsAgg?.returnedCount ?? 0) : (legacySalesBlock?.returnedSales.length ?? 0);
  const todaySalesReport = useReportsAggregates ? (reportsAgg?.todaySalesReport ?? 0) : (legacySalesBlock?.todaySalesReport ?? 0);
  const monthSalesReport = useReportsAggregates ? (reportsAgg?.monthSalesReport ?? 0) : (legacySalesBlock?.monthSalesReport ?? 0);
  const salesByProduct = useReportsAggregates ? (reportsAgg?.salesByProduct ?? []) : (legacySalesBlock?.salesByProduct ?? []);
  const clientBalancesUnpaid = useReportsAggregates ? (reportsAgg?.clientBalancesUnpaid ?? []) : (legacySalesBlock?.clientBalancesUnpaid ?? []);

  const mostSold = salesByProduct.slice(0, 5);
  const mostProfitable = [...salesByProduct].filter((p) => p.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 5);
  const leastSold = salesByProduct.length > 5 ? salesByProduct.slice(-5).reverse() : [...salesByProduct].reverse();

  const products = getProducts();
  const dailyInventory = useMemo(() => [...products].sort((a, b) => (b.quantity || 0) - (a.quantity || 0)), [products]);

  const handleSendWhatsApp = () => {
    if (isExpired || !canWrite) {
      onToast?.('انتهت الفترة التجريبية — هذه العملية للعرض فقط.', 'error');
      return;
    }
    let phone = whatsappPhone.trim();
    if (selectedClientId) {
      const client = clients.find((c) => c.id === selectedClientId);
      if (client?.phone) phone = client.phone;
    }
    if (!phone) return;
    let text = '';
    if (reportType === 'daily') {
      text = buildDailyReport(transactions, dailyReportDate);
    } else if (reportType === 'summary') {
      text = buildSummaryReport(transactions, invoices);
    } else if (reportType === 'profitSummary') {
      text = buildProfitSummaryForWhatsApp();
    } else if (reportType === 'monthly') {
      const [y, m] = reportMonth.split('-').map(Number);
      text = buildMonthlyReport(transactions, invoices, y, m);
    } else {
      const [y, m] = reportMonth.split('-').map(Number);
      text = buildMonthlyReport(transactions, invoices, y, m);
    }
    openWhatsAppWithMessage(phone, text);
  };

  const trackReportExport = () => {
    if (workspaceId && isSupabaseEnabled()) {
      apiTrackEvent(workspaceId, 'export_report', {}).then(() => refreshLimits());
    }
  };

  const handleExport = async (fn, name) => {
    if (isExpired || !canWrite) {
      onToast?.('انتهت الفترة التجريبية — هذه العملية للعرض فقط.', 'error');
      return;
    }
    if (isSupabaseEnabled() && workspaceId) {
      try {
        await assertUsageLimitAllows(workspaceId, 'report');
      } catch (e) {
        if (e?.code === BILLING_ERROR_CODES.PLAN_LIMIT_REACHED) {
          onToast?.(limitReachedMessage, 'error');
          return;
        }
        throw e;
      }
    }
    if (isSupabaseEnabled() && !limitsLoading && !canExportReport) {
      onToast?.(limitReachedMessage, 'error');
      return;
    }
    try {
      fn();
      trackReportExport();
      onToast?.('تم التحميل. الملف في مجلد التنزيلات.');
    } catch (e) {
      logError(e, 'Reports export');
      onToast?.(getFriendlyErrorMessage(e), 'error');
    }
  };
  const handleExportAsync = async (fn, name) => {
    if (isExpired || !canWrite) {
      onToast?.('انتهت الفترة التجريبية — هذه العملية للعرض فقط.', 'error');
      return;
    }
    if (isSupabaseEnabled() && workspaceId) {
      try {
        await assertUsageLimitAllows(workspaceId, 'report');
      } catch (e) {
        if (e?.code === BILLING_ERROR_CODES.PLAN_LIMIT_REACHED) {
          onToast?.(limitReachedMessage, 'error');
          return;
        }
        throw e;
      }
    }
    if (isSupabaseEnabled() && !limitsLoading && !canExportReport) {
      onToast?.(limitReachedMessage, 'error');
      return;
    }
    try {
      await fn();
      trackReportExport();
      onToast?.('تم التحميل. الملف في مجلد التنزيلات.');
    } catch (e) {
      logError(e, 'Reports export');
      onToast?.(getFriendlyErrorMessage(e), 'error');
    }
  };

  const reportCards = [
    {
      id: 'sales',
      title: 'تقرير المبيعات',
      description: 'كل الفواتير والبنود مع الإجماليات والربح.',
      stat: formatCurrency(totalSalesAmount),
      statLabel: 'إجمالي المبيعات',
      onPdf: () => handleExportAsync(exportSalesReportPdf, 'sales'),
    },
    {
      id: 'expenses',
      title: 'تقرير المصروفات',
      description: 'كل المصروفات مرتبة بالتاريخ مع الفئات.',
      stat: formatCurrency(totalExpense),
      statLabel: 'إجمالي المصروفات',
      onPdf: () => handleExportAsync(exportExpensesReportPdf, 'expenses'),
    },
    {
      id: 'full',
      title: 'التقرير الشامل',
      description: 'ملخص واحد مع المبيعات والمصروفات والحركات والمخزون والعملاء والفواتير.',
      stat: formatCurrency(netProfit),
      statLabel: 'صافي الربح',
      onExcel: () => handleExport(excelExport.exportFullReportExcel, 'full'),
    },
    {
      id: 'accountant',
      title: 'تقرير المحاسب',
      description: 'كل ما يحتاجه المحاسب: حركات، مبيعات، مرتجعات، مصروفات، جرد، ديون، مشتريات.',
      stat: `${transactions.length} حركة`,
      statLabel: 'عدد الحركات',
      onExcel: () => handleExport(excelExport.exportAccountantFullExcel, 'accountant'),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {!noTitle && <SectionHeader title="التقارير" subtitle="تصدير سريع وواضح للتقارير المهمة." />}

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4 xl:gap-8" aria-label="تقارير التصدير">
        {reportCards.map((c) => {
          const IconCmp = REPORT_CARD_ICONS[c.id] || BarChart3;
          return (
            <Card key={c.id} className="flex flex-col items-center p-5 text-center md:p-6">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-gray-300 ring-1 ring-inset ring-white/10">
                <IconCmp className="h-7 w-7" strokeWidth={2} aria-hidden />
              </div>
              <h2 className="mt-5 text-lg font-bold tracking-tight text-white">{c.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-300">{c.description}</p>
              <div className="mt-5 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-4 shadow-inner">
                <div className="text-lg font-bold tracking-tight text-white sm:text-xl">{c.stat}</div>
                <div className="mt-1 text-xs font-medium text-gray-400">{c.statLabel}</div>
              </div>
              <div className="mt-5 w-full">
                {c.onExcel && (
                  <AppButton type="button" variant="primary" size="md" className="w-full shadow-sm" onClick={c.onExcel}>
                    تحميل Excel
                  </AppButton>
                )}
                {c.onPdf && (
                  <AppButton type="button" variant="primary" size="md" className="w-full shadow-sm" onClick={c.onPdf}>
                    تحميل PDF
                  </AppButton>
                )}
              </div>
            </Card>
          );
        })}
      </section>

      <Card className="p-5 md:p-6">
        <CardHeader title="ملخص سريع" subtitle="مؤشرات اليوم والشهر بنظرة واحدة" />
        {quickSummaryOpen && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
            <div className="rounded-2xl border border-white/10 bg-[#1f2937]/80 p-4 text-right shadow-lg border-s-4 border-s-teal-500">
              <div className="text-sm font-medium text-gray-400">مبيعات اليوم</div>
              <div className="mt-2 text-xl font-bold tabular-nums text-white">{formatCurrency(todaySalesReport)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#1f2937]/80 p-4 text-right shadow-lg border-s-4 border-s-[#1e3a5f]">
              <div className="text-sm font-medium text-gray-400">مبيعات الشهر</div>
              <div className="mt-2 text-xl font-bold tabular-nums text-white">{formatCurrency(monthSalesReport)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#1f2937]/80 p-4 text-right shadow-lg border-s-4 border-s-rose-500">
              <div className="text-sm font-medium text-gray-400">المصروفات</div>
              <div className="mt-2 text-xl font-bold tabular-nums text-white">{formatCurrency(totalExpense)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#1f2937]/80 p-4 text-right shadow-lg border-s-4 border-s-emerald-500">
              <div className="text-sm font-medium text-gray-400">صافي الربح</div>
              <div className="mt-2 text-xl font-bold tabular-nums text-white">{formatCurrency(netProfit)}</div>
              <div className="mt-2 text-xs font-medium leading-snug text-gray-400">
                ربح المبيعات + إيرادات الحركات − المصروفات
              </div>
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-end">
          <AppButton
            type="button"
            variant="ghost"
            size="md"
            className="gap-1.5 font-semibold text-gray-400"
            onClick={() => setQuickSummaryOpen((v) => !v)}
            aria-expanded={quickSummaryOpen}
          >
            {quickSummaryOpen ? (
              <>
                إخفاء
                <ChevronUp className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
              </>
            ) : (
              <>
                عرض
                <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
              </>
            )}
          </AppButton>
        </div>
      </Card>

      <div className="flex justify-start">
        <AppButton type="button" variant="secondary" onClick={() => setAccountantOpen((o) => !o)} aria-expanded={accountantOpen}>
          {accountantOpen ? '▼ إخفاء قسم المحاسب' : '▶ للمحاسب: واتساب وتصدير Excel / PDF'}
        </AppButton>
      </div>

      {accountantOpen && (
      <Card>
        <CardHeader
          title="إرسال تقرير عبر واتساب"
          subtitle="اختر نوع التقرير ورقم واتساب ثم اضغط الزر لفتح واتساب وإرسال التقرير."
        />
        <div className="whatsapp-report-form mt-6">
          <div className="form-row">
            <div className="form-group">
              <label>نوع التقرير</label>
              <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
                <option value="daily">كشف يومي</option>
                <option value="summary">ملخص الرصيد</option>
                <option value="profitSummary">ملخص الربح (اليوم والشهر)</option>
                <option value="monthly">تقرير شهري</option>
              </select>
            </div>
            {reportType === 'daily' && (
              <div className="form-group">
                <label>تاريخ الكشف اليومي</label>
                <input
                  type="date"
                  value={dailyReportDate}
                  onChange={(e) => setDailyReportDate(e.target.value)}
                />
              </div>
            )}
            {reportType === 'monthly' && (
              <div className="form-group">
                <label>الشهر</label>
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                />
              </div>
            )}
            <div className="form-group">
              <label>اختيار عميل (اختياري)</label>
              <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)}>
                <option value="">— إدخال رقم يدوياً —</option>
                {clients.filter((c) => c.phone).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} - {c.phone}</option>
                ))}
              </select>
            </div>
            {!selectedClientId && (
              <div className="form-group">
                <label>رقم واتساب العميل</label>
                <input
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  placeholder="01xxxxxxxx"
                  dir="ltr"
                />
              </div>
            )}
            <div className="form-group form-group-btn">
              <label>&nbsp;</label>
              <AppButton
                type="button"
                variant="primary"
                className="w-full bg-emerald-600 hover:brightness-105 md:w-auto"
                onClick={handleSendWhatsApp}
                disabled={!whatsappPhone.trim() && !(selectedClientId && clients.find((c) => c.id === selectedClientId)?.phone)}
              >
                فتح واتساب وإرسال التقرير
              </AppButton>
            </div>
          </div>
        </div>
        <p className="mt-6 text-sm text-gray-300">
          <strong>تصدير للمحاسب:</strong> ملف Excel واحد شامل بكل ما يحتاجه المحاسب (حركات، مبيعات، مرتجعات وإلغاء، مصروفات، جرد، أرباح، ملخص) مع حزمة شهرية.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <AppButton
            type="button"
            variant="primary"
            onClick={() => {
              if (isSupabaseEnabled() && !limitsLoading && !canExportReport) {
                onToast?.(limitReachedMessage, 'error');
                return;
              }
              try {
                excelExport.exportAccountantFullExcel();
                trackReportExport();
                onToast?.('تم التحميل. الملف في مجلد التنزيلات (Downloads) في جهازك.');
              } catch (e) {
                logError(e, 'Reports export');
                onToast?.(getFriendlyErrorMessage(e), 'error');
              }
            }}
          >
            📥 تصدير للمحاسب (Excel شامل)
          </AppButton>
          <span className="flex flex-wrap items-center gap-2">
            <label htmlFor="accountant-package-month" className="text-sm text-gray-300">
              حزمة شهرية:
            </label>
            <input
              id="accountant-package-month"
              type="month"
              value={accountantPackageMonth}
              onChange={(e) => setAccountantPackageMonth(e.target.value)}
            />
            <AppButton
              type="button"
              variant="secondary"
              onClick={() => {
                if (isSupabaseEnabled() && !limitsLoading && !canExportReport) {
                  onToast?.(limitReachedMessage, 'error');
                  return;
                }
                try {
                  excelExport.exportMonthlyPackageExcel(accountantPackageMonth);
                  trackReportExport();
                  onToast?.('تم التحميل. الملف في مجلد التنزيلات (Downloads) في جهازك.');
                } catch (e) {
                  logError(e, 'Reports export');
                  onToast?.(getFriendlyErrorMessage(e), 'error');
                }
              }}
            >
              Excel شهري
            </AppButton>
            <AppButton
              type="button"
              variant="secondary"
              onClick={async () => {
                if (isSupabaseEnabled() && !limitsLoading && !canExportReport) {
                  onToast?.(limitReachedMessage, 'error');
                  return;
                }
                try {
                  await exportMonthlyPackagePdf(accountantPackageMonth);
                  trackReportExport();
                  onToast?.('تم التحميل. الملف في مجلد التنزيلات (Downloads) في جهازك.');
                } catch (e) {
                  logError(e, 'Reports export');
                  onToast?.(getFriendlyErrorMessage(e), 'error');
                }
              }}
            >
              PDF شهري
            </AppButton>
          </span>
        </div>
      </Card>
      )}

      <Card>
        <CardHeader title="تفصيل المؤشرات" subtitle="نفس الحسابات المستخدمة في التصدير." />
        <div className="stat-cards mt-6">
        <div className="stat-card balance">
          <div className="stat-label">مبيعات اليوم</div>
          <div className="stat-value">{formatCurrency(todaySalesReport)}</div>
        </div>
        <div className="stat-card total">
          <div className="stat-label">مبيعات الشهر</div>
          <div className="stat-value">{formatCurrency(monthSalesReport)}</div>
        </div>
        <div className={`stat-card ${totalProfitFromSales >= 0 ? 'income' : 'expense'}`}>
          <div className="stat-label">ربح المبيعات (إجمالي)</div>
          <div className="stat-value">{totalProfitFromSales >= 0 ? '' : '−'}{formatCurrency(Math.abs(totalProfitFromSales))}</div>
        </div>
        <div className="stat-card total">
          <div className="stat-label">إجمالي الإيرادات (البيع)</div>
          <div className="stat-value">{formatCurrency(totalSalesAmount)}</div>
          <div className="stat-extra">{completedSalesCount} عملية</div>
        </div>
        <div className="stat-card expense">
          <div className="stat-label">إجمالي المصروفات</div>
          <div className="stat-value">{formatCurrency(totalExpense)}</div>
        </div>
        <div className={`stat-card ${netProfit >= 0 ? 'balance' : 'expense'}`}>
          <div className="stat-label">صافي الربح / الخسارة</div>
          <div className="stat-value">{formatCurrency(netProfit)}</div>
          <div className="stat-extra">ربح المبيعات − المصروفات</div>
        </div>
        <div className="stat-card total">
          <div className="stat-label">صافي الحركات (إيراد − مصروف)</div>
          <div className="stat-value">{formatCurrency(balanceFromMovements)}</div>
          <div className="stat-extra">إيرادات ومصروفات الحركات فقط</div>
        </div>
        <div className="stat-card balance">
          <div className="stat-label">الرصيد</div>
          <div className="stat-value">{formatCurrency(totalBalance)}</div>
          <div className="stat-extra">{capitalAmount > 0 ? 'رأس المال + صافي الربح' : 'صافي الربح (ربح المبيعات + إيراد − مصروف)'}</div>
        </div>
        {totalProfitFromSales !== 0 && (
          <div className={`stat-card ${netProfit >= 0 ? 'balance' : 'expense'}`}>
            <div className="stat-label">{netProfit >= 0 ? 'نسبة صافي الربح من ربح المبيعات' : 'نسبة الخسارة'}</div>
            <div className="stat-value">
              {totalProfitFromSales === 0 ? '—' : (netProfit >= 0 ? '' : '−') + Math.abs((netProfit / totalProfitFromSales) * 100).toFixed(1) + '%'}
            </div>
          </div>
        )}
        <div className="stat-card">
          <div className="stat-label">فواتير غير مدفوعة</div>
          <div className="stat-value" style={{ color: 'var(--expense)' }}>{formatCurrency(unpaidInvoices)}</div>
        </div>
        {(cancelledSalesLength > 0 || returnedSalesLength > 0) && (
          <>
            <div className="stat-card" style={{ borderColor: 'var(--expense)' }}>
              <div className="stat-label">طلبات ملغاة</div>
              <div className="stat-value">{cancelledSalesLength}</div>
            </div>
            <div className="stat-card" style={{ borderColor: '#94a3b8' }}>
              <div className="stat-label">مرتجعات</div>
              <div className="stat-value">{returnedSalesLength}</div>
            </div>
          </>
        )}
      </div>
      </Card>

      <Card>
        <CardHeader title="جرد يومي (المخزون الحالي)" subtitle="كميات المنتجات المتوفرة حالياً — للإعدادات والمراجعة." />
        {dailyInventory.length === 0 ? (
          <p className="mt-4 text-sm text-gray-300">لا يوجد منتجات في المخزون.</p>
        ) : (
          <div className="table-wrap mt-6 rounded-2xl border border-white/10">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>الكمية المتوفرة</th>
                  <th>الوحدة</th>
                  <th>حد التنبيه</th>
                  <th>تكلفة الوحدة</th>
                </tr>
              </thead>
              <tbody>
                {dailyInventory.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><strong>{p.quantity ?? 0}</strong></td>
                    <td>{p.unit || 'قطعة'}</td>
                    <td>{p.minQuantity ?? '—'}</td>
                    <td>{formatCurrency(p.costPrice ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {cancelledReturnedRows.length > 0 && (
        <Card>
          <CardHeader
            title="المرتجعات والإلغاء"
            subtitle="المبيعات الملغاة والمرتجعة — لا تدخل في إجمالي المبيعات أو الربح."
          />
          <div className="table-wrap mt-6 rounded-2xl border border-white/10">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المنتج</th>
                  <th>الكمية</th>
                  <th>المبلغ</th>
                  <th>العميل</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {cancelledReturnedRows
                  .map((s) => (
                    <tr key={s.id}>
                      <td>{formatDate(s.date)}</td>
                      <td>{s.productName}</td>
                      <td>{s.quantity}</td>
                      <td>{formatCurrency(getSaleTotal(s) ?? 0)}</td>
                      <td>{s.clientName}</td>
                      <td>
                        {s.status === 'cancelled' && <span className="badge badge-expense">ملغى</span>}
                        {s.status === 'returned' && <span className="badge" style={{ background: '#94a3b8', color: '#fff' }}>مرتجع</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="الإيرادات حسب الفئة" />
          {byCategoryIncome.length === 0 ? (
            <p className="mt-4 text-sm text-gray-300">لا توجد إيرادات مسجلة.</p>
          ) : (
            <ul className="mt-4 list-none space-y-0 p-0">
              {byCategoryIncome.map(([cat, amt]) => (
                <li key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{cat}</span>
                  <span className="amount-income">{formatCurrency(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="المصروفات حسب الفئة" />
          {byCategoryExpense.length === 0 ? (
            <p className="mt-4 text-sm text-gray-300">لا توجد مصروفات مسجلة.</p>
          ) : (
            <ul className="mt-4 list-none space-y-0 p-0">
              {byCategoryExpense.map(([cat, amt]) => (
                <li key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{cat}</span>
                  <span className="amount-expense">{formatCurrency(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {clientBalancesUnpaid.length > 0 && (
        <Card>
          <CardHeader
            title="أرصدة العملاء (مبيعات آجلة)"
            subtitle="مبيعات مسجلة كدفع آجل ولم يُستلم مبلغها بعد."
          />
          <div className="table-wrap mt-6 rounded-2xl border border-white/10">
            <table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>المبلغ المستحق</th>
                </tr>
              </thead>
              <tbody>
                {clientBalancesUnpaid.map(([name, amt]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="amount-income">{formatCurrency(amt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {salesByProduct.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader title="الأكثر مبيعاً" />
            <ul className="mt-4 list-none space-y-0 p-0">
              {mostSold.map((p, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{p.name}</span>
                  <span>{p.quantity} وحدة — {formatCurrency(p.total)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {mostProfitable.length > 0 && (
            <Card>
              <CardHeader title="أفضل المنتجات ربحية" />
              <ul className="mt-4 list-none space-y-0 p-0">
                {mostProfitable.map((p, i) => {
                  const avgMargin = p.total > 0 ? (p.profit / p.total) * 100 : 0;
                  return (
                    <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span>{p.name}</span>
                      <span className="amount-income">+{formatCurrency(p.profit)} ({avgMargin.toFixed(0)}%)</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="الأقل مبيعاً" />
            <ul className="mt-4 list-none space-y-0 p-0">
              {leastSold.map((p, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{p.name}</span>
                  <span>{p.quantity} وحدة — {formatCurrency(p.total)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="ملخص شهري" />
        {monthly.length === 0 ? (
          <p className="mt-4 text-sm text-gray-300">لا توجد حركات كافية لعرض ملخص شهري.</p>
        ) : (
          <div className="table-wrap mt-6 rounded-2xl border border-white/10">
            <table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th>الإيرادات</th>
                  <th>المصروفات</th>
                  <th>الصافي</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map(([month, data]) => {
                  const [y, m] = month.split('-');
                  const monthLabel = new Date(y, m - 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
                  const net = data.income - data.expense;
                  return (
                    <tr key={month}>
                      <td>{monthLabel}</td>
                      <td className="amount-income">{formatCurrency(data.income)}</td>
                      <td className="amount-expense">{formatCurrency(data.expense)}</td>
                      <td style={{ fontWeight: 700, color: net >= 0 ? 'var(--income)' : 'var(--expense)' }}>
                        {formatCurrency(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
