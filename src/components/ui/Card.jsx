import React from 'react';

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function Card({ className, children, as: As = 'section' }) {
  return (
    <As
      className={cn(
        'rounded-2xl border border-white/10 bg-[#111827] p-4 text-white shadow-lg shadow-black/30 md:p-6',
        'transition-all duration-200 hover:border-white/[0.14] hover:shadow-xl hover:shadow-black/35',
        className
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({ title, subtitle, right, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div>
        {!!title && <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>}
        {!!subtitle && <p className="mt-1 text-sm font-medium text-gray-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
