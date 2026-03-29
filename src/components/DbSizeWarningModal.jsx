export default function DbSizeWarningModal({ open, onClose, usageBytes, limitBytes }) {
  if (!open) return null;
  const format = (b) => {
    if (!Number.isFinite(b)) return '—';
    const mb = b / (1024 * 1024);
    return `${mb.toFixed(1)}MB`;
  };
  return (
    <div
      className="subscription-expired-overlay"
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 9999 }}
    >
      <div className="subscription-expired-modal" style={{ maxWidth: 520 }}>
        <h2 style={{ marginBottom: 12 }}>تنبيه مساحة التخزين</h2>
        <p style={{ marginBottom: 12, opacity: 0.9 }}>
          التخزين المحلي (IndexedDB) اقترب من الحد وقد نقوم بأرشفة البيانات القديمة تلقائيًا للحفاظ على الأداء.
        </p>
        <p style={{ marginBottom: 16, opacity: 0.9 }}>
          الاستخدام الحالي: {format(usageBytes)} / الحد: {format(limitBytes)}
        </p>
        <button type="button" className="btn-primary" onClick={onClose}>
          فهمت
        </button>
      </div>
    </div>
  );
}

