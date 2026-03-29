function cn(...p) {
  return p.filter(Boolean).join(' ');
}

const VARIANT = {
  default: cn(
    'min-h-[5.5rem] rounded-xl bg-saas-primary text-sm font-bold text-saas-shell shadow-md shadow-saas-primary/25',
    'transition-all duration-200 hover:scale-105 hover:bg-saas-primary-hover hover:shadow-lg hover:shadow-saas-primary/30',
    'active:scale-[0.97] motion-reduce:hover:scale-100 motion-reduce:active:scale-100'
  ),
  hero: cn(
    'min-h-[6.5rem] rounded-2xl text-base font-bold text-white shadow-lg shadow-teal-500/35',
    'bg-gradient-to-l from-teal-400 via-saas-primary to-emerald-600',
    'ring-2 ring-white/25 ring-offset-2 ring-offset-[#0B0F19]',
    'transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-teal-500/30 hover:brightness-[1.03]',
    'active:scale-[0.97] motion-reduce:hover:scale-100 motion-reduce:active:scale-100'
  ),
};

/**
 * Large quick action — UI only; parent supplies onClick.
 * variant="hero" for primary CTA (e.g. بيع جديد).
 */
export default function ActionButton({ icon: Icon, children, className, variant = 'default', ...props }) {
  const isHero = variant === 'hero';
  return (
    <button
      type="button"
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 px-4 py-5',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-saas-primary',
        VARIANT[variant] || VARIANT.default,
        className
      )}
      {...props}
    >
      {Icon && (
        <Icon
          className={cn('h-7 w-7 shrink-0 stroke-[2]', isHero ? 'text-white drop-shadow-sm' : 'text-saas-shell opacity-95')}
          aria-hidden
        />
      )}
      <span className="text-center leading-snug">{children}</span>
    </button>
  );
}
