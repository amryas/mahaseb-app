import { useSubscription } from '../hooks/useSubscription';
import AppButton from './ui/AppButton';

export default function TrialCountdownGlobalBanner({ onGoToPricing }) {
  const { loading, isTrial, isActive, isExpired, daysRemaining } = useSubscription();

  if (loading) return null;
  if (isActive || isExpired || !isTrial) return null;

  const warn = daysRemaining < 3;
  const text = `باقي ${daysRemaining} ${daysRemaining === 1 ? 'يوم' : 'أيام'} على انتهاء التجربة ${warn ? '⚠️' : ''}`;

  return (
    <div
      role="status"
      className={[
        'mx-4 mt-3 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm',
        warn
          ? 'border-rose-200 bg-rose-50 text-rose-900'
          : 'border-amber-200 bg-amber-50 text-amber-900',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{text}</span>
        {!!onGoToPricing && (
          <AppButton
            onClick={onGoToPricing}
            variant={warn ? 'danger' : 'primary'}
            className={warn ? '' : '!bg-amber-600 hover:!bg-amber-700 active:!bg-amber-800'}
          >
            تفعيل الاشتراك
          </AppButton>
        )}
      </div>
    </div>
  );
}

