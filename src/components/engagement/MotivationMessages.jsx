import { useMemo } from 'react';
import { Flame, Trophy } from 'lucide-react';

function cn(...p) {
  return p.filter(Boolean).join(' ');
}

/**
 * Lightweight positive feedback from data already on the dashboard (display only).
 */
export default function MotivationMessages({
  todaySales,
  todaySalesCount,
  profitTrend,
  last6Months,
  className,
}) {
  const lines = useMemo(() => {
    const out = [];

    if (Array.isArray(profitTrend) && profitTrend.length > 0 && todaySalesCount > 0 && todaySales > 0) {
      const salesVals = profitTrend.map((r) => Number(r.sales) || 0);
      const maxVal = Math.max(...salesVals);
      if (maxVal > 0 && todaySales >= maxVal - 0.01 && salesVals.some((v) => v < maxVal)) {
        out.push({
          key: 'best-period',
          icon: Trophy,
          text: '🏆 أفضل مبيعات لك في الفترة المعروضة على الرسم — أداء ممتاز!',
          tone: 'emerald',
        });
      }
    }

    if (Array.isArray(last6Months) && last6Months.length >= 2) {
      const cur = last6Months[last6Months.length - 1];
      const prev = last6Months[last6Months.length - 2];
      const s0 = Number(prev?.sales) || 0;
      const s1 = Number(cur?.sales) || 0;
      if (s0 > 0 && s1 > s0 * 1.15) {
        out.push({
          key: 'growth',
          icon: Flame,
          text: '🔥 عمل رائع! مبيعات هذا الشهر أعلى بشكل ملحوظ من السابق.',
          tone: 'orange',
        });
      }
    }

    if (todaySalesCount >= 5 && out.length === 0) {
      out.push({
        key: 'busy-day',
        icon: Flame,
        text: '🔥 يوم حافل — أكثر من 5 طلبات اليوم. أحسنت تنظيم العمل!',
        tone: 'teal',
      });
    }

    return out.slice(0, 2);
  }, [profitTrend, last6Months, todaySales, todaySalesCount]);

  if (lines.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {lines.map((row) => {
        const Icon = row.icon;
        const border =
          row.tone === 'emerald'
            ? 'border-emerald-500/30 bg-emerald-950/25'
            : row.tone === 'orange'
              ? 'border-orange-500/30 bg-orange-950/20'
              : 'border-saas-primary/30 bg-saas-primary/10';
        return (
          <div
            key={row.key}
            className={cn('flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium text-gray-100', border)}
          >
            <Icon className="h-5 w-5 shrink-0 text-saas-primary" aria-hidden />
            <span>{row.text}</span>
          </div>
        );
      })}
    </div>
  );
}
