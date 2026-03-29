/**
 * صفحة «المزيد» — تجمع كل الروابط الثانوية لتقليل القائمة الرئيسية
 */
import SectionHeader from './ui/SectionHeader';

export default function MorePage({ onNavigate, items }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SectionHeader
        title="المزيد"
        subtitle="العملاء، الموردين، الاستيراد، النسخ الاحتياطي والإعدادات."
      />
      <div className="more-grid">
        {items.map(({ key, label, icon, desc }) => (
          <button
            key={key}
            type="button"
            className="more-card"
            onClick={() => onNavigate(key)}
          >
            <span className="more-card-icon">{icon}</span>
            <span className="more-card-label">{label}</span>
            {desc && <span className="more-card-desc">{desc}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
