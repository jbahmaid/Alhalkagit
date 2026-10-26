'use client';

import type { SeekerJobDto, SeekerJobListDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { formatDate } from '@/lib/format';
import { useLookupName, useLookups, type Lookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import {
  Badge,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  Note,
  PageHeader,
  SelectField,
  TextField,
} from '@/components/ui';
import { LoadState, MatchBadge, Meta } from './job-ui';

/** S-07: open jobs ranked by fit, with search, sector, city and "suitable/near only". */
export function SeekerJobs() {
  const t = useTranslations('jobs');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [city, setCity] = useState('');
  const [fit, setFit] = useState(false);
  const { lists } = useLookups(['sectors', 'education-levels', 'countries']);
  const name = useLookupName();

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set('q', debounced);
    if (sectorId) p.set('sectorId', sectorId);
    if (city) p.set('city', city);
    if (fit) p.set('fit', 'true');
    const s = p.toString();
    return `/jobs${s ? `?${s}` : ''}`;
  }, [debounced, sectorId, city, fit]);
  const { data, error, loading, reload } = useApi<SeekerJobListDto>(path);
  // Keep the city list from the first answer so filtering does not shrink it.
  const [cities, setCities] = useState<string[]>([]);
  useEffect(() => {
    if (data && data.cities.length > cities.length) setCities(data.cities);
  }, [data, cities.length]);

  const thresholds = data?.thresholds ?? { suitable: 70, near: 45 };

  return (
    <>
      <PageHeader title={t('title')} lead={t('lead')} />
      <Note kind="privacy">{t('anonNote')}</Note>
      <div role="search" className="grid gap-x-3 md:grid-cols-[2fr_1fr_1fr]">
        <TextField
          id="jq"
          type="search"
          label={t('search')}
          placeholder={t('searchPlaceholder')}
          optional
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          id="js"
          label={t('sector')}
          optional
          placeholder={t('allSectors')}
          options={(lists.sectors ?? []).map((s) => ({ value: s.id, label: name(s) }))}
          value={sectorId}
          onChange={(e) => setSectorId(e.target.value)}
        />
        <SelectField
          id="jc"
          label={t('city')}
          optional
          placeholder={t('allCities')}
          options={cities.map((c) => ({ value: c, label: c }))}
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      </div>
      <Checkbox id="jf" label={t('fitOnly')} checked={fit} onChange={(e) => setFit(e.target.checked)} />
      <div className="mb-3 mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge variant="match" icon="check">
          {t('legendSuitable', { n: thresholds.suitable })}
        </Badge>
        <Badge variant="near" icon="approx">
          {t('legendNear', { from: thresholds.near, to: thresholds.suitable - 1 })}
        </Badge>
      </div>
      <LoadState
        loading={loading && !data}
        error={error}
        title={t('loadFailed')}
        onRetry={reload}
        label={t('title')}
      />
      {data && !error && (
        <>
          <p className="mb-3 mt-0 text-sm text-text-muted" role="status">
            {t('results', { n: data.items.length })}
          </p>
          {data.items.length ? (
            <div className="grid gap-3">
              {data.items.map((j) => (
                <JobCard key={j.id} job={j} lists={lists} />
              ))}
            </div>
          ) : (
            <EmptyState icon="brief" title={t('noJobs')} />
          )}
        </>
      )}
    </>
  );
}

function JobCard({ job, lists }: { job: SeekerJobDto; lists: Lookups }) {
  const t = useTranslations('jobs');
  const locale = useLocale();
  const headingId = `jt-${job.id}`;
  return (
    <Card className="!p-4" aria-labelledby={headingId} role="article">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <h2 id={headingId} className="m-0 text-lg font-semibold">
          {job.title}
        </h2>
        <MatchBadge score={job.match.score} label={job.match.label} />
      </div>
      <JobFacts job={job} lists={lists} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-text-muted">
          {t('posted')} {formatDate(job.publishedAt, locale)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {job.interest && (
            <Badge variant="primary" icon="check">
              {t('sent')}
            </Badge>
          )}
          <ButtonLink
            href={`/seeker/jobs/${job.id}`}
            variant="secondary"
            size="sm"
            aria-describedby={headingId}
          >
            {t('details')}
            <Icon name="chev" className="h-4 w-4" flipInRtl />
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

/** Sector, place, education and experience of a job. */
export function JobFacts({
  job,
  lists,
}: {
  job: Pick<
    SeekerJobDto,
    'sectorId' | 'city' | 'countryId' | 'requiredEducationLevelId' | 'minYearsExperience'
  >;
  lists: Lookups;
}) {
  const t = useTranslations('jobs');
  const locale = useLocale();
  const name = useLookupName();
  const sector = lists.sectors?.find((s) => s.id === job.sectorId);
  const country = lists.countries?.find((c) => c.id === job.countryId);
  const edu = lists['education-levels']?.find((e) => e.id === job.requiredEducationLevelId);
  return (
    <Meta
      items={[
        ['brief', name(sector)],
        ['pin', [job.city, name(country)].filter(Boolean).join(locale === 'ar' ? '، ' : ', ')],
        ['cap', edu ? name(edu) : t('anyEducation')],
        ['clock', job.minYearsExperience > 0 ? t('expN', { n: job.minYearsExperience }) : t('noExp')],
      ]}
    />
  );
}
