'use client';

import type { AdminDashboardDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLookupName, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/use-auth';
import { Badge, ButtonLink, Card, Icon, PageHeader } from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import { ExportButton, SystemBadge } from './admin-ui';

const STATS = [
  'seekers',
  'employersApproved',
  'employersPending',
  'openJobs',
  'interestRequests',
  'hiredViaPlatform',
] as const;

/** S-17: counters, pending approvals shortcut, latest audit entries, full Excel export. */
export function AdminDashboard() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const ta = useTranslations('admin.audit.act');
  const locale = useLocale();
  const { user } = useAuth();
  const name = useLookupName();
  const { lists } = useLookups(['sectors']);
  const { data, error, loading, reload } = useApi<AdminDashboardDto>('/admin/dashboard');
  const canExport = user?.permissions.includes('data.export') || user?.role === 'SUPER_ADMIN';

  return (
    <>
      <PageHeader
        eyebrow={user?.role === 'SUPER_ADMIN' ? tc('roleSuperAdmin') : tc('roleAdmin')}
        title={t('title')}
        lead={user ? t('welcome', { name: user.displayName }) : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {user?.isSystemAccount && <SystemBadge />}
        {canExport && <ExportButton kind="full" label={t('exportAll')} />}
      </div>
      {!data ? (
        <LoadState
          loading={loading}
          error={error}
          title={tc('loadFailed')}
          onRetry={reload}
          label={t('title')}
        />
      ) : (
        <>
          <dl className="m-0 mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            {STATS.map((key) => (
              <div
                key={key}
                className="flex flex-col-reverse rounded-lg border border-border bg-surface px-4 py-3.5"
              >
                <dt className="text-[13px] text-text-muted">{t(`stats.${key}`)}</dt>
                <dd className="m-0 text-[26px] font-bold leading-tight tabular-nums" data-stat={key}>
                  {data.stats[key]}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="m-0 text-lg font-semibold">{t('pendingCard')}</h2>
                <Badge variant="near" icon="clock">
                  {data.stats.employersPending}
                </Badge>
              </div>
              {data.pending.length ? (
                <ul className="m-0 mb-4 list-none space-y-2.5 p-0">
                  {data.pending.map((p) => (
                    <li key={p.id} className="flex items-start gap-2.5">
                      <Icon name="brief" className="mt-0.5 h-5 w-5 text-text-muted" />
                      <span>
                        <strong>{p.organizationName}</strong>
                        <br />
                        <span className="text-sm text-text-muted">
                          {name(lists.sectors?.find((s) => s.id === p.sectorId))} ·{' '}
                          {formatDate(p.createdAt, locale)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0 text-text-muted">{t('noPending')}</p>
              )}
              <ButtonLink href="/admin/approvals">{t('reviewNow')}</ButtonLink>
            </Card>
            <Card>
              <h2 className="m-0 mb-3 text-lg font-semibold">{t('recentAudit')}</h2>
              <ul className="m-0 mb-4 list-none space-y-2.5 p-0">
                {data.recentAudit.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5">
                    <Icon name="clock" className="mt-0.5 h-5 w-5 text-text-muted" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <strong>{ta(a.action)}</strong> · <code className="text-sm">{a.entity}</code>
                      <br />
                      <span className="text-sm text-text-muted">
                        <span dir="ltr">{a.actorLabel ?? t('systemActor')}</span> ·{' '}
                        {formatDateTime(a.createdAt, locale)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <ButtonLink href="/admin/audit" variant="secondary">
                {t('viewAll')}
              </ButtonLink>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
