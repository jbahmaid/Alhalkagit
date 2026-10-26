'use client';

import { WIZARD_STEPS, type ProfileDto } from '@sanad/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ComponentType, type FormEvent, type RefAttributes } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { focusFirstInvalid, useApiErrors } from '@/lib/errors';
import type { Lookups } from '@/lib/lookups';
import { PROFILE_PATH } from '@/lib/use-profile';
import { Alert, Button, ButtonLink, Icon, PageHeader, Spinner, useToast } from '@/components/ui';
import { CvStep } from './CvStep';
import { ExperienceStep } from './ExperienceStep';
import { PersonalStep } from './PersonalStep';
import { AffiliationStep, ContactStep, EducationStep } from './SimpleSteps';
import type { StepHandle, StepProps } from './step-kit';

const STEP_COMPONENTS: ComponentType<StepProps & RefAttributes<StepHandle>>[] = [
  PersonalStep,
  AffiliationStep,
  ContactStep,
  EducationStep,
  ExperienceStep,
  CvStep,
];

export const stepHref = (n: number) => `${PROFILE_PATH}?step=${n}`;

/**
 * S-05 + S-06: the six-step wizard. "Next" saves the step and moves on; "Finish later" saves
 * and leaves; "Back" goes to the previous step. In edit mode (profile already completed) a single
 * step is shown with "Save changes", and saving returns to the summary.
 */
export function ProfileWizard({
  step,
  profile,
  lists,
  editing,
  onProfile,
}: {
  step: number;
  profile: ProfileDto;
  lists: Lookups;
  editing: boolean;
  onProfile: (p: ProfileDto) => void;
}) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const errs = useApiErrors();
  const form = useRef<HTMLFormElement>(null);
  const handle = useRef<StepHandle>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // Set by any input event inside the form; "Finish later" saves only a step that was touched.
  const touched = useRef(false);
  const [busy, setBusy] = useState<null | 'next' | 'later'>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const n = step;
  const key = WIZARD_STEPS[n - 1];
  const Step = STEP_COMPONENTS[n - 1];

  // Announce the new step: move focus to its heading (the page h1 has focus on first load).
  useEffect(() => {
    setFormError(null);
    touched.current = false;
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [n]);

  async function save(): Promise<ProfileDto | null> {
    setSaveState('saving');
    const saved = await handle.current?.save();
    setSaveState(saved ? 'saved' : 'idle');
    if (!saved) focusFirstInvalid(form.current);
    return saved ?? null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy('next');
    setFormError(null);
    try {
      const saved = await save();
      if (!saved) return;
      if (editing) {
        toast(t('sectionSaved'));
        router.push(PROFILE_PATH);
      } else if (n < 6) {
        router.push(stepHref(n + 1));
      } else {
        await api<ProfileDto>('/me/profile/complete', { method: 'POST' });
        onProfile(await api<ProfileDto>('/me/profile'));
        toast(t('doneToast'));
        router.push(PROFILE_PATH);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PROFILE_INCOMPLETE') {
        const missing = ((err.details as { missing?: string[] })?.missing ?? []) as string[];
        const names = missing.map((m) => t(`steps.${m}`)).join(locale === 'ar' ? '، ' : ', ');
        setFormError(`${errs.message(err)} ${names}`.trim());
      } else {
        setFormError(errs.message(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function later() {
    if (busy) return;
    setBusy('later');
    try {
      // An untouched step leaves as it is; an edited one is saved first (and must be valid).
      const saved = touched.current && n < 6 ? await save() : true;
      if (saved) {
        toast(t('laterToast'));
        router.push('/seeker');
      }
    } finally {
      setBusy(null);
    }
  }

  const stepName = t(`steps.${key}`);
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <h2 ref={heading} tabIndex={-1} className="m-0 text-base font-bold outline-none">
          {t('stepOf', { n })}: {stepName}
        </h2>
        <p role="status" className="m-0 inline-flex min-h-5 items-center gap-1.5 text-[13px] text-match">
          {saveState === 'saving' && (
            <>
              <Spinner className="h-4 w-4" />
              <span className="text-text-muted">{t('saving')}</span>
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Icon name="check" className="h-4 w-4" />
              <span>{t('saved')}</span>
            </>
          )}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={t('stepOf', { n })}
        aria-valuemin={1}
        aria-valuemax={6}
        aria-valuenow={n}
        className="mb-4 h-1.5 overflow-hidden rounded-pill bg-surface-2"
      >
        <span className="block h-full rounded-pill bg-primary" style={{ width: `${(n / 6) * 100}%` }} />
      </div>
      <ol className="m-0 mb-5 hidden list-none gap-1.5 p-0 md:flex">
        {WIZARD_STEPS.map((k, i) => {
          const done = profile.steps[k];
          const current = i + 1 === n;
          return (
            <li
              key={k}
              aria-current={current ? 'step' : undefined}
              className={`flex flex-1 items-center gap-1.5 border-t-[3px] pt-2 text-[13px] ${
                current
                  ? 'border-primary font-semibold text-primary'
                  : done
                    ? 'border-primary text-text'
                    : 'border-border text-text-muted'
              }`}
            >
              {done && !current && <Icon name="check" className="h-4 w-4" />}
              {t(`steps.${k}`)}
            </li>
          );
        })}
      </ol>
      <form
        ref={form}
        noValidate
        onSubmit={onSubmit}
        onChange={() => {
          touched.current = true;
        }}
        className="max-w-[720px]"
      >
        <Alert>{formError}</Alert>
        <Step key={n} ref={handle} profile={profile} lists={lists} onProfile={onProfile} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          {editing ? (
            <ButtonLink href={PROFILE_PATH} variant="secondary">
              <Icon name="chev" className="h-4 w-4 rotate-180 rtl:rotate-0" />
              {t('backToProfile')}
            </ButtonLink>
          ) : (
            <div className="flex flex-wrap gap-2">
              {n > 1 && (
                <ButtonLink href={stepHref(n - 1)} variant="secondary">
                  <Icon name="chev" className="h-4 w-4 rotate-180 rtl:rotate-0" />
                  {t('back')}
                </ButtonLink>
              )}
              <Button variant="ghost" onClick={later} loading={busy === 'later'} disabled={!!busy}>
                {t('later')}
              </Button>
            </div>
          )}
          {!(editing && n === 6) && (
            <Button type="submit" loading={busy === 'next'} disabled={!!busy}>
              {editing ? t('saveSection') : n < 6 ? t('next') : t('finish')}
              {!editing && <Icon name="chev" className="h-4 w-4" flipInRtl />}
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
