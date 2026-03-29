import { useState, useEffect } from 'react';
import {
  getSettings, saveSettings, getCapital, saveCapital, getCurrentAccountId,
  getProducts, getSales, getTransactions, getClients, getInvoices,
} from '../data/store';
import { getFriendlyErrorMessage, logError } from '../utils/userErrorHandler';
import { useAuth } from '../contexts/AuthContext';
import { isSupabaseEnabled } from '../supabase/config';
import { loadAccountsForUser, getLastSyncSetupError } from '../data/supabaseSync';
import { processSyncQueue } from '../data/syncQueue';
import { isCurrentUserAdmin } from '../data/adminApi';
import WhatsAppSettingsSection from './WhatsAppSettingsSection';
import { downloadBlob } from '../utils/downloadHelper';
import SectionHeader from './ui/SectionHeader';

export default function Settings({ onSave, onNavigate, onToast }) {
  const { user, firebaseEnabled, authEnabled, signOut } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyTaxNumber, setCompanyTaxNumber] = useState('');
  const [salesTargetMonthly, setSalesTargetMonthly] = useState('');
  const [whatsappContactNumber, setWhatsappContactNumber] = useState('');
  const [defaultProfitMargin, setDefaultProfitMargin] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [suggestPriceFromCost, setSuggestPriceFromCost] = useState(true);
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState('');
  const [whatsappVerifyToken, setWhatsappVerifyToken] = useState('');
  const [capitalAmount, setCapitalAmount] = useState('');
  const [saved, setSaved] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setSetupError(getLastSyncSetupError());
  }, []);

  useEffect(() => {
    if (isSupabaseEnabled() && user?.id) {
      isCurrentUserAdmin().then(setIsAdmin);
    } else {
      setIsAdmin(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const s = getSettings();
    const cap = getCapital();
    setCapitalAmount(cap?.amount ? String(cap.amount) : '');
    setCompanyName(s.companyName || '');
    setCompanyAddress(s.companyAddress || '');
    setCompanyTaxNumber(s.companyTaxNumber || '');
    setSalesTargetMonthly(s.salesTargetMonthly ? String(s.salesTargetMonthly) : '');
    setWhatsappContactNumber(s.whatsappContactNumber || '');
    setDefaultProfitMargin(s.defaultProfitMargin != null ? String(s.defaultProfitMargin) : '');
    setNotificationsEnabled(s.notificationsEnabled !== false);
    setSuggestPriceFromCost(s.suggestPriceFromCost !== false);
    setWhatsappPhoneNumberId(s.whatsappPhoneNumberId || '');
    setWhatsappVerifyToken(s.whatsappVerifyToken || '');
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const cap = capitalAmount.trim() ? Number(capitalAmount) : 0;
    if (cap >= 0) saveCapital({ amount: cap });
    saveSettings({
      ...getSettings(),
      companyName: companyName.trim(),
      companyAddress: companyAddress.trim(),
      companyTaxNumber: companyTaxNumber.trim(),
      salesTargetMonthly: salesTargetMonthly.trim() ? Number(salesTargetMonthly) : 0,
      whatsappContactNumber: whatsappContactNumber.trim(),
      defaultProfitMargin: defaultProfitMargin.trim() ? Number(defaultProfitMargin) : 0,
      notificationsEnabled: notificationsEnabled,
      suggestPriceFromCost: suggestPriceFromCost,
      whatsappPhoneNumberId: whatsappPhoneNumberId.trim(),
      whatsappVerifyToken: whatsappVerifyToken.trim(),
    });
    setSaved(true);
    onSave?.();
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <>
      <SectionHeader title="الإعدادات" subtitle="إدارة بيانات المشروع والتكاملات والنسخ الاحتياطي." />

      {isSupabaseEnabled() && (
        <div className="card settings-card supabase-status" style={{ marginBottom: '1rem', background: 'var(--success-bg, #e8f5e9)', border: '1px solid var(--success-border, #4caf50)' }}>
          <strong>Supabase متصل</strong>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', opacity: 0.9 }}>
            البيانات تُحفظ تلقائياً في السحابة. إذا لم تظهر البيانات في Supabase، اضغط «تحديث الاتصال ومزامنة الآن».
          </p>
          {user?.id && (
            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true);
                  try {
                    await new Promise((resolve) => {
                      loadAccountsForUser(user.id, async () => {
                        await processSyncQueue();
                        resolve();
                      });
                    });
                    const wid = getCurrentAccountId();
                    const err = getLastSyncSetupError();
                    setSetupError(err);
                    const failMsg = err ? getFriendlyErrorMessage(new Error(err)) : 'لم يتم ربط مساحة عمل. تحقق من الاتصال.';
                    onToast?.(wid ? 'تم تحديث الاتصال بالسحابة. جرّب حفظ مخزون أو بيع مرة أخرى.' : failMsg, wid ? 'success' : 'error');
                  } catch (e) {
                    logError(e, 'Settings sync');
                    onToast?.(getFriendlyErrorMessage(e), 'error');
                  }
                  setSyncing(false);
                }}
              >
                {syncing ? 'جاري التحديث...' : 'تحديث الاتصال ومزامنة الآن'}
              </button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="card settings-card">
          <h2 className="card-title">إعدادات عامة</h2>
          <div className="form-group">
            <label>اسم الشركة أو المشروع</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="مثال: شركة النور، محل محمد"
            />
          </div>
          <div className="form-group">
            <label>رقم واتساب للتواصل</label>
            <input
              type="tel"
              value={whatsappContactNumber}
              onChange={(e) => setWhatsappContactNumber(e.target.value)}
              placeholder="01xxxxxxxx"
              dir="ltr"
            />
          </div>
          <div className="form-group">
            <label>رأس المال (ج.م)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={capitalAmount}
              onChange={(e) => setCapitalAmount(e.target.value)}
              placeholder="مبلغ رأس المال عند البدء"
            />
          </div>
          <div className="form-group">
            <label>هدف مبيعات الشهر (اختياري)</label>
            <input
              type="number"
              min="0"
              step="100"
              value={salesTargetMonthly}
              onChange={(e) => setSalesTargetMonthly(e.target.value)}
              placeholder="اتركه فارغاً إن لم تستخدم"
            />
          </div>
          <div className="form-group">
            <label>نسبة ربح افتراضي (%) لاقتراح السعر</label>
            <input
              type="number"
              min="0"
              max="500"
              step="5"
              value={defaultProfitMargin}
              onChange={(e) => setDefaultProfitMargin(e.target.value)}
              placeholder="مثال: 25"
            />
          </div>
          <div className="form-group form-group-checkbox">
            <label>
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
              />
              تفعيل التنبيهات (نقص مخزون، مستحقات، بيع بخسارة)
            </label>
          </div>
          <div className="form-group form-group-checkbox">
            <label>
              <input
                type="checkbox"
                checked={suggestPriceFromCost}
                onChange={(e) => setSuggestPriceFromCost(e.target.checked)}
              />
              إظهار سعر مقترح من التكلفة عند البيع
            </label>
          </div>
        </div>

        <WhatsAppSettingsSection onToast={onToast} />

        <div className="settings-advanced-wrap">
          <button type="button" className="btn-secondary" onClick={() => setAdvancedOpen((o) => !o)} aria-expanded={advancedOpen}>
            {advancedOpen ? '▼ إخفاء' : '▶ للمحاسبين ومتقدم'}
          </button>
          {advancedOpen && (
            <>
              <div className="card settings-card">
                <h2 className="card-title">بيانات إضافية للفواتير والضرائب</h2>
                <div className="form-group">
                  <label>عنوان الشركة</label>
                  <input
                    type="text"
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                    placeholder="العنوان الكامل"
                  />
                </div>
                <div className="form-group">
                  <label>الرقم الضريبي / السجل التجاري</label>
                  <input
                    type="text"
                    value={companyTaxNumber}
                    onChange={(e) => setCompanyTaxNumber(e.target.value)}
                    placeholder="اختياري"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="card settings-card">
                <h2 className="card-title">واتساب بيزنس (لاستقبال الطلبات)</h2>
                <div className="form-group">
                  <label>معرف رقم الهاتف (Phone Number ID)</label>
                  <input
                    type="text"
                    value={whatsappPhoneNumberId}
                    onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                    placeholder="من لوحة Meta"
                    dir="ltr"
                  />
                </div>
                <div className="form-group">
                  <label>رمز التحقق (Verify Token)</label>
                  <input
                    type="text"
                    value={whatsappVerifyToken}
                    onChange={(e) => setWhatsappVerifyToken(e.target.value)}
                    placeholder="للويب هوك"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="card settings-card">
                <h2 className="card-title">أدوات إضافية</h2>
                <div className="settings-tool-links">
                  <button type="button" className="btn-tool-link" onClick={() => onNavigate?.('importExcel')}>
                    📥 استيراد من Excel
                  </button>
                  <button type="button" className="btn-tool-link" onClick={() => onNavigate?.('backup')}>
                    💾 نسخ احتياطي
                  </button>
                  <button
                    type="button"
                    className="btn-tool-link"
                    onClick={() => {
                      try {
                        const wid = getCurrentAccountId();
                        const payload = {
                          exportedAt: new Date().toISOString(),
                          workspaceId: wid || null,
                          products: getProducts(),
                          sales: getSales(),
                          transactions: getTransactions(),
                          clients: getClients(),
                          invoices: getInvoices(),
                        };
                        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
                        downloadBlob(blob, `backup_${wid || 'workspace'}.json`);
                        onToast?.('تم تصدير النسخة الاحتياطية بنجاح');
                      } catch (e) {
                        onToast?.('تعذر تصدير النسخة الاحتياطية', 'error');
                      }
                    }}
                  >
                    ⬇️ تصدير نسخة احتياطية
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="form-actions form-actions-sticky">
          <button type="submit" className="btn-primary">حفظ كل الإعدادات</button>
          {saved && <span className="save-success">تم الحفظ</span>}
        </div>
      </form>

      <div className="card settings-card">
        <h2 className="card-title">حلول سريعة لمشاكل شائعة</h2>
        <ul className="help-list">
          <li><strong>البيانات اختفت؟</strong> تأكد من الاتصال بالسحابة (إن كان مفعّلاً) أو استخدم «نسخ احتياطي» لاسترجاع نسخة سابقة.</li>
          <li><strong>لا أرى المنتجات في البيع؟</strong> أضف منتجات من صفحة «المخزون» أولاً ثم ارجع لصفحة «البيع».</li>
          <li><strong>نسيت أو أردت استرجاع بيانات؟</strong> استخدم «نسخ احتياطي» لتصدير نسخة، و«استعادة» لاسترجاعها لاحقاً.</li>
          <li><strong>أريد ملف Excel للعميل؟</strong> من صفحة «التقارير والكشف اليومي» استخدم زر «تصدير كل العمليات (Excel / CSV)».</li>
        </ul>
      </div>

      {authEnabled && (
        <div className="card settings-card">
          <h2 className="card-title">الحساب السحابي</h2>
          <p className="card-desc">بياناتك متزامنة مع السحابة. تسجيل الخروج لا يحذف البيانات.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button type="button" className="btn-danger" onClick={() => signOut()}>
              تسجيل الخروج
            </button>
            {isSupabaseEnabled() && isAdmin && (
              <button type="button" className="btn-secondary" onClick={() => onNavigate?.('admin')}>
                لوحة الأدمن
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
