import AppButton from './AppButton';

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  className,
}) {
  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center md:p-5', className)}>
      {!!icon && <div className="mx-auto mb-2 w-fit text-gray-400">{icon}</div>}
      <div className="text-sm font-semibold text-white">{title}</div>
      {!!subtitle && <div className="mt-1 text-sm text-gray-300">{subtitle}</div>}
      {!!actionLabel && !!onAction && (
        <div className="mt-4">
          <AppButton onClick={onAction}>{actionLabel}</AppButton>
        </div>
      )}
    </div>
  );
}
