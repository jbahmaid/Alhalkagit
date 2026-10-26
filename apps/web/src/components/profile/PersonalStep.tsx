'use client';

import {
  ageFrom,
  isNationalIdFormat,
  isPassportFormat,
  PROFILE_LIMITS,
  toLatinDigits,
  type IdType,
  type ProfileDto,
} from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { api } from '@/lib/api';
import { useLookupName } from '@/lib/lookups';
import { Alert, ChoiceGroup, SelectField, TextField } from '@/components/ui';
import {
  Grid2,
  Group,
  req,
  useStepForm,
  type FieldErrors,
  type StepHandle,
  type StepProps,
} from './step-kit';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
function yearsAgo(n: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return isoDate(d);
}
const normalizeId = (v: string) => toLatinDigits(v).replace(/[\s-]/g, '').toUpperCase();

/** Step 1: personal data (FR-2.1.2). */
export const PersonalStep = forwardRef<StepHandle, StepProps>(function PersonalStep(
  { profile, lists, onProfile },
  ref,
) {
  const t = useTranslations('profile');
  const tv = useTranslations('validation');
  const name = useLookupName();
  const p = profile.personal;
  const [firstName, setFirst] = useState(p?.firstName ?? '');
  const [fatherName, setFather] = useState(p?.fatherName ?? '');
  const [grandfatherName, setGrand] = useState(p?.grandfatherName ?? '');
  const [familyName, setFamily] = useState(p?.familyName ?? '');
  const [idType, setIdType] = useState<IdType>(p?.idType ?? 'NATIONAL_ID');
  const [idNumber, setIdNumber] = useState('');
  const [gender, setGender] = useState<string | null>(p?.gender ?? null);
  const [birthDate, setBirth] = useState(p?.birthDate ?? '');
  const [nationalityId, setNat] = useState(p?.nationalityId ?? '');
  const [needs, setNeeds] = useState<string | null>(p ? (p.hasSpecialNeeds ? 'yes' : 'no') : null);
  const { fieldErrors: fe, formError, submit } = useStepForm();
  const age = ageFrom(birthDate);
  const keepsId = !!p && !idNumber.trim() && idType === p.idType;

  function check(): FieldErrors {
    const e: FieldErrors = {};
    if (req(firstName)) e.firstName = tv('required');
    if (req(fatherName)) e.fatherName = tv('required');
    if (req(grandfatherName)) e.grandfatherName = tv('required');
    if (req(familyName)) e.familyName = tv('required');
    const id = normalizeId(idNumber);
    if (!id && !keepsId) e.idNumber = tv('required');
    else if (id && idType === 'NATIONAL_ID' && !isNationalIdFormat(id)) e.idNumber = tv('nationalId');
    else if (id && idType === 'PASSPORT' && !isPassportFormat(id)) e.idNumber = tv('passport');
    if (!gender) e.gender = tv('required');
    if (!birthDate) e.birthDate = tv('required');
    else if (age === null || age < PROFILE_LIMITS.minAge || age > PROFILE_LIMITS.maxAge)
      e.birthDate = tv('ageRange');
    if (!nationalityId) e.nationalityId = tv('required');
    if (!needs) e.hasSpecialNeeds = tv('required');
    return e;
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      const saved = await submit(check, () =>
        api<ProfileDto>('/me/profile/personal', {
          method: 'PATCH',
          body: {
            firstName,
            fatherName,
            grandfatherName,
            familyName,
            idType,
            ...(normalizeId(idNumber) ? { idNumber: normalizeId(idNumber) } : {}),
            gender,
            birthDate,
            nationalityId,
            hasSpecialNeeds: needs === 'yes',
          },
        }),
      );
      if (saved) {
        setIdNumber('');
        onProfile(saved);
      }
      return saved;
    },
  }));

  const countries = (lists.countries ?? []).map((c) => ({ value: c.id, label: name(c) }));

  return (
    <>
      <Alert>{formError}</Alert>
      <Group legend={t('fullName')}>
        <Grid2>
          <TextField
            id="w-first"
            label={t('first')}
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirst(e.target.value)}
            error={fe.firstName}
          />
          <TextField
            id="w-father"
            label={t('father')}
            value={fatherName}
            onChange={(e) => setFather(e.target.value)}
            error={fe.fatherName}
          />
          <TextField
            id="w-grand"
            label={t('grand')}
            value={grandfatherName}
            onChange={(e) => setGrand(e.target.value)}
            error={fe.grandfatherName}
          />
          <TextField
            id="w-family"
            label={t('family')}
            autoComplete="family-name"
            value={familyName}
            onChange={(e) => setFamily(e.target.value)}
            error={fe.familyName}
          />
        </Grid2>
      </Group>
      <ChoiceGroup
        legend={t('idType')}
        name="idType"
        value={idType}
        onChange={(v) => setIdType(v as IdType)}
        options={[
          { value: 'NATIONAL_ID', label: t('nationalId') },
          { value: 'PASSPORT', label: t('passport') },
        ]}
        error={fe.idType}
      />
      <TextField
        id="w-id"
        label={idType === 'PASSPORT' ? t('passNo') : t('idNo')}
        hint={
          <>
            {t('idHint')}
            {p && idType === p.idType && <> {t('idKeep', { masked: `\u2066${p.idNumberMasked}\u2069` })}</>}
          </>
        }
        ltr
        autoComplete="off"
        inputMode={idType === 'PASSPORT' ? 'text' : 'numeric'}
        maxLength={idType === 'PASSPORT' ? 20 : 10}
        optional={keepsId && !!p}
        value={idNumber}
        onChange={(e) => setIdNumber(e.target.value)}
        error={fe.idNumber}
      />
      <ChoiceGroup
        legend={t('gender')}
        name="gender"
        value={gender}
        onChange={setGender}
        options={[
          { value: 'MALE', label: t('male') },
          { value: 'FEMALE', label: t('female') },
        ]}
        error={fe.gender}
      />
      <Grid2>
        <TextField
          id="w-birth"
          type="date"
          label={t('birth')}
          ltr
          min={yearsAgo(PROFILE_LIMITS.maxAge + 1)}
          max={yearsAgo(PROFILE_LIMITS.minAge)}
          value={birthDate}
          onChange={(e) => setBirth(e.target.value)}
          error={fe.birthDate}
          hint={
            <span aria-live="polite" id="age-out">
              {t('age')}: <strong className="text-text">{age ?? '—'}</strong> {t('yearsUnit')} ·{' '}
              {t('ageAuto')}
            </span>
          }
        />
        <SelectField
          id="w-nat"
          label={t('nationality')}
          options={countries}
          value={nationalityId}
          onChange={(e) => setNat(e.target.value)}
          error={fe.nationalityId}
        />
      </Grid2>
      <ChoiceGroup
        legend={t('needs')}
        name="needs"
        value={needs}
        onChange={setNeeds}
        options={[
          { value: 'yes', label: t('yes') },
          { value: 'no', label: t('no') },
        ]}
        error={fe.hasSpecialNeeds}
      />
    </>
  );
});
