'use client';

import type { ApplicantsDto, EmployerJobDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import { useApi } from '@/lib/use-api';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ChoiceGroup,
  Note,
  PageHeader,
  SelectField,
  useToast,
} from '@/components/ui';
import { BackLink, LoadState } from '@/components/jobs/job-ui';

type Outcome = 'HIRED_VIA_PLATFORM' | 'CLOSED_WITHOUT_HIRING';

/** S-16: close a job, hired via the platform (choosing the person) or without hiring (FR-2.3.4). */
export function CloseJob({ jobId }: { jobId: string }) {
  const t = useTranslations('employer');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const router = useRouter();
  const toast = useToast();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const { data, error, loading, reload } = useApi<ApplicantsDto>(`/employer/jobs/${jobId}/applicants`);
  const [outcome, setOutcome] = useState<Outcome>('HIRED_VIA_PLATFORM');
  const [who, setWho] = useState('');
  const [whoError, setWhoError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noApplicants = !!data && data.applicants.length === 0;

  useEffect(() => {
    if (noApplicants) setOutcome('CLOSED_WITHOUT_HIRING');
  }, [noApplicants]);

  const back = (
    <ButtonLink href="/employer" variant="ghost" className="mb-2">
      <BackLink>{tc('backTo')}</BackLink>
    </ButtonLink>
  );

  if (!data) {
    return (
      <div className="mx-auto max-w-form">
        {back}
        <PageHeader title={t('closeTitle')} />
        <LoadState
          loading={loading}
          error={error}
          title={t('loadFailed')}
          onRetry={reload}
          label={t('closeTitle')}
        />
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (outcome === 'HIRED_VIA_PLATFORM' && !who) {
      setWhoError(tv('required'));
      setFormError(tv('fixErrors'));
      return focusFirstInvalid(form.current);
    }
    setWhoError(undefined);
    setBusy(true);
    try {
      await api<EmployerJobDto>(`/employer/jobs/${jobId}/close`, {
        body: outcome === 'HIRED_VIA_PLATFORM' ? { outcome, hiredInterestId: who } : { outcome },
      });
      toast(t('closedToast'));
      router.push('/employer');
    } catch (err) {
      setFormError(errs.message(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-form">
      {back}
      <PageHeader title={t('closeTitle')} lead={data.job.title} />
      {data.job.status !== 'OPEN' ? (
        <Note kind="info">{t('alreadyClosed')}</Note>
      ) : (
        <Card>
          <form ref={form} noValidate onSubmit={onSubmit}>
            <Alert>{formError}</Alert>
            <ChoiceGroup
              legend={t('outcome')}
              name="outcome"
              value={outcome}
              onChange={(v) => setOutcome(v as Outcome)}
              options={[
                ...(noApplicants ? [] : [{ value: 'HIRED_VIA_PLATFORM', label: t('outHired') }]),
                { value: 'CLOSED_WITHOUT_HIRING', label: t('outNone') },
              ]}
            />
            {noApplicants && <Note kind="info">{t('noApplicantsToHire')}</Note>}
            {outcome === 'HIRED_VIA_PLATFORM' && (
              <SelectField
                id="cj-who"
                label={t('pickHired')}
                options={data.applicants.map((a) => ({ value: a.interestId, label: a.fullName }))}
                value={who}
                onChange={(e) => setWho(e.target.value)}
                error={whoError}
              />
            )}
            <Note kind="warn">{t('closeWarn')}</Note>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy}>
                {t('confirmClose')}
              </Button>
              <ButtonLink href="/employer" variant="secondary">
                {tc('cancel')}
              </ButtonLink>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
