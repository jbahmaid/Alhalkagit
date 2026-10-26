'use client';

import type { OwnJobsReportDto, ReportCount, ReportFilters, ReportRow, ReportsDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext, useId, useState, type FormEvent, type ReactNode } from 'react';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useLookupName, useLookupOptions, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/use-auth';
import { Button, Card, Note, PageHeader, SelectField, TextField } from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import { DataTable, ExportButton, Td, Tr } from '@/components/admin/admin-ui';

/** The server's minimum group size, for the "hidden (fewer than N)" wording. */
const MinGroup = createContext(5);

const EMPTY: Required<ReportFilters> = { from: '', to: '', sectorId: '', countryId: '' };
const clean = (f: ReportFilters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as ReportFilters;

/**
 * S-22 (FR-2.5.1 to FR-2.5.3). Aggregates only; groups under the minimum size arrive from the
 * server as null and are shown as "hidden". Admins filter and export; employers see the general
 * reports and their own jobs, and never get an export button.
 */
export function Reports({ scope }: { scope: 'admin' | 'employer' }) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { user } = useAuth();
  const admin = scope === 'admin';
  const [draft, setDraft] = useState<Required<ReportFilters>>(EMPTY);
  const [filters, setFilters] = useState<ReportFilters>({});
  const qs = new URLSearchParams(clean(filters) as Record<string, string>).toString();
  const { data, error, loading, reload } = useApi<ReportsDto>(`/reports${qs ? `?${qs}` : ''}`);
  const canExport = admin && (user?.role === 'SUPER_ADMIN' || user?.permissions.includes('data.export'));

  return (
    <>
      <PageHeader title={t('title')} lead={admin ? t('lead') : t('employerLead')} />
      <Note kind="privacy" icon="shield">
        {t('under5', { min: data?.minGroupSize ?? 5 })}
      </Note>
      {admin && (
        <Filters
          draft={draft}
          setDraft={setDraft}
          onApply={() => setFilters(clean(draft))}
          onClear={() => {
            setDraft(EMPTY);
            setFilters({});
          }}
        />
      )}
      {canExport && (
        <div className="mb-4">
          <ExportButton kind="reports" filters={{ reports: clean(filters) }} />
        </div>
      )}
      {!data ? (
        <LoadState
          loading={loading}
          error={error}
          title={tc('loadFailed')}
          onRetry={reload}
          label={t('title')}
        />
      ) : (
        <MinGroup.Provider value={data.minGroupSize}>
          <div aria-busy={loading}>
            {data.own && <OwnJobs own={data.own} />}
            <Section title={t('seekersTitle')}>
              <Stats
                items={[
                  ['seekersTotal', t('seekersTotal'), data.seekers.total],
                  ['withExperience', t('withExperience'), data.seekers.withExperience],
                  ['withoutExperience', t('withoutExperience'), data.seekers.withoutExperience],
                ]}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <BarChart
                  id="byAge"
                  title={t('byAge')}
                  rows={data.seekers.byAge}
                  label={(r) => t(`age.${r.key}`)}
                />
                <BarChart
                  id="byGender"
                  title={t('byGender')}
                  rows={data.seekers.byGender}
                  label={(r) => t(`gender.${r.key}`)}
                />
                <BarChart id="byEducation" title={t('byEducation')} rows={data.seekers.byEducation} />
                <BarChart
                  id="byExperience"
                  title={t('byExperience')}
                  rows={data.seekers.byExperience}
                  label={(r) => t(`experience.${r.key}`)}
                />
                <BarChart
                  id="bySectorSeekers"
                  title={t('bySectorSeekers')}
                  note={t('bySectorSeekersNote')}
                  rows={data.seekers.bySector}
                />
                <BarChart id="byNationality" title={t('byNationality')} rows={data.seekers.byNationality} />
              </div>
            </Section>
            <Section title={t('jobsTitle')}>
              <Stats
                items={[
                  ['jobsTotal', t('jobsTotal'), data.jobs.total],
                  ['open', t('open'), data.jobs.open],
                  ['unavailable', t('unavailable'), data.jobs.unavailable],
                  ['hiredViaPlatform', t('hiredViaPlatform'), data.jobs.hiredViaPlatform],
                  ['closedWithoutHiring', t('closedWithoutHiring'), data.jobs.closedWithoutHiring],
                  ['interestRequests', t('interestRequests'), data.jobs.interestRequests],
                ]}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <BarChart id="bySectorJobs" title={t('bySectorJobs')} rows={data.jobs.bySector} />
                <BarChart
                  id="byStatus"
                  title={t('byStatus')}
                  rows={data.jobs.byStatus}
                  label={(r) => t(`status.${r.key}`)}
                  accent
                />
              </div>
            </Section>
            <p className="mt-4 text-xs text-text-muted">
              {t('generatedAt', { at: formatDateTime(data.generatedAt, locale) })}
            </p>
          </div>
        </MinGroup.Provider>
      )}
    </>
  );
}

