import { useSubscription } from '../hooks/useSubscription';
import './SubscriptionBanner.css';

export default function SubscriptionBanner({ onGoToPricing }) {
  const { isTrial, isActive, isExpired, daysRemaining, loading } = useSubscription();

  if (loading) return null;

  if (isTrial) {
    return (
      <div className="subscription-banner subscription-banner--trial" role="status">
        <span>
          أنت الآن في الفترة التجريبية — متبقي <strong>{daysRemaining}</strong> يوم
        </span>
        {onGoToPricing && (
          <button type="button" className="subscription-banner-btn" onClick={onGoToPricing}>
            اشترك الآن
          </button>
        )}
      </div>
    );
  }

  // لا نعرض بانر "اشتراكك مفعّل" لتجنب إزعاج الواجهة.
  // التحذيرات (تجريبي/منتهي) تظل ظاهرة عند الحاجة.
  if (isActive) return null;

  if (isExpired) {
    return (
      <div className="subscription-banner subscription-banner--expired" role="alert">
        <span>انتهت الفترة التجريبية — التطبيق للعرض فقط حتى تجديد الاشتراك</span>
        {onGoToPricing && (
          <button type="button" className="subscription-banner-btn" onClick={onGoToPricing}>
            اشترك الآن
          </button>
        )}
      </div>
    );
  }

  return null;
}
