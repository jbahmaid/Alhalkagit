'use client';

import {
  ageFrom,
  localSaudiMobile,
  type FileLinkDto,
  type LookupItemDto,
  type ProfileDto,
  type WizardStep,
} from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useApiErrors } from '@/lib/errors';
import { formatBytes, formatDate, formatMonth } from '@/lib/format';
import { useLookupName, type Lookups } from '@/lib/lookups';
import { Alert, Badge, Button, ButtonLink, Card, Icon, Kv, PageHeader } from '@/components/ui';
import { stepHref } from './ProfileWizard';

const byId = (list: LookupItemDto[] | undefined, id: string | null | undefined) =>
  id ? list?.find((x) => x.id === id) : undefined;

/** "ملفي" after completion: each section with an edit link back to its wizard step. */
export function ProfileSummary({ profile, lists }: { profile: ProfileDto; lists: Lookups }) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const name = useLookupName();
  const errs = useApiErrors();
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { personal: p, affiliation: a, contact: c, education: ed, experience: ex, cv } = profile;
  const none = <span className="text-text-muted">{t('notProvided')}</span>;
  const or = (v: ReactNode) => (v === null || v === undefined || v === '' ? none : v);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const link = await api<FileLinkDto>('/me/profile/cv/link', { method: 'POST' });
      window.location.assign(link.url);
    } catch (err) {
      setError(errs.message(err));
    } finally {
      setDownloading(false);
    }
  }

  const analysisSector =
    cv.analysis?.status === 'COMPLETED' ? name(byId(lists.sectors, cv.analysis.sectorId)) : '';

  return (
    <>
      <PageHeader title={t('title')} lead={t('summaryLead')} />
      <div className="mb-4">
        <Badge variant="match" icon="check">
          {t('completeBadge')}
        </Badge>
      </div>
      <Alert>{error}</Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section step="personal" n={1}>
          {p ? (
            <Kv
              rows={[
                [t('fullName'), [p.firstName, p.fatherName, p.grandfatherName, p.familyName].join(' ')],
                [
                  p.idType === 'PASSPORT' ? t('passNo') : t('idNo'),
                  <span key="id" dir="ltr">
                    {p.idNumberMasked}
                  </span>,
                ],
                [t('gender'), p.gender === 'MALE' ? t('male') : t('female')],
                [
                  t('birth'),
                  `${formatDate(p.birthDate, locale)} · ${ageFrom(p.birthDate) ?? '—'} ${t('yearsUnit')}`,
                ],
                [t('nationality'), or(name(byId(lists.countries, p.nationalityId)))],
                [t('specialNeeds'), p.hasSpecialNeeds ? t('yes') : t('no')],
              ]}
            />
          ) : (
            none
          )}
        </Section>
        <Section step="affiliation" n={2}>
          <Kv
            rows={[
              [t('dar'), or(name(byId(lists.dars, a.darId)))],
              [t('fakhdh'), or(name(byId(lists.fakhdhs, a.fakhdhId)))],
            ]}
          />
        </Section>
        <Section step="contact" n={3}>
          <Kv
            rows={[
              [t('mobile'), c.mobile ? <span dir="ltr">{localSaudiMobile(c.mobile)}</span> : none],
              [t('email'), c.email ? <span dir="ltr">{c.email}</span> : none],
            ]}
          />
        </Section>
        <Section step="education" n={4}>
          {ed ? (
            <Kv
              rows={[
                [t('eduLevel'), or(name(byId(lists['education-levels'], ed.educationLevelId)))],
                [t('gradYear'), or(ed.graduationYear)],
                [t('inst'), ed.institution],
                [t('gradCountry'), or(name(byId(lists.countries, ed.countryId)))],
                [t('major'), or(ed.fieldOfStudy)],
              ]}
            />
          ) : (
            none
          )}
        </Section>
        <Section step="experience" n={5}>
          {ex.hasExperience ? (
            <>
              <Kv rows={[[t('expYears'), `${ex.yearsOfExperience ?? '—'} ${t('yearsUnit')}`]]} />
              <ol className="my-3 list-none space-y-2 p-0">
                {ex.positions.map((pos) => (
                  <li key={pos.id} className="rounded-md bg-surface-2 px-3 py-2">
                    <p className="m-0 font-semibold">
                      {pos.title}
                      {pos.organization && (
                        <span className="font-normal text-text-muted"> · {pos.organization}</span>
                      )}
                      {pos.sectorId && (
                        <span className="font-normal text-text-muted">
                          {' '}
                          · {name(byId(lists.sectors, pos.sectorId))}
                        </span>
                      )}
                    </p>
                    <p className="m-0 text-sm text-text-muted">
                      {formatMonth(pos.startDate, locale)} –{' '}
                      {pos.endDate ? formatMonth(pos.endDate, locale) : t('present')}
                    </p>
                  </li>
                ))}
              </ol>
              <Kv
                rows={[
                  [
                    t('verifier'),
                    ex.verifier ? (
                      <>
                        {ex.verifier.name}
                        {[ex.verifier.phone, ex.verifier.email].filter(Boolean).map((v) => (
                          <span key={v} dir="ltr" className="block text-sm text-text-muted">
                            {v && v.startsWith('+966') ? localSaudiMobile(v) : v}
                          </span>
                        ))}
                      </>
                    ) : (
                      none
                    ),
                  ],
                ]}
              />
            </>
          ) : ex.hasExperience === false ? (
            <p className="m-0">{t('noExperience')}</p>
          ) : (
            none
          )}
        </Section>
        <Section step="cv" n={6}>
          {cv.file ? (
            <>
              <p className="m-0 flex items-start gap-2 font-medium [overflow-wrap:anywhere]">
                <Icon name="file" className="mt-0.5 h-5 w-5 text-primary" />
                <span dir="auto">{cv.file.originalName}</span>
              </p>
              <p className="mb-3 mt-1 text-[13px] text-text-muted">
                <span dir="ltr">{formatBytes(cv.file.sizeBytes)}</span> ·{' '}
                {t('uploadedOn', { date: formatDate(cv.file.uploadedAt, locale) })}
              </p>
              {analysisSector && <Kv rows={[[t('suggestedSector'), analysisSector]]} />}
              <Button variant="secondary" size="sm" className="mt-3" onClick={download} loading={downloading}>
                <Icon name="download" className="h-4 w-4" />
                {t('download')}
              </Button>
            </>
          ) : (
            <p className="m-0 text-text-muted">{t('noCv')}</p>
          )}
        </Section>
      </div>
    </>
  );
}

function Section({ step, n, children }: { step: WizardStep; n: number; children: ReactNode }) {
  const t = useTranslations('profile');
  const title = t(`steps.${step}`);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <ButtonLink
          href={stepHref(n)}
          variant="ghost"
          size="sm"
          aria-label={t('editSection', { section: title })}
        >
          <Icon name="pencil" className="h-4 w-4" />
          {t('edit')}
        </ButtonLink>
      </div>
      {children}
    </Card>
  );
}