function Filters({
  draft,
  setDraft,
  onApply,
  onClear,
}: {
  draft: Required<ReportFilters>;
  setDraft: (f: Required<ReportFilters>) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const t = useTranslations('reports');
  const options = useLookupOptions();
  const { lists } = useLookups(['sectors', 'countries']);
  const set = (k: keyof ReportFilters) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [k]: e.target.value });
  function submit(e: FormEvent) {
    e.preventDefault();
    onApply();
  }
  return (
    <form
      role="search"
      aria-label={t('filters')}
      onSubmit={submit}
      className="grid items-end gap-x-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <TextField
        id="rf-from"
        type="date"
        ltr
        label={t('from')}
        required={false}
        value={draft.from}
        onChange={set('from')}
      />
      <TextField
        id="rf-to"
        type="date"
        ltr
        label={t('to')}
        required={false}
        value={draft.to}
        onChange={set('to')}
      />
      <SelectField
        id="rf-sector"
        label={t('sector')}
        required={false}
        placeholder={t('allSectors')}
        options={options(lists.sectors, draft.sectorId)}
        value={draft.sectorId}
        onChange={set('sectorId')}
      />
      <SelectField
        id="rf-country"
        label={t('country')}
        required={false}
        placeholder={t('allCountries')}
        options={options(lists.countries, draft.countryId)}
        value={draft.countryId}
        onChange={set('countryId')}
      />
      <div className="mb-4 flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="secondary">
          {t('apply')}
        </Button>
        <Button variant="ghost" onClick={onClear}>
          {t('clear')}
        </Button>
      </div>
      <p className="col-span-full -mt-2 mb-4 text-sm text-text-muted">{t('filtersNote')}</p>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-6">
      <h2 id={id} className="mb-3 mt-6 text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A number, or "hidden (fewer than 5)". */
function Count({ value, className = '' }: { value: ReportCount; className?: string }) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const min = useContext(MinGroup);
  return value === null ? (
    <span className={`text-sm font-normal text-text-muted ${className}`}>{t('hidden', { min })}</span>
  ) : (
    <span className={`tabular-nums ${className}`}>{formatNumber(value, locale)}</span>
  );
}

