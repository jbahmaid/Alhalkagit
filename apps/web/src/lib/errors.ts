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
};

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
        const rule = f.errors.find((e) => RULE_KEYS[e]);
        out[f.field] = t(`validation.${rule ? RULE_KEYS[rule] : 'required'}`);
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
