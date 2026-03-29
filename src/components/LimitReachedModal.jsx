/**
 * نافذة تظهر عند الوصول للحد الأقصى في الفترة التجريبية.
 */
import './SubscriptionExpiredModal.css';

export default function LimitReachedModal({ open, onClose, onGoToSubscription }) {
  if (!open) return null;

  const handleGo = () => {
    onClose?.();
    onGoToSubscription?.();
  };

  return (
    <div className="subscription-expired-overlay" role="dialog" aria-modal="true" aria-labelledby="limit-modal-title">
      <div className="subscription-expired-modal">
        <h2 id="limit-modal-title" className="subscription-expired-modal-title">الحد الأقصى للاستخدام</h2>
        <p className="subscription-expired-modal-desc">
          لقد وصلت للحد الأقصى في الفترة التجريبية — اشترك الآن للاستمرار
        </p>
        <div className="subscription-expired-modal-actions">
          <button type="button" className="subscription-expired-modal-cta" onClick={handleGo}>
            اشترك الآن
          </button>
          <button type="button" className="subscription-expired-modal-secondary" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
