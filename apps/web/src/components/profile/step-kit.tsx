'use client';

import type { ProfileDto } from '@sanad/shared';
import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Lookups } from '@/lib/lookups';
import { useApiErrors } from '@/lib/errors';
import { PROFILE_PATH } from '@/lib/use-profile';

/**
 * Where the profile screens read and write. The seeker uses /me/profile; an admin (S-20) edits a
 * seeker's profile through /admin/users/:id/profile with the same step components.
 */
export interface ProfileApi {
  base: string;
  /** Link that opens step n for editing, or null when the section cannot be edited here. */
  editHref: (n: number) => string | null;
}

export const ProfileApiContext = createContext<ProfileApi>({
  base: '/me/profile',
  editHref: (n) => `${PROFILE_PATH}?step=${n}`,
});

export const useProfileApi = () => useContext(ProfileApiContext);

/** What the wizard asks of each step: save it (null when it did not validate). */
export interface StepHandle {
  save(): Promise<ProfileDto | null>;
}

export interface StepProps {
  profile: ProfileDto;
  lists: Lookups;
  onProfile: (p: ProfileDto) => void;
}

export type FieldErrors = Record<string, string>;

/**
 * Field and form errors for one step, and `submit`, which runs client checks first and then the
 * API call, mapping server field errors (VALIDATION_FAILED details) back onto the inputs.
 */
export function useStepForm() {
  const t = useTranslations();
  const errs = useApiErrors();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = useCallback(
    async (check: () => FieldErrors, call: () => Promise<ProfileDto>): Promise<ProfileDto | null> => {
      const fe = check();
      setFieldErrors(fe);
      if (Object.keys(fe).length) {
        setFormError(t('validation.fixErrors'));
        return null;
      }
      setFormError(null);
      try {
        return await call();
      } catch (err) {
        const mapped = errs.fields(err);
        setFieldErrors(mapped);
        setFormError(Object.keys(mapped).length ? t('validation.fixErrors') : errs.message(err));
        return null;
      }
    },
    [errs, t],
  );

  return { fieldErrors, setFieldErrors, formError, setFormError, submit };
}

/** Two columns from 640px, one on phones (prototype .grid-2). */
export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-4 sm:grid-cols-2">{children}</div>;
}

/** Bordered fieldset with a legend (prototype fieldset.group). */
export function Group({ legend, children, id }: { legend: ReactNode; children: ReactNode; id?: string }) {
  return (
    <fieldset id={id} className="mb-4 min-w-0 rounded-lg border border-border bg-surface px-4 pb-1 pt-3">
      <legend className="px-1.5 text-[15px] font-semibold">{legend}</legend>
      {children}
    </fieldset>
  );
}

export const req = (v: string | null | undefined) => !v || !String(v).trim();
