'use client';

import {
  EMPLOYMENT_TYPES,
  JOB_LIMITS,
  type EmployerAccountDto,
  type EmployerJobDto,
  type EmploymentType,
} from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import { useLookupOptions, useLookups } from '@/lib/lookups';
import { useApi } from '@/lib/use-api';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Note,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@/components/ui';
import { BackLink, LoadState } from '@/components/jobs/job-ui';
import { Pending } from './EmployerHome';

type Draft = {
  title: string;
  sectorId: string;
  city: string;
  countryId: string;
  requiredEducationLevelId: string;
  minYearsExperience: string;
  employmentType: EmploymentType;
  description: string;
};

const fromJob = (j: EmployerJobDto): Draft => ({
  title: j.title,
  sectorId: j.sectorId,
  city: j.city,
  countryId: j.countryId,
  requiredEducationLevelId: j.requiredEducationLevelId ?? '',
  minYearsExperience: String(j.minYearsExperience),
  employmentType: j.employmentType,
  description: j.description,
});

/** S-13: post a job, or edit an open one (FR-2.3.1). Only approved employers (server enforced). */
export function JobForm({ jobId }: { jobId?: string }) {
  const t = useTranslations('employer');
  const tj = useTranslations('jobs');
  const tc = useTranslations('common');
  const account = useApi<EmployerAccountDto>('/employer/account');
  const existing = useApi<EmployerJobDto>(jobId ? `/employer/jobs/${jobId}` : null);
  const title = jobId ? t('editTitle') : t('postTitle');
  const back = (
    <ButtonLink href="/employer" variant="ghost" className="mb-2">
      <BackLink>{tc('backTo')}</BackLink>
    </ButtonLink>
  );

  if (account.data && account.data.approvalStatus !== 'APPROVED') return <Pending account={account.data} />;
  const failed = account.error ?? existing.error;
  if (!account.data || (jobId && !existing.data)) {
    return (
      <div className="mx-auto max-w-form">
        {back}
        <PageHeader title={title} />
        <LoadState
          loading={!failed}
          error={failed}
          title={failed === 'JOB_NOT_FOUND' ? tj('notAvailableTitle') : t('loadFailed')}
          onRetry={() => {
            account.reload();
            existing.reload();
          }}
          label={title}
        />
      </div>
    );
  }
  if (existing.data && existing.data.status !== 'OPEN') {
    return (
      <div className="mx-auto max-w-form">
        {back}
        <PageHeader title={title} lead={existing.data.title} />
        <Note kind="info">{t('jobClosedNote')}</Note>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-form">
      {back}
      <PageHeader title={title} />
      <Editor jobId={jobId} initial={existing.data ? fromJob(existing.data) : null} />
    </div>
  );
}

function Editor({ jobId, initial }: { jobId?: string; initial: Draft | null }) {
  const t = useTranslations('employer');
  const tj = useTranslations('jobs');
  const tv = useTranslations('validation');
  const router = useRouter();
  const toast = useToast();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const { lists } = useLookups(['sectors', 'countries', 'education-levels']);
  const options = useLookupOptions();
  const [d, setD] = useState<Draft>(
    initial ?? {
      title: '',
      sectorId: '',
      city: '',
      countryId: '',
      requiredEducationLevelId: '',
      minYearsExperience: '0',
      employmentType: 'FULL_TIME',
      description: '',
    },
  );
  const [fe, setFe] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD((s) => ({ ...s, [k]: e.target.value }));

  // Saudi Arabia by default for a new job, once the list is loaded.
  useEffect(() => {
    if (!initial && !d.countryId && lists.countries) {
      const sa = lists.countries.find((c) => c.code === 'SA');
      if (sa) setD((s) => ({ ...s, countryId: sa.id }));
    }
  }, [initial, d.countryId, lists.countries]);

  function validate(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!d.title.trim()) out.title = tv('required');
    if (!d.sectorId) out.sectorId = tv('required');
    if (!d.city.trim()) out.city = tv('required');
    if (!d.countryId) out.countryId = tv('required');
    const years = Number(d.minYearsExperience);
    if (
      d.minYearsExperience.trim() === '' ||
      !Number.isInteger(years) ||
      years < 0 ||
      years > JOB_LIMITS.maxYears
    ) {
      out.minYearsExperience = t('yearsRange', { max: JOB_LIMITS.maxYears });
    }
    if (d.description.trim().length < JOB_LIMITS.descriptionMin) {
      out.description = d.description.trim()
        ? t('descTooShort', { n: JOB_LIMITS.descriptionMin })
        : tv('required');
    }
    return out;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    setFe(v);
    setFormError(Object.keys(v).length ? tv('fixErrors') : null);
    if (Object.keys(v).length) return focusFirstInvalid(form.current);
    setBusy(true);
    const body = {
      ...d,
      requiredEducationLevelId: d.requiredEducationLevelId || null,
      minYearsExperience: Number(d.minYearsExperience),
    };
    try {
      if (jobId) {
        await api<EmployerJobDto>(`/employer/jobs/${jobId}`, { method: 'PATCH', body });
        toast(t('savedToast'));
      } else {
        await api<EmployerJobDto>('/employer/jobs', { body });
        toast(t('publishedToast'));
      }
      router.push('/employer');
    } catch (err) {
      setFe(errs.fields(err));
      setFormError(errs.message(err));
      setBusy(false);
      focusFirstInvalid(form.current);
    }
  }

  return (
    <Card>
      <form ref={form} noValidate onSubmit={onSubmit}>
        <Note kind="privacy">{t('postNote')}</Note>
        <Alert>{formError}</Alert>
        <TextField
          id="pj-title"
          label={t('jobTitle')}
          maxLength={JOB_LIMITS.titleMax}
          value={d.title}
          onChange={set('title')}
          error={fe.title}
        />
        <SelectField
          id="pj-sec"
          label={t('sector')}
          options={options(lists.sectors, initial?.sectorId)}
          value={d.sectorId}
          onChange={set('sectorId')}
          error={fe.sectorId}
        />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <TextField
            id="pj-city"
            label={t('city')}
            maxLength={JOB_LIMITS.cityMax}
            value={d.city}
            onChange={set('city')}
            error={fe.city}
          />
          <SelectField
            id="pj-country"
            label={t('country')}
            options={options(lists.countries, initial?.countryId)}
            value={d.countryId}
            onChange={set('countryId')}
            error={fe.countryId}
          />
        </div>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <SelectField
            id="pj-edu"
            label={t('reqEdu')}
            optional
            placeholder={t('anyEdu')}
            options={options(lists['education-levels'], initial?.requiredEducationLevelId)}
            value={d.requiredEducationLevelId}
            onChange={set('requiredEducationLevelId')}
            error={fe.requiredEducationLevelId}
          />
          <TextField
            id="pj-years"
            type="number"
            label={t('reqYears')}
            ltr
            inputMode="numeric"
            min={0}
            max={JOB_LIMITS.maxYears}
            value={d.minYearsExperience}
            onChange={set('minYearsExperience')}
            error={fe.minYearsExperience}
          />
        </div>
        <SelectField
          id="pj-type"
          label={tj('employmentType')}
          options={EMPLOYMENT_TYPES.map((x) => ({ value: x, label: tj(`empType.${x}`) }))}
          value={d.employmentType}
          onChange={set('employmentType')}
          error={fe.employmentType}
        />
        <TextAreaField
          id="pj-desc"
          label={t('desc')}
          hint={t('descHint')}
          maxLength={JOB_LIMITS.descriptionMax}
          value={d.description}
          onChange={set('description')}
          error={fe.description}
        />
        <Button type="submit" block loading={busy}>
          {jobId ? t('saveChanges') : t('publish')}
        </Button>
      </form>
    </Card>
  );
}
