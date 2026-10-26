'use client';

import type { MyInterestDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format';
import { useLookupName, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import { Badge, ButtonLink, Card, EmptyState, Icon, PageHeader } from '@/components/ui';
import { LoadState, Meta } from './job-ui';

/** S-09: the seeker's interest requests. No withdrawal in v1. */
export function MyRequests() {
  const t = useTranslations('requests');
  const tj = useTranslations('jobs');
  const locale = useLocale();
  const { lists } = useLookups(['sectors']);
  const name = useLookupName();
  const { data, error, loading, reload } = useApi<MyInterestDto[]>('/me/interests');

  return (
    <>
      <PageHeader title={t('title')} lead={t('lead')} />
      <LoadState
        loading={loading && !data}
        error={error}
        title={tj('loadFailed')}
        onRetry={reload}
        label={t('title')}
      />
      {data &&
        !error &&
        (data.length ? (
          <div className="grid gap-3">
            {data.map((r) => {
              const headingId = `rq-${r.id}`;
              return (
                <Card key={r.id} role="article" aria-labelledby={headingId} className="!p-4">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <h2 id={headingId} className="m-0 text-lg font-semibold">
                      {r.job.title}
                    </h2>
                    {r.jobAvailable ? (
                      <Badge variant="primary" icon="check">
                        {t('sentStatus')}
                      </Badge>
                    ) : (
                      <Badge variant="muted" icon="lock">
                        {t('closed')}
                      </Badge>
                    )}
                  </div>
                  <Meta
                    items={[
                      ['brief', name(lists.sectors?.find((s) => s.id === r.job.sectorId))],
                      ['pin', r.job.city],
                      ['cal', `${t('requestedOn')}: ${formatDate(r.createdAt, locale)}`],
                    ]}
                  />
                  {r.jobAvailable && (
                    <div className="mt-3 flex justify-end">
                      <ButtonLink
                        href={`/seeker/jobs/${r.job.id}`}
                        variant="secondary"
                        size="sm"
                        aria-describedby={headingId}
                      >
                        {tj('details')}
                        <Icon name="chev" className="h-4 w-4" flipInRtl />
                      </ButtonLink>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="brief"
            title={t('none')}
            action={<ButtonLink href="/seeker/jobs">{t('browse')}</ButtonLink>}
          />
        ))}
    </>
  );
}
