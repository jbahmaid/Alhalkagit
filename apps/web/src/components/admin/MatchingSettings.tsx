'use client';

import type { MatchingSettingsDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import { useApi } from '@/lib/use-api';
import { Alert, Button, Card, PageHeader, TextField, useToast } from '@/components/ui';
import { LoadState } from '@/components/jobs/job-ui';
import { Group } from '@/components/profile/step-kit';

const WEIGHTS = ['sector', 'education', 'experience', 'keywords'] as const;
type Draft = Record<(typeof WEIGHTS)[number] | 'suitable' | 'near', string>;

/** Matching weights and thresholds (settings.manage). Saving queues a full recompute. */
export function MatchingSettings() {
  const t = useTranslations('admin.settings');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const toast = useToast();
  const errs = useApiErrors();
  const { data, error, loading, reload } = useApi<MatchingSettingsDto>('/admin/settings/matching');
  const [d, setD] = useState<Draft | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !d)
      setD({
        ...(Object.fromEntries(WEIGHTS.map((k) => [k, String(data.weights[k])])) as Record<
          (typeof WEIGHTS)[number],
          string
        >),
        suitable: String(data.thresholds.suitable),
        near: String(data.thresholds.near),
      });
  }, [data, d]);

  if (!d) {
    return (
      <>
        <PageHeader title={t('title')} lead={t('lead')} />
        <LoadState
          loading={loading}
          error={error}
          title={tc('loadFailed')}
          onRetry={reload}
          label={t('title')}
        />
      </>
    );
  }

  const num = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s) : NaN);
  const sum = WEIGHTS.reduce((acc, k) => acc + (Number.isNaN(num(d[k])) ? 0 : num(d[k])), 0);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!d || busy) return;
    const errors: Record<string, string> = {};
    for (const k of WEIGHTS) if (Number.isNaN(num(d[k])) || num(d[k]) > 100) errors[k] = tv('number');
    for (const k of ['suitable', 'near'] as const)
      if (Number.isNaN(num(d[k])) || num(d[k]) < 1 || num(d[k]) > 100) errors[k] = tv('number');
    if (!Object.keys(errors).length) {
      if (sum !== 100) errors.weights = tv('weightsSum');
      if (num(d.near) >= num(d.suitable)) errors.near = tv('thresholdOrder');
    }
    setFe(errors);
    if (Object.keys(errors).length) {
      setFormError(errors.weights ?? tv('fixErrors'));
      return focusFirstInvalid(form);
    }
    setBusy(true);
    setFormError(null);
    try {
      await api<MatchingSettingsDto>('/admin/settings/matching', {
        method: 'PUT',
        body: {
          weights: Object.fromEntries(WEIGHTS.map((k) => [k, num(d[k])])),
          thresholds: { suitable: num(d.suitable), near: num(d.near) },
        },
      });
      toast(t('savedToast'));
    } catch (err) {
      const mapped = errs.fields(err);
      // thresholds.near -> near (the input's name here)
      const flat = Object.fromEntries(
        Object.entries(mapped).map(([k, v]) => [k.replace('thresholds.', ''), v]),
      );
      setFe(flat);
      setFormError(flat.weights ?? (Object.keys(flat).length ? tv('fixErrors') : errs.message(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t('title')} lead={t('lead')} />
      <Card className="max-w-[720px]">
        <form onSubmit={submit} noValidate>
          <Alert>{formError}</Alert>
          <Group legend={t('weights')}>
            <p
              id="w-sum"
              role="status"
              className={`mt-0 text-sm ${sum === 100 ? 'text-text-muted' : 'text-danger'}`}
            >
              {t('weightsHint', { sum })}
            </p>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {WEIGHTS.map((k) => (
                <TextField
                  key={k}
                  id={`w-${k}`}
                  label={t(k)}
                  ltr
                  inputMode="numeric"
                  aria-describedby="w-sum"
                  value={d[k]}
                  onChange={set(k)}
                  error={fe[k]}
                />
              ))}
            </div>
          </Group>
          <Group legend={t('thresholds')}>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <TextField
                id="t-suitable"
                label={t('suitable')}
                ltr
                inputMode="numeric"
                value={d.suitable}
                onChange={set('suitable')}
                error={fe.suitable}
              />
              <TextField
                id="t-near"
                label={t('near')}
                ltr
                inputMode="numeric"
                value={d.near}
                onChange={set('near')}
                error={fe.near}
              />
            </div>
          </Group>
          <Button type="submit" loading={busy}>
            {t('save')}
          </Button>
        </form>
      </Card>
    </>
  );
}
