'use client';

import { localSaudiMobile, normalizeSaudiMobile, PROFILE_LIMITS, type ProfileDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { api } from '@/lib/api';
import { isEmail } from '@/lib/errors';
import { useLookupOptions } from '@/lib/lookups';
import { Alert, Card, Note, SelectField, TextField } from '@/components/ui';
import {
  Grid2,
  req,
  useProfileApi,
  useStepForm,
  type FieldErrors,
  type StepHandle,
  type StepProps,
} from './step-kit';

/** Step 2: dar and fakhdh (FR-2.1.3, FR-2.1.4). The fakhdh list follows the chosen dar. */
export const AffiliationStep = forwardRef<StepHandle, StepProps>(function AffiliationStep(
  { profile, lists, onProfile },
  ref,
) {
  const t = useTranslations('profile');
  const tv = useTranslations('validation');
  const options = useLookupOptions();
  const { base } = useProfileApi();
  const stored = profile.affiliation;
  const [darId, setDar] = useState(stored.darId ?? '');
  const [fakhdhId, setFakhdh] = useState(stored.fakhdhId ?? '');
  const { fieldErrors: fe, formError, submit } = useStepForm();
  // Only active items are required or offered; a value saved before it was deactivated stays.
  const dars = (lists.dars ?? []).filter((d) => d.isActive);
  // A fakhdh linked to a dar shows only under it; an unlinked one shows under every dar.
  const allFakhdhs = (lists.fakhdhs ?? []).filter((f) => !f.darId || f.darId === darId);
  const fakhdhs = allFakhdhs.filter((f) => f.isActive);

  function check(): FieldErrors {
    const e: FieldErrors = {};
    if (dars.length && !darId) e.darId = tv('required');
    if ((darId || !dars.length) && fakhdhs.length && !fakhdhId) e.fakhdhId = tv('required');
    return e;
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      const saved = await submit(check, () =>
        api<ProfileDto>(`${base}/affiliation`, {
          method: 'PATCH',
          body: { darId: darId || null, fakhdhId: fakhdhId || null },
        }),
      );
      if (saved) onProfile(saved);
      return saved;
    },
  }));

  return (
    <Card>
      <Alert>{formError}</Alert>
      {!dars.length && <Note kind="info">{t('affEmpty')}</Note>}
      <SelectField
        id="w-dar"
        label={t('dar')}
        hint={t('affHint')}
        options={options(lists.dars, stored.darId)}
        value={darId}
        optional={!dars.length}
        onChange={(e) => {
          setDar(e.target.value);
          setFakhdh('');
        }}
        error={fe.darId}
      />
      <SelectField
        id="w-fakhdh"
        label={t('fakhdh')}
        hint={darId || !dars.length ? undefined : t('fakhdhPickDar')}
        options={options(allFakhdhs, stored.fakhdhId)}
        value={fakhdhId}
        optional={!fakhdhs.length}
        disabled={!darId && dars.length > 0}
        onChange={(e) => setFakhdh(e.target.value)}
        error={fe.fakhdhId}
      />
    </Card>
  );
});

/** Step 3: mobile and email, both required (FR-2.1.5). */
export const ContactStep = forwardRef<StepHandle, StepProps>(function ContactStep(
  { profile, onProfile },
  ref,
) {
  const t = useTranslations('profile');
  const tv = useTranslations('validation');
  const [mobile, setMobile] = useState(localSaudiMobile(profile.contact.mobile));
  const [email, setEmail] = useState(profile.contact.email ?? profile.accountEmail ?? '');
  const { fieldErrors: fe, formError, submit } = useStepForm();
  const { base } = useProfileApi();

  function check(): FieldErrors {
    const e: FieldErrors = {};
    if (req(mobile)) e.mobile = tv('required');
    else if (!normalizeSaudiMobile(mobile)) e.mobile = tv('saudiMobile');
    if (req(email)) e.email = tv('required');
    else if (!isEmail(email)) e.email = tv('email');
    return e;
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      const saved = await submit(check, () =>
        api<ProfileDto>(`${base}/contact`, { method: 'PATCH', body: { mobile, email: email.trim() } }),
      );
      if (saved) {
        setMobile(localSaudiMobile(saved.contact.mobile));
        onProfile(saved);
      }
      return saved;
    },
  }));

  return (
    <Card>
      <Alert>{formError}</Alert>
      <Note kind="privacy" icon="lock">
        {t('contactHint')}
      </Note>
      <TextField
        id="w-phone"
        type="tel"
        label={t('mobile')}
        ltr
        inputMode="tel"
        autoComplete="tel"
        placeholder="05xxxxxxxx"
        value={mobile}
        onChange={(e) => setMobile(e.target.value)}
        error={fe.mobile}
      />
      <TextField
        id="w-email"
        type="email"
        label={t('email')}
        ltr
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fe.email}
      />
    </Card>
  );
});

