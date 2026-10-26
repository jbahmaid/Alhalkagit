'use client';

import { localSaudiMobile, type ApplicantProfileDto, type FileLinkDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useApiErrors } from '@/lib/errors';
import { formatBytes, formatDate, formatMonth } from '@/lib/format';
import { useLookupName, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Icon,
  Kv,
  PageHeader,
  buttonClasses,
  type IconName,
} from '@/components/ui';
import { BackLink, LoadState, MatchBadge } from '@/components/jobs/job-ui';

/**
 * S-15: profile of someone who expressed interest in the employer's job. The API returns it
 * only for the employer's own jobs and never includes the ID number, dar or fakhdh.
 */
export function ApplicantProfile({ interestId }: { interestId: string }) {
  const t = useTranslations('employer');
  const tc = useTranslations('common');
  const locale = useLocale();
  const errs = useApiErrors();
  const { lists } = useLookups(['countries', 'education-levels']);
  const name = useLookupName();
  const {
    data: p,
    error,
    loading,
    reload,
  } = useApi<ApplicantProfileDto>(`/employer/applicants/${interestId}`);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);

  if (!p) {
    return (
      <>
        <ButtonLink href="/employer" variant="ghost" className="mb-2">
          <BackLink>{tc('backTo')}</BackLink>
        </ButtonLink>
        <PageHeader title={t('applicantsTitle')} />
        <LoadState
          loading={loading}
          error={error}
          title={t('loadFailed')}
          onRetry={reload}
          label={t('applicantsTitle')}
        />
      </>
    );
  }

  const country = (id: string | null | undefined) => name(lists.countries?.find((c) => c.id === id));
  const none = <span className="font-normal text-text-muted">{t('notProvided')}</span>;
  const ed = p.education;

  async function openCv() {
    setCvBusy(true);
    setCvError(null);
    try {
      const link = await api<FileLinkDto>(`/employer/applicants/${interestId}/cv-link`, { method: 'POST' });
      window.location.assign(link.url);
    } catch (err) {
      setCvError(errs.message(err));
    } finally {
      setCvBusy(false);
    }
  }

  return (
    <>
      <ButtonLink href={`/employer/jobs/${p.jobId}/applicants`} variant="ghost" className="mb-2">
        <BackLink>{tc('backTo')}</BackLink>
      </ButtonLink>
      <div className="mb-1.5">
        <MatchBadge score={p.match.score} label={p.match.label} />
      </div>
      <PageHeader title={p.fullName} lead={t('jobLabel', { title: p.jobTitle })} />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 gap-4">
          <Section icon="user" title={t('personal')}>
            <Kv
              rows={[
                [t('age'), p.age !== null ? t('ageYears', { n: p.age }) : none],
                [t('gender'), p.gender ? (p.gender === 'MALE' ? t('male') : t('female')) : none],
                [t('nationality'), country(p.nationalityId) || none],
                [t('needs'), p.hasSpecialNeeds === null ? none : p.hasSpecialNeeds ? t('yes') : t('no')],
              ]}
            />
          </Section>
          <Section icon="cap" title={t('education')}>
            {ed ? (
              <Kv
                rows={[
                  [
                    t('eduLevel'),
                    name(lists['education-levels']?.find((l) => l.id === ed.educationLevelId)) || none,
                  ],
                  [t('inst'), ed.institution],
                  [t('major'), ed.fieldOfStudy || none],
                  [t('gradYear'), ed.graduationYear ?? none],
                  [t('gradCountry'), country(ed.countryId) || none],
                ]}
              />
            ) : (
              none
            )}
          </Section>
          <Section icon="brief" title={t('experience')}>
            {p.hasExperience ? (
              <Kv
                rows={[
                  [t('expYears'), p.yearsOfExperience ?? none],
                  ...p.positions.map((x, i): [ReactNode, ReactNode] => [
                    t('pos', { n: i + 1 }),
                    <>
                      {x.title}
                      {x.organization ? ` · ${x.organization}` : ''}
                      <br />
                      <span className="text-sm font-normal text-text-muted">
                        {formatMonth(x.startDate, locale)} –{' '}
                        {x.endDate ? formatMonth(x.endDate, locale) : t('present')}
                      </span>
                    </>,
                  ]),
                  [
                    t('verifier'),
                    p.verifier ? (
                      <>
                        {p.verifier.name}
                        {[p.verifier.phone && localSaudiMobile(p.verifier.phone), p.verifier.email]
                          .filter(Boolean)
                          .map((c) => (
                            <span key={c as string} dir="ltr" className="block text-sm font-normal">
                              {c}
                            </span>
                          ))}
                      </>
                    ) : (
                      none
                    ),
                  ],
                ]}
              />
            ) : (
              <p className="m-0">{t('noExp')}</p>
            )}
          </Section>
        </div>
        <aside className="grid gap-4 lg:sticky lg:top-4">
          <Section icon="phone" title={t('contact')}>
            {p.mobile && (
              <p className="m-0 mb-1">
                <span dir="ltr">{localSaudiMobile(p.mobile)}</span>
              </p>
            )}
            {p.email && (
              <p className="m-0">
                <span dir="ltr" className="[overflow-wrap:anywhere]">
                  {p.email}
                </span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {p.mobile && (
                <a className={buttonClasses('primary')} href={`tel:${p.mobile}`}>
                  <Icon name="phone" />
                  {t('call')}
                </a>
              )}
              {p.email && (
                <a className={buttonClasses('secondary')} href={`mailto:${p.email}`}>
                  <Icon name="mail" />
                  {t('sendEmail')}
                </a>
              )}
            </div>
          </Section>
          <Section icon="file" title={t('cv')}>
            {p.cv ? (
              <>
                <p className="m-0 mb-2 text-sm [overflow-wrap:anywhere]">
                  {p.cv.originalName} · {formatBytes(p.cv.sizeBytes)} · {formatDate(p.cv.uploadedAt, locale)}
                </p>
                <Alert>{cvError}</Alert>
                <Button variant="secondary" block loading={cvBusy} onClick={openCv} aria-describedby="cv-h">
                  {t('openCv')}
                </Button>
                <p id="cv-h" className="mb-0 mt-1.5 text-[13px] text-text-muted">
                  {t('cvLinkHint')}
                </p>
              </>
            ) : (
              <p className="m-0 text-text-muted">{t('noCv')}</p>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="m-0 mb-3 flex items-center gap-2 text-lg font-semibold">
        <Icon name={icon} />
        {title}
      </h2>
      {children}
    </Card>
  );
}
