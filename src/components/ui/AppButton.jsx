function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

const VARIANT = {
  primary:
    'bg-saas-primary text-white shadow-lg shadow-saas-primary/20 hover:bg-saas-primary-hover active:bg-[#009e75]',
  secondary:
    'border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 active:bg-white/[0.12]',
  outline:
    'border border-saas-primary/50 bg-transparent text-saas-primary hover:bg-saas-primary/10 active:bg-saas-primary/15',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800',
  ghost: 'bg-transparent text-gray-400 hover:bg-white/5 active:bg-white/10',
};

const SIZE = {
  md: 'px-4 py-2.5 text-sm rounded-2xl',
  lg: 'px-6 py-3.5 text-base rounded-2xl font-semibold',
};

export default function AppButton({
  children,
  className,
  variant = 'primary',
  size = 'md',
  disabled = false,
  ...props
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold',
        'transition-all duration-200 ease-out motion-reduce:transition-none',
        'hover:scale-[1.02] active:scale-[0.99] motion-reduce:hover:scale-100 motion-reduce:active:scale-100',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100',
        VARIANT[variant] || VARIANT.primary,
        SIZE[size] || SIZE.md,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
