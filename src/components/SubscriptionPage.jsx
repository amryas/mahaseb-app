import { useMemo, useState } from 'react';
import { CheckCircle2, Lock, ShieldCheck, MessageCircle, BadgeCheck, Sparkles } from 'lucide-react';
import { useTrialCountdown } from '../hooks/useTrialCountdown';
import { useSubscription } from '../hooks/useSubscription';
import PaymentProofModal from './PaymentProofModal';
import SubscriptionWhatsAppModal from './SubscriptionWhatsAppModal';
import AppButton from './ui/AppButton';
import SectionHeader from './ui/SectionHeader';

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

const surfaceCard =
  'rounded-2xl border border-white/10 bg-[#111827] p-5 text-white shadow-lg shadow-black/30 transition-all duration-200';

export default function SubscriptionPage({ onToast }) {
  const { loading, isTrial, isExpired, daysRemaining, hoursRemaining, progressPct, warning } = useTrialCountdown();
  const { canWrite } = useSubscription();
  const [proofOpen, setProofOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);

  const headline = useMemo(() => {
    if (loading) return 'جاري تحميل الاشتراك…';
    if (isTrial && !isExpired) {
      return `باقي ${daysRemaining} يوم على انتهاء التجربة`;
    }
    if (isExpired || !canWrite) return 'انتهت التجربة — اشترك للتفعيل';
    return 'اشتراكك مفعّل';
  }, [loading, isTrial, isExpired, daysRemaining, canWrite]);

  const subText = useMemo(() => {
    if (loading) return 'لحظة…';
    if (isTrial && !isExpired) return `متبقي تقريباً ${formatInt(hoursRemaining)} ساعة.`;
    if (isExpired || !canWrite) return 'يمكنك العرض؛ التعديل يحتاج تفعيل.';
    return 'كل المميزات متاحة.';
  }, [loading, isTrial, isExpired, hoursRemaining, canWrite]);

  const features = [
    'منتجات بدون حد',
    'مبيعات ومصروفات',
    'تقارير PDF و Excel',
    'بدون إنترنت + مزامنة',
  ];

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-8 pb-6">
      <PaymentProofModal open={proofOpen} onClose={() => setProofOpen(false)} onToast={onToast} />
      <SubscriptionWhatsAppModal open={waOpen} onClose={() => setWaOpen(false)} />

      <SectionHeader title="الاشتراك" subtitle="خطوة واحدة للتفعيل" />

      {/* Trial Countdown */}
      <section className={cn(surfaceCard, warning ? 'border-amber-500/40' : '')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">{headline}</h1>
            <p className="mt-1 text-sm text-gray-400">{subText}</p>
          </div>
          <span
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-200',
              warning ? 'border-amber-500/40 bg-amber-950/40 text-amber-200' : 'border-white/10 bg-white/5 text-gray-300'
            )}
          >
            {isExpired || !canWrite ? <Lock className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </span>
        </div>

        {isTrial && !isExpired && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-gray-400">
              <span>التجربة</span>
              <span className={warning ? 'text-amber-300' : 'text-gray-300'}>{Math.round(progressPct)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={cn('h-full rounded-full transition-all duration-200', warning ? 'bg-amber-500' : 'bg-saas-primary')}
                style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
              />
            </div>
            {warning && (
              <p className="text-xs text-amber-200">اقترب انتهاء التجربة — أرسل إثبات الدفع لتفادي التفعيل.</p>
            )}
          </div>
        )}
      </section>

      {/* Pricing Card */}
      <section className={cn('relative', surfaceCard)}>
        <div className="absolute -top-2.5 left-4 rounded-full bg-saas-primary px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-md shadow-saas-primary/25">
          الأكثر استخداماً
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-gray-400">شهريًا</div>
          <div className="mt-1 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            150 <span className="text-base font-semibold text-gray-400">ج.م</span>
          </div>
        </div>

        <ul className="mt-6 space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-gray-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-saas-primary" />
              {f}
            </li>
          ))}
        </ul>

        {(isExpired || !canWrite) && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#0B0F19]/85 p-4 backdrop-blur-md">
            <div className="w-full max-w-sm rounded-xl border border-rose-500/35 bg-rose-950/50 p-4 text-center shadow-lg shadow-black/40">
              <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-950/40">
                <Lock className="h-5 w-5 text-rose-300" />
              </div>
              <p className="mt-2 text-sm font-semibold text-rose-100">التعديل مقفول بعد انتهاء التجربة</p>
              <p className="mt-1 text-xs text-rose-200">أرسل إثبات الدفع لإعادة التفعيل.</p>
              <AppButton className="mt-4 w-full" variant="danger" size="lg" onClick={() => setProofOpen(true)}>
                📤 إرسال إثبات الدفع
              </AppButton>
            </div>
          </div>
        )}
      </section>

      {/* Payment Methods */}
      <section className={surfaceCard}>
        <h2 className="text-sm font-bold text-white">الدفع</h2>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm">
            <span className="font-medium text-gray-300">فودافون كاش</span>
            <span dir="ltr" className="font-semibold tabular-nums text-white">
              01080697611
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm">
            <span className="font-medium text-gray-300">InstaPay</span>
            <span dir="ltr" className="font-semibold tabular-nums text-white">
              01149490291
            </span>
          </div>
          <ol className="space-y-2 rounded-lg border border-dashed border-white/15 bg-[#1f2937]/60 px-4 py-3 text-sm text-gray-300">
            <li>
              <span className="font-semibold text-white">1.</span> حوّل المبلغ
            </li>
            <li>
              <span className="font-semibold text-white">2.</span> اضغط «إرسال إثبات الدفع»
            </li>
            <li>
              <span className="font-semibold text-white">3.</span> التفعيل خلال دقائق
            </li>
          </ol>
        </div>
      </section>

      {/* Trust */}
      <section className={surfaceCard}>
        <h2 className="text-sm font-bold text-white">طمأنينة</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <div className="text-sm font-semibold text-white">ضمان 7 أيام</div>
            <p className="mt-1 text-xs text-gray-400">استرجاع إن لم يناسبك.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <div className="text-sm font-semibold text-white">بياناتك آمنة</div>
            <p className="mt-1 text-xs text-gray-400">مزامنة + حساب محمي.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <div className="text-sm font-semibold text-white">إلغاء في أي وقت</div>
            <p className="mt-1 text-xs text-gray-400">بدون تعقيد.</p>
          </div>
        </div>
      </section>

      {/* Primary CTA */}
      <div className="space-y-3">
        <AppButton className="w-full py-3.5 text-base" size="lg" onClick={() => setProofOpen(true)}>
          📤 إرسال إثبات الدفع
        </AppButton>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> بدون إنترنت
          </span>
          <span className="inline-flex items-center gap-1">
            <BadgeCheck className="h-3.5 w-3.5" /> مزامنة
          </span>
          <button type="button" className="inline-flex items-center gap-1 font-medium text-saas-primary hover:text-saas-primary-hover hover:underline" onClick={() => setWaOpen(true)}>
            <MessageCircle className="h-3.5 w-3.5" /> واتساب
          </button>
        </div>
      </div>

      {loading && (
        <div className={cn(surfaceCard, 'animate-pulse')}>
          <div className="h-4 w-40 rounded bg-white/10" />
          <div className="mt-3 h-10 w-full rounded bg-white/10" />
        </div>
      )}
    </div>
  );
}
