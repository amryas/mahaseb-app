import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Clock, Phone, ShieldCheck } from 'lucide-react';
import { useWhatsAppReportSettings, maybeSendDailyWhatsAppReport } from '../hooks/useWhatsAppReportSettings';

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function WhatsAppSettingsSection({ onToast }) {
  const s = useWhatsAppReportSettings();
  const [copied, setCopied] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);

  const helper = useMemo(() => {
    if (!s.enabled) return 'عند التفعيل، سيتم إرسال تقرير اليوم تلقائياً بعد الوقت المحدد عند فتح التطبيق أو بعد المزامنة.';
    if (s.error) return s.error;
    return 'مفعّل. سيُرسل مرة واحدة يومياً فقط (بدون تكرار).';
  }, [s.enabled, s.error]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="card settings-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageCircle size={18} />
            تقرير واتساب اليومي
          </h2>
          <p className="card-desc">ملخص بسيط للمبيعات والربح والمصروفات يُرسل تلقائياً مرة يومياً.</p>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: s.enabled ? 'var(--income)' : 'var(--text-muted)' }}>
            {s.enabled ? 'مفعّل' : 'متوقف'}
          </span>
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => s.setEnabled(e.target.checked)}
            aria-label="تفعيل تقرير واتساب اليومي"
          />
        </label>
      </div>

      <div className={cn('mt-3', !s.enabled ? 'opacity-60' : '')} style={{ pointerEvents: s.enabled ? 'auto' : 'none' }}>
        <div className="form-row">
          <div className="form-group">
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Phone size={16} /> رقم واتساب لاستقبال التقرير
            </label>
            <input
              type="tel"
              value={s.phoneRaw}
              onChange={(e) => s.setPhoneRaw(e.target.value)}
              placeholder="01xxxxxxxxx أو +20..."
              dir="ltr"
            />
            {s.phoneNormalized && (
              <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                سيتم الإرسال إلى: <strong dir="ltr">{s.phoneNormalized}</strong>
              </div>
            )}
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Clock size={16} /> وقت الإرسال
            </label>
            <input type="time" value={s.timeHHmm} onChange={(e) => s.setTimeHHmm(e.target.value)} />
            <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
              الافتراضي: 9:00 مساءً
            </div>
          </div>

          <div className="form-group">
            <label>نوع التقرير</label>
            <select value={s.reportType} onChange={(e) => s.setReportType(e.target.value)}>
              <option value="full">ملخص كامل</option>
              <option value="sales">المبيعات فقط</option>
              <option value="profit">الربح والمصروفات</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card-inner">
        <div className="sub-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ShieldCheck size={18} />
          معاينة الرسالة
        </div>
        <div
          className="message message-info"
          style={{ whiteSpace: 'pre-line', direction: 'rtl', textAlign: 'right' }}
        >
          {s.preview}
        </div>
        <div className="form-actions" style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            disabled={sendingNow || !s.enabled || !!s.error}
            onClick={async () => {
              setSendingNow(true);
              try {
                const r = await maybeSendDailyWhatsAppReport({ onToast, reason: 'manual', ignoreTime: true });
                if (r?.ok && !r?.skipped) {
                  onToast?.('تم إرسال التقرير الآن');
                } else if (r?.ok && r?.skipped) {
                  if (r.reason === 'already_sent') onToast?.('تم الإرسال مسبقاً اليوم.');
                  else if (r.reason === 'no_activity') onToast?.('لا توجد حركة اليوم لإرسال تقرير.');
                  else onToast?.('تم تخطي الإرسال حسب الإعدادات.');
                } else {
                  const reasonMap = {
                    disabled: 'فعّل تقرير واتساب اليومي أولاً.',
                    no_workspace: 'تعذر تحديد مساحة العمل الحالية.',
                    no_phone: 'رقم واتساب غير صالح.',
                    offline: 'لا يوجد اتصال إنترنت حالياً.',
                    bad_type: 'نوع التقرير غير صحيح.',
                    send_failed: 'فشل إرسال التقرير الآن.',
                    exception: 'حدث خطأ أثناء الإرسال.',
                  };
                  onToast?.(reasonMap[r?.reason] || 'تعذر الإرسال الآن.', 'error');
                }
              } catch {
                onToast?.('تعذر الإرسال الآن.', 'error');
              } finally {
                setSendingNow(false);
              }
            }}
          >
            {sendingNow ? 'جاري الإرسال...' : 'إرسال الآن'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(s.preview);
                setCopied(true);
                onToast?.('تم نسخ المعاينة');
              } catch {
                onToast?.('تعذر النسخ', 'error');
              }
            }}
          >
            {copied ? 'تم النسخ' : 'نسخ المعاينة'}
          </button>
          {s.saving && <span className="text-muted" style={{ fontSize: 12 }}>جاري حفظ الإعدادات…</span>}
          {!s.saving && s.enabled && !s.error && <span className="text-muted" style={{ fontSize: 12 }}>{helper}</span>}
          {s.enabled && s.error && <span style={{ fontSize: 12, color: 'var(--expense)' }}>{helper}</span>}
        </div>
      </div>
    </div>
  );
}

