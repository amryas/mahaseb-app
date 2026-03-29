function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function SectionHeader({ title, subtitle, right, className }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
        {!!subtitle && <p className="mt-1 text-sm font-medium text-gray-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

