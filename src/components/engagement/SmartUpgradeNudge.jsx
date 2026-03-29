import { useMemo, useState, useCallback } from 'react';
import { TrendingUp, X } from 'lucide-react';
import AppButton from '../ui/AppButton';

function cn(...p) {
  return p.filter(Boolean).join(' ');
}

function todayKey() {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch {
    return 'day';
  }
}

/**
 * Contextual upgrade prompt after meaningful activity. Does not change billing logic — navigates to pricing only.
 */
export default function SmartUpgradeNudge({
  todaySalesCount,
  monthSalesCount = 0,
  onGoToPricing,
  showUpsell,
  className,
}) {
  const [dismissed, setDismissed] = useState(false);

  const message = useMemo(() => {
    if (todaySalesCount >= 10) {
      return {
        id: 'sales10',
        title: 'نشاط ممتاز اليوم',
        body: 'سجّلت أكثر من 10 مبيعات اليوم — افتح تقارير متقدمة وتصدير أوسع مع الاشتراك.',
      };
    }
    if (monthSalesCount >= 50) {
      return {
        id: 'month50',
        title: 'حجم عمل كبير هذا الشهر',
        body: 'تجاوزت 50 عملية بيع هذا الشهر — ترقية بسيطة تفتح لك أدوات احترافية للمتابعة.',
      };
    }
    return null;
  }, [todaySalesCount, monthSalesCount]);

  const storageKey = message ? `mahaseb_smart_nudge_${message.id}_${todayKey()}` : null;

  const visible = useMemo(() => {
    if (!showUpsell || dismissed || !message || !onGoToPricing || !storageKey) return false;
    try {
      if (localStorage.getItem(storageKey) === '1') return false;
    } catch (_) {}
    return true;
  }, [showUpsell, dismissed, message, onGoToPricing, storageKey]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      if (storageKey) localStorage.setItem(storageKey, '1');
    } catch (_) {}
  }, [storageKey]);

  if (!visible || !message) return null;

  return (
    <div
      className={cn(
        'relative rounded-2xl border border-amber-500/35 bg-gradient-to-l from-amber-950/50 to-[#111827] p-4 text-right shadow-lg md:p-5',
        className
      )}
      role="status"
    >
      <button
        type="button"
        className="absolute left-3 top-3 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        onClick={dismiss}
        aria-label="إخفاء"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-col gap-3 pr-6 sm:flex-row sm:items-center sm:justify-between sm:pr-0">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-200">
            <TrendingUp className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-amber-100 md:text-base">{message.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-300 md:text-sm">{message.body}</p>
          </div>
        </div>
        <AppButton type="button" variant="primary" size="md" className="shrink-0 self-stretch sm:self-center" onClick={onGoToPricing}>
          عرض الاشتراك
        </AppButton>
      </div>
    </div>
  );
}
