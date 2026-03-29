function cn(...p) {
  return p.filter(Boolean).join(' ');
}

/**
 * Dark dashboard metric card — UI only.
 */
export default function StatCard({ label, value, hint, trend, className }) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-saas-card p-5 text-white shadow-saas-card transition-all duration-200',
        'ring-1 ring-white/[0.06]',
        'hover:scale-[1.03] hover:shadow-lg hover:ring-white/10',
        'motion-reduce:transition-none motion-reduce:hover:scale-100',
        className
      )}
    >
      <p className="text-sm font-medium text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-white md:text-3xl">{value}</p>
      {hint && <p className="mt-1.5 text-xs font-medium text-gray-400">{hint}</p>}
      {trend != null && trend !== '' && (
        <p className="mt-2 text-xs font-semibold text-saas-primary">{trend}</p>
      )}
    </div>
  );
}
