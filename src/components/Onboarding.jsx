import { getProducts, getSales } from '../data/store';
import { PackagePlus, ShoppingCart, ReceiptText, Sparkles } from 'lucide-react';
import './Onboarding.css';

const ONBOARDING_KEY = 'mahaseb_onboarding_done';

export function shouldShowOnboarding() {
  try {
    const done = localStorage.getItem(ONBOARDING_KEY);
    return done !== 'true' && done !== '1';
  } catch {
    return false;
  }
}

export function dismissOnboarding() {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch (_) {}
}

export default function Onboarding({ onFirstStep, onDismiss }) {
  const products = getProducts();
  const sales = getSales();
  const hasProducts = products.length > 0;
  const hasSales = sales.length > 0;

  const go = (target) => {
    dismissOnboarding();
    onFirstStep?.(target);
  };

  const skip = () => {
    dismissOnboarding();
    onDismiss?.();
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-icon" aria-hidden>
          <Sparkles className="onboarding-sparkle-icon" strokeWidth={2} />
        </div>
        <h2 className="onboarding-title">مرحباً بك في محاسب مشروعي</h2>
        <p className="onboarding-text onboarding-subtitle">
          لنبدأ بخطوتين أساسيتين — ثم يمكنك تسجيل مصروف لمتابعة الأرباح والتقارير. بياناتك تُزامن مع السحابة عند تفعيل الحساب.
        </p>

        {!hasProducts && (
          <p className="onboarding-hint">ابدأ بإضافة منتج واحد على الأقل.</p>
        )}
        {hasProducts && !hasSales && (
          <p className="onboarding-hint">ممتاز — لديك منتجات. سجّل أول بيعة الآن.</p>
        )}
        {hasProducts && hasSales && (
          <p className="onboarding-hint">رائع! يمكنك تسجيل مصروف أو الانتقال للوحة التحكم.</p>
        )}

        <div className="onboarding-cta-grid">
          <button type="button" className="onboarding-cta onboarding-cta-primary" onClick={() => go('products')}>
            <PackagePlus className="onboarding-cta-icon" strokeWidth={2} aria-hidden />
            <span className="onboarding-cta-label">أضف أول منتج</span>
            <span className="onboarding-cta-sub">فتح المخزون</span>
          </button>
          <button type="button" className="onboarding-cta onboarding-cta-primary" onClick={() => go('sales')}>
            <ShoppingCart className="onboarding-cta-icon" strokeWidth={2} aria-hidden />
            <span className="onboarding-cta-label">أنشئ أول بيعة</span>
            <span className="onboarding-cta-sub">فتح البيع</span>
          </button>
          <button type="button" className="onboarding-cta onboarding-cta-secondary" onClick={() => go('expense')}>
            <ReceiptText className="onboarding-cta-icon" strokeWidth={2} aria-hidden />
            <span className="onboarding-cta-label">سجّل أول مصروف</span>
            <span className="onboarding-cta-sub">المصروفات</span>
          </button>
        </div>

        <div className="onboarding-actions">
          <button type="button" className="btn-secondary btn-onboarding-skip" onClick={() => go('dashboard')}>
            الانتقال للوحة التحكم
          </button>
          <button type="button" className="btn-onboarding-skip-text" onClick={skip}>
            تخطي ولن تُعرض هذه النافذة مرة أخرى
          </button>
        </div>
      </div>
    </div>
  );
}
