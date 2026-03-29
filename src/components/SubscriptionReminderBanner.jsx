import { useSubscriptionReminder } from '../hooks/useSubscriptionReminder';
import './SubscriptionReminderBanner.css';

export default function SubscriptionReminderBanner({ onGoToPricing }) {
  const {
    showTrialWarning,
    showRenewWarning,
    showGraceWarning,
    graceDaysRemaining,
    daysRemaining,
    endDaysRemaining,
  } = useSubscriptionReminder();

  if (showGraceWarning) {
    return (
      <div className="subscription-reminder-banner subscription-reminder-banner--grace" role="status">
        <span>
          انتهى تاريخ الاشتراك — أنت في فترة سماح للكتابة
          {graceDaysRemaining != null && graceDaysRemaining >= 0 ? ` (متبقي تقريباً ${graceDaysRemaining} يوم)` : ''}
        </span>
        {onGoToPricing && (
          <button type="button" className="subscription-reminder-banner-btn" onClick={onGoToPricing}>
            تجديد الاشتراك
          </button>
        )}
      </div>
    );
  }

  if (showTrialWarning) {
    return (
      <div className="subscription-reminder-banner subscription-reminder-banner--trial-warning" role="status">
        <span>باقي أقل من 24 ساعة على انتهاء الفترة التجريبية</span>
        {onGoToPricing && (
          <button type="button" className="subscription-reminder-banner-btn" onClick={onGoToPricing}>
            صفحة الاشتراك
          </button>
        )}
      </div>
    );
  }

  if (showRenewWarning) {
    return (
      <div className="subscription-reminder-banner subscription-reminder-banner--renew-warning" role="status">
        <span>اشتراكك سينتهي قريبًا {endDaysRemaining != null && endDaysRemaining >= 0 ? `— متبقي ${endDaysRemaining} يوم` : ''}</span>
        {onGoToPricing && (
          <button type="button" className="subscription-reminder-banner-btn" onClick={onGoToPricing}>
            تجديد الاشتراك
          </button>
        )}
      </div>
    );
  }

  return null;
}
