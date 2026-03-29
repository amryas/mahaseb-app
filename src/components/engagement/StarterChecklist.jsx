import { Check } from 'lucide-react';

function cn(...p) {
  return p.filter(Boolean).join(' ');
}

/**
 * UI-only starter checklist with progress. Parent supplies completion flags and navigation.
 */
export default function StarterChecklist({ hasProduct, hasSale, hasExpense, className }) {
  const items = [
    { done: hasProduct, label: 'إضافة منتج' },
    { done: hasSale, label: 'تسجيل بيع' },
    { done: hasExpense, label: 'تسجيل مصروف' },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  const complete = doneCount === items.length;

  if (complete) return null;

  return (
    <section
      className={cn(
        'rounded-2xl border border-white/10 bg-[#111827] p-5 text-white shadow-lg shadow-black/30 md:p-6',
        className
      )}
      aria-label="خطوات البداية"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white md:text-lg">بداية سريعة</h2>
          <p className="mt-1 text-sm text-gray-400">أكمل الخطوات الثلاث لتستفيد من التقارير والمؤشرات.</p>
        </div>
        <div className="text-left sm:text-right">
          <span className="text-2xl font-black tabular-nums text-saas-primary">{pct}%</span>
          <p className="text-xs text-gray-400">مكتمل</p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-saas-primary transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li
            key={item.label}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all duration-200',
              item.done ? 'border-saas-primary/40 bg-saas-primary/10 text-gray-100' : 'border-white/10 bg-white/[0.04] text-gray-300'
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                item.done ? 'bg-saas-primary text-saas-shell' : 'bg-white/10 text-gray-500'
              )}
            >
              {item.done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <span className="text-xs font-bold opacity-70">○</span>}
            </span>
            <span className={cn('font-semibold', item.done && 'line-through opacity-80')}>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