/** Step 4: education (FR-2.1.6). */
export const EducationStep = forwardRef<StepHandle, StepProps>(function EducationStep(
  { profile, lists, onProfile },
  ref,
) {
  const t = useTranslations('profile');
  const tv = useTranslations('validation');
  const options = useLookupOptions();
  const { base } = useProfileApi();
  const ed = profile.education;
  const [educationLevelId, setLevel] = useState(ed?.educationLevelId ?? '');
  const [graduationYear, setYear] = useState(ed?.graduationYear ? String(ed.graduationYear) : '');
  const [countryId, setCountry] = useState(ed?.countryId ?? '');
  const [institution, setInst] = useState(ed?.institution ?? '');
  const [fieldOfStudy, setMajor] = useState(ed?.fieldOfStudy ?? '');
  const { fieldErrors: fe, formError, submit } = useStepForm();
  const thisYear = new Date().getUTCFullYear();
  const maxYear = thisYear + PROFILE_LIMITS.graduationYearsAhead;

  function check(): FieldErrors {
    const e: FieldErrors = {};
    if (!educationLevelId) e.educationLevelId = tv('required');
    const y = Number(graduationYear);
    if (req(graduationYear)) e.graduationYear = tv('required');
    else if (!Number.isInteger(y) || y < PROFILE_LIMITS.minGraduationYear || y > maxYear)
      e.graduationYear = tv('gradYear');
    if (!countryId) e.countryId = tv('required');
    if (req(institution)) e.institution = tv('required');
    return e;
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      const saved = await submit(check, () =>
        api<ProfileDto>(`${base}/education`, {
          method: 'PATCH',
          body: {
            educationLevelId,
            graduationYear: Number(graduationYear),
            countryId,
            institution,
            fieldOfStudy: fieldOfStudy.trim() || null,
          },
        }),
      );
      if (saved) onProfile(saved);
      return saved;
    },
  }));

  const countries = options(lists.countries, ed?.countryId);
  return (
    <Card>
      <Alert>{formError}</Alert>
      <SelectField
        id="w-edu"
        label={t('eduLevel')}
        options={options(lists['education-levels'], ed?.educationLevelId)}
        value={educationLevelId}
        onChange={(e) => setLevel(e.target.value)}
        error={fe.educationLevelId}
      />
      <Grid2>
        <TextField
          id="w-grad"
          type="number"
          label={t('gradYear')}
          ltr
          inputMode="numeric"
          min={PROFILE_LIMITS.minGraduationYear}
          max={maxYear}
          value={graduationYear}
          onChange={(e) => setYear(e.target.value)}
          error={fe.graduationYear}
        />
        <SelectField
          id="w-gradc"
          label={t('gradCountry')}
          options={countries}
          value={countryId}
          onChange={(e) => setCountry(e.target.value)}
          error={fe.countryId}
        />
      </Grid2>
      <TextField
        id="w-inst"
        label={t('inst')}
        value={institution}
        onChange={(e) => setInst(e.target.value)}
        error={fe.institution}
      />
      <TextField
        id="w-major"
        label={t('major')}
        optional
        value={fieldOfStudy}
        onChange={(e) => setMajor(e.target.value)}
        error={fe.fieldOfStudy}
      />
    </Card>
  );
});