function Stats({ items }: { items: [string, string, ReportCount][] }) {
  return (
    <dl className="m-0 mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
      {items.map(([key, label, value]) => (
        <div
          key={key}
          className="flex flex-col-reverse rounded-lg border border-border bg-surface px-4 py-3.5"
        >
          <dt className="text-[13px] text-text-muted">{label}</dt>
          <dd className="m-0 text-[26px] font-bold leading-tight" data-stat={key}>
            <Count value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Horizontal SVG bars (prototype `bars`). The drawing is one role="img" whose name is the title
 * and whose description lists every bar in words, hidden ones included.
 */
function BarChart({
  id,
  title,
  rows,
  label,
  note,
  accent = false,
}: {
  id: string;
  title: string;
  rows: ReportRow[];
  label?: (r: ReportRow) => string;
  note?: string;
  accent?: boolean;
}) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const name = useLookupName();
  const min = useContext(MinGroup);
  const rtl = locale === 'ar';
  const nameOf = (r: ReportRow) =>
    label
      ? label(r)
      : r.nameAr || r.nameEn
        ? name({ nameAr: r.nameAr ?? '', nameEn: r.nameEn ?? '' })
        : t('unspecified');
  const max = Math.max(1, ...rows.map((r) => r.count ?? 0));
  const desc = rows.length
    ? rows
        .map(
          (r) => `${nameOf(r)}: ${r.count === null ? t('hidden', { min }) : formatNumber(r.count, locale)}`,
        )
        .join(rtl ? '، ' : ', ')
    : t('noData');
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  return (
    <Card>
      <figure className="m-0" data-chart={id}>
        <figcaption id={titleId} className="mb-1 font-semibold">
          {title}
        </figcaption>
        {note && <p className="mt-0 text-xs text-text-muted">{note}</p>}
        <p id={descId} className="sr-only">
          {desc}
        </p>
        <div role="img" aria-labelledby={titleId} aria-describedby={descId} className="mt-2 space-y-2.5">
          {rows.length === 0 && <p className="m-0 text-sm text-text-muted">{t('noData')}</p>}
          {rows.map((r) => {
            const hidden = r.count === null;
            const w = hidden ? 100 : Math.max(2, ((r.count ?? 0) / max) * 100);
            const x = rtl ? 100 - w : 0;
            return (
              <div key={r.key} data-row={r.key} data-count={r.count ?? 'hidden'}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{nameOf(r)}</span>
                  <Count value={r.count} className="flex-none font-semibold" />
                </div>
                <svg
                  viewBox="0 0 100 14"
                  preserveAspectRatio="none"
                  className="block h-3.5 w-full"
                  focusable="false"
                  aria-hidden="true"
                >
                  <rect x="0" y="0" width="100" height="14" rx="1.5" fill="var(--color-surface-2)" />
                  {hidden ? (
                    <rect
                      x="0.5"
                      y="0.5"
                      width="99"
                      height="13"
                      fill="none"
                      stroke="var(--color-border)"
                      strokeDasharray="2 1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <rect
                      x={x}
                      y="0"
                      width={w}
                      height="14"
                      rx="1.5"
                      fill={accent ? 'var(--color-accent)' : 'var(--color-primary)'}
                    />
                  )}
                </svg>
              </div>
            );
          })}
        </div>
      </figure>
    </Card>
  );
}

/** Employer: their own jobs in numbers, and per job (titles only, no person). */
function OwnJobs({ own }: { own: OwnJobsReportDto }) {
  const t = useTranslations('reports');
  const tj = useTranslations('reports.status');
  const locale = useLocale();
  const status = (j: OwnJobsReportDto['jobs'][number]) =>
    j.status === 'OPEN' ? tj('OPEN') : tj(j.closedOutcome ?? 'CLOSED_WITHOUT_HIRING');
  return (
    <Section title={t('ownTitle')}>
      <dl className="m-0 mb-4 grid grid-cols-2 gap-3 md:grid-cols-3" data-own>
        {(
          [
            ['ownTotal', t('jobsTotal'), own.total],
            ['ownOpen', t('open'), own.open],
            ['ownInterest', t('interestRequests'), own.interestRequests],
            ['ownHired', t('hiredViaPlatform'), own.hiredViaPlatform],
            ['ownClosed', t('closedWithoutHiring'), own.closedWithoutHiring],
          ] as const
        ).map(([key, label, value]) => (
          <div
            key={key}
            className="flex flex-col-reverse rounded-lg border border-border bg-surface px-4 py-3.5"
          >
            <dt className="text-[13px] text-text-muted">{label}</dt>
            <dd className="m-0 text-[26px] font-bold leading-tight tabular-nums" data-stat={key}>
              {formatNumber(value, locale)}
            </dd>
          </div>
        ))}
      </dl>
      {own.jobs.length ? (
        <DataTable head={[t('jobTitle'), t('jobStatus'), t('interestRequests')]}>
          {own.jobs.map((j) => (
            <Tr key={j.id}>
              <Td label={t('jobTitle')}>
                <strong>{j.title}</strong>
              </Td>
              <Td label={t('jobStatus')}>{status(j)}</Td>
              <Td label={t('interestRequests')} className="tabular-nums">
                {formatNumber(j.interestRequests, locale)}
              </Td>
            </Tr>
          ))}
        </DataTable>
      ) : (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-text-muted">
          {t('ownEmpty')}
        </p>
      )}
    </Section>
  );
}
