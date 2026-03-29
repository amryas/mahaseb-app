import { useMemo, useState, useEffect } from 'react';
import { formatCurrency, getSettings, getCurrentAccountId, parseAmount } from '../data/store';
import { getCacheUserId } from '../data/cacheStore';
import { fetchSmartInsightsFinancials } from '../data/aggregatesService';
import { logSystemEvent } from '../services/monitoring';

export default function SmartInsights({ invoices }) {
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();
  const [fin, setFin] = useState(null);

  useEffect(() => {
    if (!workspaceId || !userId) {
      setFin(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchSmartInsightsFinancials();
        if (!cancelled) setFin(row);
      } catch (e) {
        if (!cancelled) {
          setFin(null);
          void logSystemEvent('aggregate_failure', 'SmartInsights fetchSmartInsightsFinancials', { error: e?.message || 'unknown' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, userId]);

  const tips = useMemo(() => {
    if (!fin) return [];
    const list = [];
    const income = fin.income;
    const expense = fin.expense;
    const salesProfit = fin.salesProfitTotal;
    const balance = salesProfit + income - expense;
    const monthIncome = fin.monthIncome;
    const lastMonthIncome = fin.lastMonthIncome;
    const unpaid = invoices.filter((i) => !i.paid);
    const unpaidTotal = unpaid.reduce((s, i) => s + parseAmount(i.amount), 0);
    const settings = getSettings();
    const target = Number(settings.salesTargetMonthly) || 0;

    if (expense > income && income > 0) {
      list.push({ type: 'warning', text: 'المصروفات تتجاوز الإيرادات. راجع المصروفات أو زد المبيعات.' });
    }
    if (balance > 0 && income > 0) {
      list.push({ type: 'success', text: `رصيدك الحالي إيجابي (${formatCurrency(balance)}). استمر على هذا النهج.` });
    }
    if (target > 0 && monthIncome >= target) {
      list.push({ type: 'success', text: 'تهانينا! حققت هدف مبيعات الشهر.' });
    }
    if (target > 0 && monthIncome < target && monthIncome > 0) {
      const pct = Math.round((monthIncome / target) * 100);
      list.push({ type: 'info', text: `أنت عند ${pct}% من هدف المبيعات. باقي ${formatCurrency(target - monthIncome)} للهدف.` });
    }
    if (lastMonthIncome > 0 && monthIncome > lastMonthIncome) {
      const pct = Math.round(((monthIncome - lastMonthIncome) / lastMonthIncome) * 100);
      list.push({ type: 'success', text: `مبيعات هذا الشهر أعلى من الماضي بنسبة ${pct}% تقريباً.` });
    }
    if (unpaid.length > 0) {
      list.push({ type: 'warning', text: `لديك ${unpaid.length} فاتورة غير مدفوعة بإجمالي ${formatCurrency(unpaidTotal)}. تابع الاستحقاقات.` });
    }
    if (fin.transactionCount === 0) {
      list.push({ type: 'info', text: 'ابدأ بتسجيل أول إيراد أو مصروف من القائمة، أو استخدم «بيع سريع» من لوحة التحكم.' });
    }
    return list.slice(0, 5);
  }, [fin, invoices]);

  if (tips.length === 0) return null;

  return (
    <div className="card smart-insights-card">
      <h2 className="card-title">💡 رؤى ذكية</h2>
      <ul className="smart-insights-list">
        {tips.map((t, i) => (
          <li key={i} className={`insight insight-${t.type}`}>
            {t.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
