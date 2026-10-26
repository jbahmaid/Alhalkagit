import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm md:px-6 md:py-5 ${className}`}
      {...rest}
    />
  );
}

export type BadgeVariant = 'match' | 'near' | 'info' | 'muted' | 'danger' | 'primary';
const BADGE: Record<BadgeVariant, string> = {
  match: 'bg-match-soft text-match',
  near: 'bg-near-soft text-near',
  info: 'bg-info-soft text-info',
  muted: 'bg-surface-2 text-text-muted',
  danger: 'bg-danger-soft text-danger',
  primary: 'bg-primary-soft text-primary',
};

/** Status badge: always icon + text, never colour alone. */
export function Badge({
  variant = 'muted',
  icon,
  children,
}: {
  variant?: BadgeVariant;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-[13px] font-semibold leading-snug ${BADGE[variant]}`}
    >
      {icon && <Icon name={icon} className="h-4 w-4" />}
      {children}
    </span>
  );
}

export type NoteKind = 'info' | 'privacy' | 'warn' | 'danger' | 'success';
const NOTE: Record<NoteKind, { cls: string; icon: IconName }> = {
  info: { cls: 'bg-info-soft text-info', icon: 'info' },
  privacy: { cls: 'bg-primary-soft text-primary', icon: 'shield' },
  warn: { cls: 'bg-near-soft text-near', icon: 'warn' },
  danger: { cls: 'bg-danger-soft text-danger', icon: 'warn' },
  success: { cls: 'bg-match-soft text-match', icon: 'check' },
};

/**
 * Inline notice. `live` makes it an aria-live region: "assertive" for errors (role=alert),
 * "polite" for confirmations (role=status).
 */
export function Note({
  kind = 'info',
  icon,
  live,
  children,
  className = '',
  id,
}: {
  kind?: NoteKind;
  icon?: IconName;
  live?: 'polite' | 'assertive';
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;
  return (
    <div
      id={id}
      role={role}
      className={`mb-4 flex items-start gap-2.5 rounded-md px-3.5 py-3 text-sm leading-relaxed ${NOTE[kind].cls} ${className}`}
    >
      <Icon name={icon ?? NOTE[kind].icon} className="mt-0.5 h-5 w-5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Error summary for forms (role=alert). Renders nothing without a message. */
export function Alert({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <Note kind="danger" live="assertive" id={id}>
      {children}
    </Note>
  );
}

export function EmptyState({
  icon = 'info',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-4 py-8 text-center text-text-muted">
      <Icon name={icon} className="h-9 w-9" />
      <h2 className="m-0 text-lg font-semibold text-text">{title}</h2>
      {body && <p className="m-0 max-w-prose">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}
