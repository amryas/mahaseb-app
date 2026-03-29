import React from 'react';

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Unified page layout wrapper (RTL-safe).
 * max-w-7xl · soft horizontal padding · vertical rhythm for SaaS pages
 */
export default function PageContainer({ className, children, as: As = 'div' }) {
  return (
    <As
      className={cn(
        'mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-5 md:px-8 md:py-8',
        'flex flex-col gap-6 md:gap-8',
        className
      )}
    >
      {children}
    </As>
  );
}

