import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

const BASE =
  'inline-flex min-h-touch items-center justify-center gap-2 rounded-md border border-transparent font-semibold leading-tight text-center no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-[.55] aria-disabled:cursor-not-allowed aria-disabled:opacity-[.55]';
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-text border-border hover:bg-surface-2',
  ghost: 'bg-transparent text-primary hover:bg-primary-soft px-2.5',
  danger: 'bg-danger text-white dark:text-[#2A0B08] hover:opacity-90',
};
const SIZES: Record<ButtonSize, string> = {
  md: 'px-[18px] py-[9px] text-[15px]',
  sm: 'px-3 py-1.5 text-sm',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  block = false,
  extra = '',
) {
  return [BASE, VARIANTS[variant], SIZES[size], block ? 'w-full' : '', extra].filter(Boolean).join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block,
    loading,
    className = '',
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

/** A Link styled as a button (locale-aware). */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block,
  className = '',
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }) {
  return <Link className={buttonClasses(variant, size, block, className)} {...rest} />;
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin motion-reduce:animate-none`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
