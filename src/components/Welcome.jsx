import { getAppBranding } from '../data/store';

export default function Welcome({ onEnter }) {
  const branding = getAppBranding();
  const appName = branding.appName || 'محاسب مشروعي';
  const tagline = branding.tagline || 'حساباتك بسهولة';

  return (
    <div className="welcome-screen">
      <div className="welcome-card">
        {branding.logoBase64 ? (
          <img src={branding.logoBase64} alt="" className="welcome-logo" />
        ) : (
          <div className="welcome-logo-placeholder">◈</div>
        )}
        <h1 className="welcome-title">{appName}</h1>
        <p className="welcome-tagline">{tagline}</p>
        <p className="welcome-desc">
          نظام محاسبة متكامل: مخزون، مبيعات، مصروفات، تقارير، عملاء، فواتير، موردين، موظفين.
        </p>
        <button type="button" className="btn-primary welcome-btn" onClick={onEnter}>
          الدخول للتطبيق
        </button>
      </div>
    </div>
  );
}
