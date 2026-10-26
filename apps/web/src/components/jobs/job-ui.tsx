'use client';

import type { JobStatus, MatchLabel } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, Button, EmptyState, Icon, Spinner, type IconName } from '@/components/ui';

/**
 * Fit badge (prototype matchBadge): icon + word + score, never colour alone. Nothing for a
 * score under the "near" threshold.
 */
export function MatchBadge({ score, label }: { score: number; label: MatchLabel }) {
  const t = useTranslations('jobs');
  if (label === 'NONE') return null;
  const suitable = label === 'SUITABLE';
  return (
    <Badge variant={suitable ? 'match' : 'near'} icon={suitable ? 'check' : 'approx'}>
      {suitable ? t('suitable') : t('near')}
      <span className="font-normal tabular-nums">
        {' · '}
        <span className="sr-only">{t('fitScore')} </span>
        {score}
      </span>
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const t = useTranslations('jobs');
  return status === 'OPEN' ? (
    <Badge variant="match" icon="check">
      {t('statusOpen')}
    </Badge>
  ) : (
    <Badge variant="muted" icon="lock">
      {t('statusClosed')}
    </Badge>
  );
}

/** Icon + text facts under a title (prototype .meta). */
export function Meta({ items }: { items: [IconName, ReactNode][] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-sm text-text-muted">
      {items.map(([icon, text], i) => (
        <li key={i} className="flex items-center gap-1.5">
          <Icon name={icon} className="h-[18px] w-[18px]" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Spinner while loading; a retry card when the request failed. */
export function LoadState({
  loading,
  error,
  title,
  onRetry,
  label,
}: {
  loading: boolean;
  error: string | null;
  title: string;
  onRetry: () => void;
  label: string;
}) {
  const t = useTranslations('employer');
  if (error) {
    return (
      <EmptyState
        icon="warn"
        title={title}
        action={
          <Button variant="secondary" onClick={onRetry}>
            {t('retry')}
          </Button>
        }
      />
    );
  }
  if (loading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label={label}>
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  return null;
}

/** "Back" link styled as a ghost button with a direction-aware chevron. */
export function BackLink({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon name="chev" className="h-5 w-5 -scale-x-100 rtl:scale-x-100" />
      <span>{children}</span>
    </span>
  );
}
