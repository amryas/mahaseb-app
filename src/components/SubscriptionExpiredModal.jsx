import { setExpiredPopupShown } from '../hooks/useSubscriptionReminder';
import './SubscriptionExpiredModal.css';

export default function SubscriptionExpiredModal({ open, onClose, onGoToPricing }) {
  if (!open) return null;

  const handleClose = () => {
    setExpiredPopupShown();
    onClose?.();
  };

  const handleGoToPricing = () => {
    setExpiredPopupShown();
    onClose?.();
    onGoToPricing?.();
  };

  return (
    <div className="subscription-expired-overlay" role="dialog" aria-modal="true" aria-labelledby="expired-modal-title">
      <div className="subscription-expired-modal">
        <h2 id="expired-modal-title" className="subscription-expired-modal-title">انتهت الفترة التجريبية</h2>
        <p className="subscription-expired-modal-desc">
          اشترك الآن لاستمرار استخدام كل المميزات: إدارة المخزون، المبيعات، والتقارير.
        </p>
        <div className="subscription-expired-modal-actions">
          <button type="button" className="subscription-expired-modal-cta" onClick={handleGoToPricing}>
            اشترك الآن
          </button>
          <button type="button" className="subscription-expired-modal-secondary" onClick={handleClose}>
            لاحقاً
          </button>
        </div>
      </div>
    </div>
  );
}
