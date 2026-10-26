'use client';

import type { SeekerJobDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiErrors } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useLookupName, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import { PROFILE_PATH } from '@/lib/use-profile';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  Icon,
  Kv,
  Note,
  PageHeader,
  useToast,
} from '@/components/ui';
import { BackLink, JobStatusBadge, LoadState, MatchBadge, Meta } from './job-ui';

/** S-08: job detail, "why it fits", and the interest request with explicit consent (FR-2.3.3). */
export function SeekerJobDetail({ id }: { id: string }) {
  const t = useTranslations('jobs');
  const tc = useTranslations('common');
  const locale = useLocale();
  const toast = useToast();
  const errs = useApiErrors();
  const { lists } = useLookups(['sectors', 'education-levels', 'countries']);
  const name = useLookupName();
  const { data: job, setData, error, loading, reload } = useApi<SeekerJobDto>(`/jobs/${id}`);
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<{ code: string; text: string } | null>(null);
  const headingRef = useRef<HTMLDivElement>(null);

  const back = (
    <ButtonLink href="/seeker/jobs" variant="ghost" className="mb-2">
      <BackLink>{tc('backTo')}</BackLink>
    </ButtonLink>
  );

  if (error === 'JOB_NOT_AVAILABLE' || error === 'NOT_FOUND') {
    return (
      <>
        {back}
        <EmptyState
          icon="lock"
          title={t('notAvailableTitle')}
          action={<ButtonLink href="/seeker/jobs">{t('backToJobs')}</ButtonLink>}
        />
      </>
    );
  }
  if (!job) {
    return (
      <>
        {back}
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

  const sector = lists.sectors?.find((s) => s.id === job.sectorId);
  const country = lists.countries?.find((c) => c.id === job.countryId);
  const edu = lists['education-levels']?.find((e) => e.id === job.requiredEducationLevelId);
  const b = job.match.breakdown;
  const why: [boolean, string][] = [
    [b.sectorMatch, b.sectorMatch ? t('whySector') : t('whySectorNo')],
    [b.educationMet, b.educationMet ? t('whyEdu') : t('whyEduNo')],
    [b.experienceMet, b.experienceMet ? t('whyExp') : t('whyExpNo')],
  ];

  async function send() {
    setBusy(true);
    setSendError(null);
    try {
      const updated = await api<SeekerJobDto>(`/jobs/${id}/interest`, { body: { consent: true } });
      setData(updated);
      setOpen(false);
      toast(t('interestToast'));
      headingRef.current?.querySelector('h1')?.focus();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
      if (code === 'INTEREST_EXISTS' || code === 'JOB_CLOSED') reload();
      if (code !== 'NETWORK' && code !== 'INTERNAL_ERROR' && code !== 'RATE_LIMITED') setOpen(false);
      setSendError({ code, text: code === 'PROFILE_INCOMPLETE' ? t('completeFirst') : errs.message(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {back}
      <div ref={headingRef}>
        <div className="mb-1.5 flex flex-wrap gap-2">
          <MatchBadge score={job.match.score} label={job.match.label} />
          <JobStatusBadge status={job.status} />
        </div>
        <PageHeader title={job.title} />
        <div className="-mt-3 mb-5">
          <Meta
            items={[
              ['brief', name(sector)],
              ['pin', [job.city, name(country)].filter(Boolean).join(locale === 'ar' ? '، ' : ', ')],
              ['cal', `${t('posted')} ${formatDate(job.publishedAt, locale)}`],
            ]}
          />
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 gap-4">
          <Card>
            <h2 className="m-0 mb-2 text-lg font-semibold">{t('about')}</h2>
            <p className="mt-0 whitespace-pre-line">{job.description}</p>
            <Kv
              rows={[
                [t('eduLevel'), edu ? name(edu) : t('anyEducation')],
                [
                  t('minExp'),
                  job.minYearsExperience > 0 ? t('expN', { n: job.minYearsExperience }) : t('noExp'),
                ],
                [t('employmentType'), t(`empType.${job.employmentType}`)],
              ]}
            />
          </Card>
          <Card>
            <h2 className="m-0 mb-2 text-lg font-semibold">{t('whyTitle')}</h2>
            <ul className="m-0 list-none p-0">
              {why.map(([ok, text], i) => (
                <li key={i} className="flex items-start gap-2.5 border-b border-border py-2 last:border-b-0">
                  <span className={ok ? 'text-match' : 'text-near'}>
                    <Icon name={ok ? 'check' : 'approx'} />
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <aside className="lg:sticky lg:top-4">
          <Card>
            <Note kind="privacy">{t('anonNote')}</Note>
            {sendError && !open && (
              <Alert>
                {sendError.text}
                {sendError.code === 'PROFILE_INCOMPLETE' && (
                  <>
                    {' '}
                    <ButtonLink href={PROFILE_PATH} variant="ghost" size="sm">
                      {t('completeProfile')}
                    </ButtonLink>
                  </>
                )}
              </Alert>
            )}
            {job.interest ? (
              <div role="status">
                <p className="m-0 mb-2">
                  <Badge variant="match" icon="check">
                    {t('sent')}
                  </Badge>
                </p>
                <p className="m-0 text-sm text-text-muted">{t('sentState')}</p>
                <ButtonLink href="/seeker/requests" variant="ghost" size="sm" className="mt-2">
                  {t('goToRequests')}
                </ButtonLink>
              </div>
            ) : job.status !== 'OPEN' ? (
              <p className="m-0 text-sm text-text-muted">{t('closedState')}</p>
            ) : (
              <>
                <Button
                  block
                  onClick={() => {
                    setAgree(false);
                    setSendError(null);
                    setOpen(true);
                  }}
                >
                  {t('interestBtn')}
                </Button>
                <p className="mb-0 mt-2 text-sm text-text-muted">{t('interestHelp')}</p>
              </>
            )}
          </Card>
        </aside>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('dlgTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={send} disabled={!agree} loading={busy}>
              {t('sendRequest')}
            </Button>
          </>
        }
      >
        {sendError && <Alert>{sendError.text}</Alert>}
        <p className="mt-0">{t('dlgLead')}</p>
        <ul className="mt-0">
          <li>{t('shareProfile')}</li>
          <li>{t('shareCv')}</li>
          <li>{t('shareContact')}</li>
        </ul>
        <Note kind="privacy">{t('dlgNote')}</Note>
        <Checkbox
          id="agree"
          label={t('agree')}
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
        />
      </Dialog>
    </>
  );
}
