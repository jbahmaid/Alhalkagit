'use client';

import type { EmployerAccountDto, EmployerDashboardDto, EmployerJobDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  type IconName,
} from '@/components/ui';
import { JobStatusBadge, LoadState } from '@/components/jobs/job-ui';

/** /employer: S-11 while the account waits for approval, S-12 once approved. */
export function EmployerHome() {
  const t = useTranslations('employer');
  const { data, error, loading, reload } = useApi<EmployerDashboardDto>('/employer/dashboard');
  if (!data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <LoadState
          loading={loading}
          error={error}
          title={t('loadFailed')}
          onRetry={reload}
          label={t('title')}
        />
      </>
    );
  }
  return data.account.approvalStatus === 'APPROVED' ? (
    <Dashboard data={data} />
  ) : (
    <Pending account={data.account} />
  );
}

/** S-11: timeline and a disabled "post job" button with the reason (FR-2.2.2). */
export function Pending({ account }: { account: EmployerAccountDto }) {
  const t = useTranslations('employer');
  const rejected = account.approvalStatus === 'REJECTED';
  const suspended = account.approvalStatus === 'SUSPENDED';
  const title = rejected ? t('rejectedTitle') : suspended ? t('suspendedTitle') : t('pendingTitle');
  const lead = rejected ? t('rejectedLead') : suspended ? t('suspendedLead') : t('pendingLead');
  return (
    <div className="mx-auto max-w-form">
      <PageHeader title={title} lead={lead} />
      <Card>
        <ol className="m-0 mb-4 list-none p-0">
          <Step icon="check" tone="done">
            {t('tlCreated')}
          </Step>
          <Step icon="check" tone="done">
            {t('tlVerified')}
          </Step>
          {rejected ? (
            <Step icon="x" tone="bad">
              {t('tlReview')} ·{' '}
              <Badge variant="danger" icon="x">
                {t('tlRejected')}
              </Badge>
            </Step>
          ) : (
            <Step icon="clock" tone="wait">
              {t('tlReview')} ·{' '}
              <Badge variant="near" icon="clock">
                {t('inReview')}
              </Badge>
            </Step>
          )}
        </ol>
        {rejected && account.rejectionReason && (
          <p className="mt-0 text-sm">
            <strong>{t('rejectedReason')}:</strong> {account.rejectionReason}
          </p>
        )}
        <Button block aria-disabled="true" aria-describedby="pd-why" onClick={(e) => e.preventDefault()}>
          <Icon name="lock" />
          {t('newJob')}
        </Button>
        <p id="pd-why" className="mb-0 mt-2 text-[13px] text-text-muted">
          {t('postDisabled')}
        </p>
      </Card>
    </div>
  );
}

function Step({
  icon,
  tone,
  children,
}: {
  icon: IconName;
  tone: 'done' | 'wait' | 'bad';
  children: ReactNode;
}) {
  const cls =
    tone === 'done'
      ? 'bg-match-soft text-match'
      : tone === 'wait'
        ? 'bg-near-soft text-near'
        : 'bg-danger-soft text-danger';
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`grid h-8 w-8 flex-none place-items-center rounded-pill ${cls}`}>
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span>{children}</span>
    </li>
  );
}

/** S-12: counters and the employer's jobs. */
function Dashboard({ data }: { data: EmployerDashboardDto }) {
  const t = useTranslations('employer');
  const locale = useLocale();
  const stats: [string, string, number][] = [
    ['open', t('openJobs'), data.stats.openJobs],
    ['requests', t('interestReqs'), data.stats.interestRequests],
    ['hired', t('hiredVia'), data.stats.hiredViaPlatform],
  ];
  return (
    <>
      <PageHeader title={t('title')} lead={data.account.organizationName} />
      <dl className="m-0 mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map(([key, label, n]) => (
          <div
            key={key}
            className="flex flex-col-reverse rounded-lg border border-border bg-surface px-4 py-3.5"
          >
            <dt className="text-[13px] text-text-muted">{label}</dt>
            <dd className="m-0 text-[26px] font-bold leading-tight tabular-nums" data-stat={key}>
              {n}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-xl font-semibold">{t('myJobs')}</h2>
        <ButtonLink href="/employer/jobs/new">
          <Icon name="plus" />
          {t('newJob')}
        </ButtonLink>
      </div>
      {data.jobs.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[15px] max-md:block">
            <thead className="max-md:sr-only">
              <tr>
                {[t('jobTitle'), t('status'), t('posted'), t('applicants'), t('actions')].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="border-b border-border bg-surface-2 px-3 py-2.5 text-start text-[13px] font-semibold text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="max-md:block">
              {data.jobs.map((j) => (
                <JobRow key={j.id} job={j} locale={locale} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="brief" title={t('noJobs')} />
      )}
    </>
  );
}

function JobRow({ job, locale }: { job: EmployerJobDto; locale: string }) {
  const t = useTranslations('employer');
  const td =
    'border-b border-border px-3 py-2.5 align-middle [overflow-wrap:anywhere] max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:border-0 max-md:px-3.5 max-md:py-1.5 max-md:text-end max-md:before:max-w-[45%] max-md:before:flex-none max-md:before:text-start max-md:before:text-[13px] max-md:before:font-semibold max-md:before:text-text-muted max-md:before:content-[attr(data-label)]';
  return (
    <tr className="max-md:block max-md:border-b max-md:border-border max-md:py-2 max-md:last:border-b-0">
      <td data-label={t('jobTitle')} className={td}>
        <strong>{job.title}</strong>
      </td>
      <td data-label={t('status')} className={td}>
        <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
          <JobStatusBadge status={job.status} />
          {job.closedOutcome === 'HIRED_VIA_PLATFORM' && (
            <Badge variant="match" icon="check">
              {t('outHired')}
            </Badge>
          )}
          {job.closedOutcome === 'CLOSED_WITHOUT_HIRING' && <Badge variant="muted">{t('outNone')}</Badge>}
        </div>
      </td>
      <td data-label={t('posted')} className={td}>
        {formatDate(job.publishedAt, locale)}
      </td>
      <td data-label={t('applicants')} className={`${td} tabular-nums`}>
        {job.applicantCount}
      </td>
      <td data-label={t('actions')} className={td}>
        <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
          <ButtonLink href={`/employer/jobs/${job.id}/applicants`} variant="secondary" size="sm">
            {t('applicants')}
            <span className="sr-only">: {job.title}</span>
          </ButtonLink>
          {job.status === 'OPEN' && (
            <>
              <ButtonLink href={`/employer/jobs/${job.id}/edit`} variant="ghost" size="sm">
                {t('edit')}
                <span className="sr-only">: {job.title}</span>
              </ButtonLink>
              <ButtonLink href={`/employer/jobs/${job.id}/close`} variant="ghost" size="sm">
                {t('close')}
                <span className="sr-only">: {job.title}</span>
              </ButtonLink>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
