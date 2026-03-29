import { getSettings } from '../data/store';
import { normalizePhoneForWhatsApp } from '../data/store';
import './SubscriptionWhatsAppModal.css';

export default function SubscriptionWhatsAppModal({ open, onClose }) {
  if (!open) return null;
  const settings = getSettings();
  const whatsapp = (settings.whatsappContactNumber || '').trim();
  const whatsappUrl = whatsapp
    ? `https://wa.me/${normalizePhoneForWhatsApp(whatsapp)}?text=${encodeURIComponent('مرحباً، أريد تفعيل الاشتراك الشهري (150 ج.م) لمساحة العمل الخاصة بي.')}`
    : null;

  return (
    <div className="subscription-whatsapp-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="subscription-whatsapp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="subscription-whatsapp-modal-header">
          <h2 className="subscription-whatsapp-modal-title">تفعيل الاشتراك</h2>
          <button type="button" className="subscription-whatsapp-modal-close" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        <p className="subscription-whatsapp-modal-desc">
          لتفعيل الاشتراك تواصل معنا على واتساب. سنفعّل اشتراكك خلال 24 ساعة من استلام الدفع.
        </p>
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="subscription-whatsapp-modal-btn"
          >
            فتح واتساب
          </a>
        ) : (
          <p className="subscription-whatsapp-modal-no-phone">لم يُضبط رقم واتساب في الإعدادات.</p>
        )}
      </div>
    </div>
  );
}
