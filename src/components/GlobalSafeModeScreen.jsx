import { logSystemEvent } from '../services/monitoring';
import { clearGlobalSafeMode, enterGlobalSafeMode, getGlobalSafeModeReason } from '../data/globalSafeMode';
import { resetDbConnection, getDb, runPostOpenIntegrityChecks } from '../data/indexedDbStore';

/**
 * Full-screen fallback when IndexedDB cannot be opened after recovery.
 */
export default function GlobalSafeModeScreen({ onRecovered }) {
  const reason = getGlobalSafeModeReason();

  const handleRetry = async () => {
    clearGlobalSafeMode();
    resetDbConnection();
    try {
      await getDb();
      await runPostOpenIntegrityChecks();
      void logSystemEvent('global_safe_mode_retry', 'IndexedDB retry succeeded', {});
      onRecovered?.();
    } catch (e) {
      void logSystemEvent('global_safe_mode_retry_failed', String(e?.message || 'unknown'), {});
      clearGlobalSafeMode();
      enterGlobalSafeMode(e?.message || 'retry_failed');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'Cairo, system-ui, sans-serif',
        background: '#0f172a',
        color: '#e2e8f0',
        direction: 'rtl',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ marginBottom: 16, fontSize: '1.35rem' }}>وضع القراءة الآمن — تعذر فتح التخزين المحلي</h1>
      <p style={{ marginBottom: 12, maxWidth: 420, color: '#94a3b8', lineHeight: 1.6 }}>
        لا يمكن حفظ البيانات على الجهاز حالياً (مشكلة في IndexedDB). يمكنك إعادة المحاولة بعد إغلاق التبويبات الأخرى أو تنظيف مساحة
        المتصفح. لن تُفقد بيانات السحابة إن كانت المزامنة مفعّلة.
      </p>
      {reason ? (
        <p style={{ fontSize: '0.8rem', color: '#64748b', wordBreak: 'break-word', maxWidth: '90%' }}>{reason}</p>
      ) : null}
      <button
        type="button"
        onClick={() => void handleRetry()}
        style={{
          marginTop: 28,
          padding: '12px 28px',
          fontSize: '1rem',
          background: '#0d9488',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
