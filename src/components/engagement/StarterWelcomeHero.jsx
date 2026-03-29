import { PackagePlus, ShoppingCart, ReceiptText, Sparkles } from 'lucide-react';
import AppButton from '../ui/AppButton';

function cn(...p) {
  return p.filter(Boolean).join(' ');
}

/**
 * Friendly empty-state hero when workspace has no products, sales, or expenses yet.
 */
export default function StarterWelcomeHero({ onAddProduct, onCreateSale, onAddExpense, className }) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-saas-primary/30 bg-gradient-to-br from-[#111827] via-[#0f1624] to-[#111827] p-6 text-white shadow-xl shadow-saas-primary/10 md:p-8',
        className
      )}
    >
      <div className="pointer-events-none absolute -left-20 -top-20 h-40 w-40 rounded-full bg-saas-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -right-16 h-36 w-36 rounded-full bg-teal-500/10 blur-3xl" />

      <div className="relative text-right">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-gray-300">
          <Sparkles className="h-3.5 w-3.5 text-saas-primary" aria-hidden />
          بداية جديدة
        </div>
        <h2 className="mt-4 text-xl font-black tracking-tight text-white md:text-2xl">مرحباً — لنضبط محاسبتك في دقائق</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-400">
          أضف منتجاً واحداً وسجّل أول بيعة؛ يمكنك أيضاً تسجيل مصروف لرؤية الصورة الكاملة على لوحة التحكم.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <AppButton
            type="button"
            variant="primary"
            size="lg"
            className="w-full justify-center sm:w-auto sm:min-w-[200px]"
            onClick={onAddProduct}
          >
            <PackagePlus className="h-5 w-5" aria-hidden />
            أضف أول منتج
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            size="lg"
            className="w-full justify-center border-saas-primary/40 sm:w-auto sm:min-w-[200px]"
            onClick={onCreateSale}
          >
            <ShoppingCart className="h-5 w-5 text-saas-primary" aria-hidden />
            أنشئ أول بيعة
          </AppButton>
          <AppButton
            type="button"
            variant="outline"
            size="lg"
            className="w-full justify-center sm:w-auto sm:min-w-[200px]"
            onClick={onAddExpense}
          >
            <ReceiptText className="h-5 w-5" aria-hidden />
            سجّل أول مصروف
          </AppButton>
        </div>
      </div>
    </section>
  );
}
