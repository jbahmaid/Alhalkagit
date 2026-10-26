'use client';

import { localSaudiMobile, normalizePhone, PROFILE_LIMITS, type ProfileDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { isEmail } from '@/lib/errors';
import { Alert, Button, Checkbox, ChoiceGroup, Icon, TextField } from '@/components/ui';
import {
  Grid2,
  Group,
  req,
  useStepForm,
  type FieldErrors,
  type StepHandle,
  type StepProps,
} from './step-kit';

interface PositionDraft {
  key: string;
  id?: string;
  title: string;
  organization: string;
  start: string; // YYYY-MM
  end: string; // YYYY-MM
  current: boolean;
}

let seq = 0;
const blank = (): PositionDraft => ({
  key: `new-${++seq}`,
  title: '',
  organization: '',
  start: '',
  end: '',
  current: false,
});
const thisMonth = () => new Date().toISOString().slice(0, 7);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Step 5: experience, unlimited positions and a verification contact (FR-2.1.7, FR-2.1.8). */
export const ExperienceStep = forwardRef<StepHandle, StepProps>(function ExperienceStep(
  { profile, onProfile },
  ref,
) {
  const t = useTranslations('profile');
  const tv = useTranslations('validation');
  const tc = useTranslations('common');
  const ex = profile.experience;
  const [has, setHas] = useState<string | null>(
    ex.hasExperience === null ? null : ex.hasExperience ? 'yes' : 'no',
  );
  const [years, setYears] = useState(ex.yearsOfExperience === null ? '' : String(ex.yearsOfExperience));
  const [positions, setPositions] = useState<PositionDraft[]>(() =>
    ex.positions.length
      ? ex.positions.map((p) => ({
          key: p.id,
          id: p.id,
          title: p.title,
          organization: p.organization ?? '',
          start: p.startDate.slice(0, 7),
          end: p.endDate ? p.endDate.slice(0, 7) : '',
          current: p.endDate === null,
        }))
      : [blank()],
  );
  const [verName, setVerName] = useState(ex.verifier?.name ?? '');
  const [verPhone, setVerPhone] = useState(localSaudiMobile(ex.verifier?.phone));
  const [verEmail, setVerEmail] = useState(ex.verifier?.email ?? '');
  const { fieldErrors: fe, formError, submit } = useStepForm();
  const addRef = useRef<HTMLButtonElement>(null);
  const birthMonth = profile.personal?.birthDate.slice(0, 7) ?? '';

  const patch = (i: number, change: Partial<PositionDraft>) =>
    setPositions((list) => list.map((p, j) => (j === i ? { ...p, ...change } : p)));

  function add() {
    const next = blank();
    setPositions((list) => [...list, next]);
    requestAnimationFrame(() => document.getElementById(`w-${next.key}-title`)?.focus());
  }
  function remove(i: number) {
    setPositions((list) => list.filter((_, j) => j !== i));
    requestAnimationFrame(() => addRef.current?.focus());
  }

  const verifierGiven = () => !req(verName) || !req(verPhone) || !req(verEmail);

  function check(): FieldErrors {
    const e: FieldErrors = {};
    if (!has) e.hasExperience = tv('required');
    if (has !== 'yes') return e;
    const y = Number(years);
    if (req(years)) e.yearsOfExperience = tv('required');
    else if (!Number.isInteger(y) || y < 0 || y > PROFILE_LIMITS.maxYearsOfExperience)
      e.yearsOfExperience = tv('yearsRange');
    const now = thisMonth();
    positions.forEach((p, i) => {
      const f = `positions.${i}.`;
      if (req(p.title)) e[`${f}title`] = tv('required');
      if (!p.start) e[`${f}startDate`] = tv('required');
      else if (!MONTH.test(p.start)) e[`${f}startDate`] = tv('date');
      else if (p.start > now) e[`${f}startDate`] = tv('dateFuture');
      else if (birthMonth && p.start < birthMonth) e[`${f}startDate`] = tv('dateBeforeBirth');
      if (!p.current) {
        if (!p.end) e[`${f}endDate`] = tv('required');
        else if (!MONTH.test(p.end)) e[`${f}endDate`] = tv('date');
        else if (p.end > now) e[`${f}endDate`] = tv('dateFuture');
        else if (p.start && p.end < p.start) e[`${f}endDate`] = tv('dateOrder');
      }
    });
    // The verification contact is optional; once any part is entered it must be complete.
    if (verifierGiven()) {
      if (req(verName)) e['verifier.name'] = tv('required');
      if (req(verPhone) && req(verEmail)) e['verifier.phone'] = tv('contactRequired');
      else if (!req(verPhone) && !normalizePhone(verPhone)) e['verifier.phone'] = tv('phone');
      if (!req(verEmail) && !isEmail(verEmail)) e['verifier.email'] = tv('email');
    }
    return e;
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      const body =
        has === 'yes'
          ? {
              hasExperience: true,
              yearsOfExperience: Number(years),
              positions: positions.map((p) => ({
                ...(p.id ? { id: p.id } : {}),
                title: p.title,
                organization: p.organization.trim() || null,
                startDate: p.start,
                endDate: p.current ? null : p.end,
              })),
              verifier: verifierGiven()
                ? { name: verName, phone: verPhone.trim() || null, email: verEmail.trim() || null }
                : null,
            }
          : { hasExperience: false };
      const saved = await submit(check, () =>
        api<ProfileDto>('/me/profile/experience', { method: 'PATCH', body }),
      );
      if (saved) {
        onProfile(saved);
        // New rows now have ids: keep them so the next save updates instead of re-creating.
        setPositions((list) =>
          list.map((p, i) => {
            const row = saved.experience.positions[i];
            return row ? { ...p, id: row.id } : p;
          }),
        );
      }
      return saved;
    },
  }));

  return (
    <>
      <Alert>{formError}</Alert>
      <ChoiceGroup
        legend={t('hasExp')}
        name="hasExp"
        value={has}
        onChange={setHas}
        options={[
          { value: 'yes', label: t('yes') },
          { value: 'no', label: t('no') },
        ]}
        error={fe.hasExperience}
      />
      {has === 'yes' && (
        <>
          <div className="max-w-[240px]">
            <TextField
              id="w-years"
              type="number"
              label={t('expYears')}
              ltr
              inputMode="numeric"
              min={0}
              max={PROFILE_LIMITS.maxYearsOfExperience}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              error={fe.yearsOfExperience}
            />
          </div>
          <p className="mb-3 mt-0 text-sm text-text-muted">{t('posHint')}</p>
          {positions.map((p, i) => {
            const f = `positions.${i}.`;
            return (
              <Group key={p.key} legend={t('pos', { n: i + 1 })}>
                <TextField
                  id={`w-${p.key}-title`}
                  label={t('posTitle')}
                  value={p.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                  error={fe[`${f}title`]}
                />
                <TextField
                  id={`w-${p.key}-org`}
                  label={t('posOrg')}
                  optional
                  value={p.organization}
                  onChange={(e) => patch(i, { organization: e.target.value })}
                  error={fe[`${f}organization`]}
                />
                <Grid2>
                  <TextField
                    id={`w-${p.key}-from`}
                    type="month"
                    label={t('from')}
                    hint={t('monthHint')}
                    placeholder="YYYY-MM"
                    ltr
                    max={thisMonth()}
                    value={p.start}
                    onChange={(e) => patch(i, { start: e.target.value })}
                    error={fe[`${f}startDate`]}
                  />
                  <TextField
                    id={`w-${p.key}-to`}
                    type="month"
                    label={t('to')}
                    hint={p.current ? t('present') : t('monthHint')}
                    placeholder="YYYY-MM"
                    ltr
                    optional={p.current}
                    disabled={p.current}
                    max={thisMonth()}
                    value={p.current ? '' : p.end}
                    onChange={(e) => patch(i, { end: e.target.value })}
                    error={p.current ? undefined : fe[`${f}endDate`]}
                  />
                </Grid2>
                <Checkbox
                  id={`w-${p.key}-cur`}
                  label={t('current')}
                  checked={p.current}
                  onChange={(e) => patch(i, { current: e.target.checked })}
                />
                {positions.length > 1 && (
                  <div className="mb-3">
                    <Button variant="ghost" size="sm" onClick={() => remove(i)}>
                      <Icon name="x" />
                      {t('removePos')}
                      <span className="sr-only"> {t('pos', { n: i + 1 })}</span>
                    </Button>
                  </div>
                )}
              </Group>
            );
          })}
          <div className="mb-4">
            <Button ref={addRef} variant="secondary" size="sm" onClick={add}>
              <Icon name="plus" />
              {t('addPos')}
            </Button>
          </div>
          <Group
            legend={
              <>
                {t('verifier')}
                <span className="ms-1 text-[13px] font-normal text-text-muted">({tc('optional')})</span>
              </>
            }
          >
            <p className="mb-3 mt-0 text-[13px] text-text-muted">
              {t('verifierHint')} {t('verifierOptional')}
            </p>
            <TextField
              id="w-ver-name"
              label={t('verName')}
              required={false}
              value={verName}
              onChange={(e) => setVerName(e.target.value)}
              error={fe['verifier.name']}
            />
            <Grid2>
              <TextField
                id="w-ver-phone"
                type="tel"
                label={t('verPhone')}
                ltr
                optional
                inputMode="tel"
                value={verPhone}
                onChange={(e) => setVerPhone(e.target.value)}
                error={fe['verifier.phone']}
              />
              <TextField
                id="w-ver-email"
                type="email"
                label={t('verEmail')}
                ltr
                optional
                value={verEmail}
                onChange={(e) => setVerEmail(e.target.value)}
                error={fe['verifier.email']}
              />
            </Grid2>
          </Group>
        </>
      )}
    </>
  );
});
