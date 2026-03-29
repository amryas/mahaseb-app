function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function SkeletonLine({ className }) {
  return <div className={cn('h-4 animate-pulse rounded bg-white/10', className)} />;
}

export default function LoadingSkeleton({ rows = 4, className }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} className={i === 0 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

