function cn(...p) {
  return p.filter(Boolean).join(' ');
}

/**
 * Dark surface card for dashboard sections (charts, lists).
 */
export default function SectionCard({ title, subtitle, right, children, className, bodyClassName }) {
  const hasHead = Boolean(title || subtitle || right);
  return (
    <section
      className={cn(
        'rounded-2xl border border-white/10 bg-[#111827] p-6 text-white shadow-lg shadow-black/30 transition-all duration-200 md:p-8',
        'hover:border-white/[0.14] hover:shadow-xl hover:shadow-black/35 motion-reduce:hover:shadow-lg',
        className
      )}
    >
      {hasHead && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold tracking-tight text-white md:text-xl">{title}</h2>}
            {subtitle && <p className="mt-1.5 text-sm font-medium leading-relaxed text-gray-400">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div className={cn(hasHead && 'mt-6', bodyClassName)}>{children}</div>
    </section>
  );
}
