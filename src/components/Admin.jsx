import { useState, useEffect } from 'react';
import { getAppBranding, saveAppBranding, getAdminPin, setAdminPin } from '../data/store';
import { isCurrentUserAdmin } from '../data/adminApi';
import { isSupabaseEnabled } from '../supabase/config';
import AdminDashboard from './admin/AdminDashboard';

export default function Admin({ onLogin, isLoggedIn, onToast, onBrandingSaved }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [appName, setAppName] = useState('');
  const [tagline, setTagline] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [bannerPreview, setBannerPreview] = useState('');
  const [newPin, setNewPin] = useState('');
  const [saved, setSaved] = useState(false);
  const [adminCheckDone, setAdminCheckDone] = useState(false);

  useEffect(() => {
    if (adminCheckDone || !isSupabaseEnabled()) {
      setAdminCheckDone(true);
      return;
    }
    isCurrentUserAdmin().then((ok) => {
      setAdminCheckDone(true);
      if (ok) onLogin(true);
    });
  }, [adminCheckDone, onLogin]);

  useEffect(() => {
    if (isLoggedIn) {
      const b = getAppBranding();
      setAppName(b.appName || '');
      setTagline(b.tagline || '');
      setLogoPreview(b.logoBase64 || '');
      setBannerPreview(b.bannerBase64 || '');
    }
  }, [isLoggedIn]);

  const handleLogoChange = (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setLogoPreview(r.result);
    r.readAsDataURL(f);
  };

  const handleBannerChange = (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setBannerPreview(r.result);
    r.readAsDataURL(f);
  };

  const handleSave = (e) => {
    e.preventDefault();
    saveAppBranding({
      appName: appName.trim() || 'محاسب مشروعي',
      tagline: tagline.trim() || 'حساباتك بسهولة',
      logoBase64: logoPreview || '',
      bannerBase64: bannerPreview || '',
    });
    if (newPin.trim().length >= 4) {
      setAdminPin(newPin.trim());
      setNewPin('');
    }
    setSaved(true);
    onToast?.('تم حفظ التعديلات');
    onBrandingSaved?.();
    setTimeout(() => setSaved(false), 3000);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (pin === getAdminPin()) {
      setError('');
      onLogin(true);
    } else {
      setError('كلمة المرور غير صحيحة');
    }
  };

  const handleLogout = () => {
    onLogin(false);
    setPin('');
  };

  if (!adminCheckDone && isSupabaseEnabled()) {
    return <div className="page-loading">جاري التحقق...</div>;
  }

  if (!isLoggedIn) {
    return (
      <>
        <h1 className="page-title">دخول الأدمن</h1>
        <div className="card admin-login-card">
          <h2 className="card-title">لوحة التحكم للإدارة</h2>
          <p className="card-desc">أدخل كلمة مرور الأدمن للدخول أو سجّل الدخول بحساب أدمن في التطبيق.</p>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>كلمة المرور</label>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="كلمة مرور الأدمن"
                autoComplete="off"
              />
            </div>
            {error && <div className="message message-error">{error}</div>}
            <button type="submit" className="btn-primary">دخول</button>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="card admin-branding-card">
        <h2 className="card-title">المظهر والعلامة التجارية</h2>
        <p className="card-desc">عدّل اسم التطبيق، الشعار، وصورة البانر.</p>
        <form onSubmit={handleSave}>
          <div className="form-row">
            <div className="form-group">
              <label>اسم التطبيق</label>
              <input type="text" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="محاسب مشروعي" />
            </div>
            <div className="form-group">
              <label>العنوان الفرعي</label>
              <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="حساباتك بسهولة" />
            </div>
          </div>
          <div className="form-group">
            <label>لوجو</label>
            <input type="file" accept="image/*" onChange={handleLogoChange} className="file-input" />
            {logoPreview && (
              <div className="admin-image-preview">
                <img src={logoPreview} alt="لوجو" />
                <button type="button" className="btn-danger btn-sm" onClick={() => setLogoPreview('')}>إزالة</button>
              </div>
            )}
          </div>
          <div className="form-group">
            <label>بانر لوحة التحكم</label>
            <input type="file" accept="image/*" onChange={handleBannerChange} className="file-input" />
            {bannerPreview && (
              <div className="admin-image-preview banner">
                <img src={bannerPreview} alt="بانر" />
                <button type="button" className="btn-danger btn-sm" onClick={() => setBannerPreview('')}>إزالة</button>
              </div>
            )}
          </div>
          <div className="form-group">
            <label>كلمة مرور الأدمن (اختياري)</label>
            <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="4 أحرف على الأقل" autoComplete="new-password" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary">حفظ التعديلات</button>
            {saved && <span className="save-success">تم الحفظ</span>}
          </div>
        </form>
      </div>

      {isSupabaseEnabled() && (
        <AdminDashboard onToast={onToast} onLogout={handleLogout} />
      )}
    </>
  );
}
