'use client';

import type { ApplicantsDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format';
import { useLookupName, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import { Badge, ButtonLink, Card, EmptyState, Icon, Note, PageHeader } from '@/components/ui';
import { BackLink, JobStatusBadge, LoadState, MatchBadge, Meta } from '@/components/jobs/job-ui';

/** S-14: people who expressed interest in one of the employer's own jobs, best fit first. */
export function Applicants({ jobId }: { jobId: string }) {
  const t = useTranslations('employer');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { lists } = useLookups(['education-levels']);
  const name = useLookupName();
  const { data, error, loading, reload } = useApi<ApplicantsDto>(`/employer/jobs/${jobId}/applicants`);

  return (
    <>
      <ButtonLink href="/employer" variant="ghost" className="mb-2">
        <BackLink>{tc('backTo')}</BackLink>
      </ButtonLink>
      {!data ? (
        <>
          <PageHeader title={t('applicantsTitle')} />
          <LoadState
            loading={loading}
            error={error}
            title={t('loadFailed')}
            onRetry={reload}
            label={t('applicantsTitle')}
          />
        </>
      ) : (
        <>
          <PageHeader title={t('applicantsTitle')} lead={data.job.title} />
          <div className="-mt-3 mb-4">
            <JobStatusBadge status={data.job.status} />
          </div>
          <Note kind="privacy" icon="info">
            {t('applicantsNote')}
          </Note>
          {data.applicants.length ? (
            <div className="grid gap-3">
              {data.applicants.map((a) => {
                const headingId = `ap-${a.interestId}`;
                const edu = lists['education-levels']?.find((e) => e.id === a.educationLevelId);
                const person = [
                  a.age !== null ? t('ageYears', { n: a.age }) : null,
                  a.gender ? (a.gender === 'MALE' ? t('male') : t('female')) : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Card key={a.interestId} role="article" aria-labelledby={headingId} className="!p-4">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <h2 id={headingId} className="m-0 text-lg font-semibold">
                        {a.fullName}
                      </h2>
                      <div className="flex flex-wrap gap-1.5">
                        {a.status === 'HIRED' && (
                          <Badge variant="primary" icon="check">
                            {t('hiredBadge')}
                          </Badge>
                        )}
                        <MatchBadge score={a.match.score} label={a.match.label} />
                      </div>
                    </div>
                    <Meta
                      items={[
                        ['user', person || t('notProvided')],
                        ['cap', edu ? name(edu) : t('notProvided')],
                        ['clock', a.yearsOfExperience ? t('expN', { n: a.yearsOfExperience }) : t('noExp')],
                      ]}
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-text-muted">
                        {t('requestedOn')}: {formatDate(a.requestedAt, locale)}
                      </span>
                      <ButtonLink
                        href={`/employer/applicants/${a.interestId}`}
                        variant="secondary"
                        size="sm"
                        aria-describedby={headingId}
                      >
                        {t('viewProfile')}
                        <Icon name="chev" className="h-4 w-4" flipInRtl />
                      </ButtonLink>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState icon="user" title={t('noApplicants')} />
          )}
        </>
      )}
    </>
  );
}
