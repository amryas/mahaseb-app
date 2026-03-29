import { useState } from 'react';
import { useSubscription } from '../hooks/useSubscription';
import SubscriptionWhatsAppModal from './SubscriptionWhatsAppModal';
import PaymentProofUpload from './PaymentProofUpload';
import './Subscriptions.css';

const PLAN_MONTHLY = {
  id: 'monthly_150',
  name: 'الاشتراك الشهري',
  price: 150,
  period: 'شهر',
  features: [
    'إدارة مخزون كاملة',
    'تسجيل مبيعات غير محدود',
    'تقارير أرباح',
    'مزامنة سحابية',
  ],
};

export default function Subscriptions({ onToast }) {
  const { subscription, isTrial, isActive, isExpired, daysRemaining } = useSubscription();
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);

  const active = isActive || (isTrial && daysRemaining > 0);
  const expiryText = subscription?.subscription_end_date
    ? new Date(subscription.subscription_end_date).toLocaleDateString('ar-EG', { dateStyle: 'long' })
    : null;

  return (
    <>
      <h1 className="page-title">الاشتراك</h1>

      {active && (
        <div className="card subscription-status subscription-status--active">
          <p className="card-desc">
            <strong>اشتراكك مفعّل</strong>
            {isTrial && (
              <> — تجربة مجانية، متبقي <strong>{daysRemaining}</strong> يوم</>
            )}
            {isActive && expiryText && <> حتى {expiryText}</>}.
            يمكنك استخدام كل المميزات.
          </p>
        </div>
      )}

      {isExpired && (
        <div className="card subscription-status subscription-status--expired">
          <p className="card-desc">
            <strong>انتهت الفترة التجريبية.</strong> لتفعيل التعديلات والمبيعات والمصروفات، اشترك من البطاقة أدناه.
          </p>
        </div>
      )}

      <div className="card subscriptions-intro">
        <p className="card-desc">
          التفعيل يدوي: بعد اختيار الخطة تواصل معنا على واتساب. سنفعّل اشتراكك خلال 24 ساعة من استلام الدفع.
        </p>
      </div>

      <div className="subscription-plans subscription-plans--single">
        <div className="plan-card plan-card--monthly">
          <h2 className="plan-name">{PLAN_MONTHLY.name}</h2>
          <div className="plan-price">
            <span className="plan-amount">{PLAN_MONTHLY.price}</span>
            <span className="plan-currency">ج.م</span>
            <span className="plan-period">/ {PLAN_MONTHLY.period}</span>
          </div>
          <ul className="plan-features">
            {PLAN_MONTHLY.features.map((f) => (
              <li key={f}><span className="plan-check">✔</span> {f}</li>
            ))}
          </ul>
          {!active ? (
            <button
              type="button"
              className="btn-primary plan-btn"
              onClick={() => setWhatsappModalOpen(true)}
            >
              اشترك الآن
            </button>
          ) : (
            <p className="plan-active-badge">اشتراكك مفعّل</p>
          )}
        </div>
      </div>

      <PaymentProofUpload onToast={onToast} />
      <SubscriptionWhatsAppModal open={whatsappModalOpen} onClose={() => setWhatsappModalOpen(false)} />
    </>
  );
}
