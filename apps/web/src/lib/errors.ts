'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ApiError } from './api';

/** API validation rule names (class-validator) mapped to translation keys under `validation`. */
const RULE_KEYS: Record<string, string> = {
  isEmail: 'email',
  PASSWORD_POLICY: 'passwordPolicy',
  equals: 'consent',
  matches: 'code',
  isNotEmpty: 'required',
  minLength: 'required',
  isString: 'required',
  isUUID: 'required',
  isIn: 'required',
  isBoolean: 'required',
  isDate: 'date',
  isInt: 'number',
  min: 'number',
  max: 'number',
  maxLength: 'tooLong',
  SAUDI_MOBILE: 'saudiMobile',
  NATIONAL_ID_FORMAT: 'nationalId',
  PASSPORT_FORMAT: 'passport',
  AGE_RANGE: 'ageRange',
  DATE_IN_FUTURE: 'dateFuture',
  DATE_ORDER: 'dateOrder',
  DATE_BEFORE_BIRTH: 'dateBeforeBirth',
  GRADUATION_YEAR_RANGE: 'gradYear',
  YEARS_RANGE: 'yearsRange',
  LOOKUP_INVALID: 'lookup',
  FAKHDH_DAR_MISMATCH: 'fakhdhDar',
  PHONE_FORMAT: 'phone',
  CONTACT_REQUIRED: 'contactRequired',
};

/** `matches` means "6-digit code" on the code field and "wrong format" anywhere else. */
function ruleKey(field: string, rule: string): string {
  if (rule === 'matches') return field === 'code' ? 'code' : 'invalid';
  return RULE_KEYS[rule];
}

/** Turns any thrown error into a translated message; also maps field errors. */
export function useApiErrors() {
  const t = useTranslations();
  const message = useCallback(
    (err: unknown): string => {
      const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
      const key = `errors.${code}`;
      return t.has(key) ? t(key) : t('errors.INTERNAL_ERROR');
    },
    [t],
  );
  const fields = useCallback(
    (err: unknown): Record<string, string> => {
      if (!(err instanceof ApiError)) return {};
      const out: Record<string, string> = {};
      for (const f of err.fieldErrors) {
        // Profile rules are more specific than class-validator ones, so they win.
        const rule =
          f.errors.find((e) => /^[A-Z_]+$/.test(e) && RULE_KEYS[e]) ??
          f.errors.find((e) => ruleKey(f.field, e));
        if (!out[f.field]) out[f.field] = t(`validation.${rule ? ruleKey(f.field, rule) : 'invalid'}`);
      }
      return out;
    },
    [t],
  );
  return { message, fields };
}

export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Moves focus to the first invalid field after a failed submit. */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
