function cn(...p) {
  return p.filter(Boolean).join(' ');
}

export default function Sidebar({ branding, activeKey, items, onNavigate, footer }) {
  const name = branding?.appName || 'محاسب مشروعي';
  const tag = branding?.tagline || 'حساباتك بسهولة';

  return (
    <aside
      className={cn(
        'relative z-30 hidden w-[260px] shrink-0 flex-col lg:flex',
        'm-3 rounded-2xl bg-[#0B0F19] text-gray-300 shadow-xl shadow-black/50 ring-1 ring-white/10'
      )}
    >
      <div className="border-b border-white/[0.06] px-4 py-5">
        <div className="flex items-center gap-3">
          {branding?.logoBase64 ? (
            <img src={branding.logoBase64} alt="" className="h-11 w-11 shrink-0 rounded-xl object-contain ring-1 ring-white/10" />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-saas-primary/20 text-lg font-bold text-saas-primary">
              ◈
            </div>
          )}
          <div className="min-w-0 text-right">
            <h1 className="truncate text-base font-bold text-white">{name}</h1>
            <p className="truncate text-xs font-medium text-gray-400">{tag}</p>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="التنقل الرئيسي">
        {items.map(({ key, label, Icon }) => {
          const active = activeKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-semibold transition-all duration-200',
                active
                  ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/10'
                  : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-saas-primary' : 'text-gray-500')} strokeWidth={2} />
              <span className="flex-1">{label}</span>
            </button>
          );
        })}
      </nav>

      {footer && <div className="border-t border-white/[0.06] p-3 text-xs">{footer}</div>}
    </aside>
  );
}
