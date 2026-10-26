import { ProfileStep, WIZARD_STEPS, WizardStep } from '@sanad/shared';

/** What the completion calculation needs to know about a profile. */
export interface CompletionSnapshot {
  hasPerson: boolean;
  darId: string | null;
  fakhdhId: string | null;
  /** False when the admins have not created any active dar / fakhdh yet (step 2 then passes). */
  darRequired: boolean;
  fakhdhRequired: boolean;
  mobile: string | null;
  email: string | null;
  hasEducation: boolean;
  hasExperience: boolean | null;
  yearsOfExperience: number | null;
  positionCount: number;
  hasVerifier: boolean;
  hasCv: boolean;
  completedAt: Date | null;
}

/** The first five steps are required; the CV (step 6) is optional (matching works without it). */
export const REQUIRED_STEPS: WizardStep[] = ['personal', 'affiliation', 'contact', 'education', 'experience'];

const STEP_ENUM: Record<WizardStep, ProfileStep> = {
  personal: 'PERSONAL',
  affiliation: 'TRIBE',
  contact: 'CONTACT',
  education: 'EDUCATION',
  experience: 'EXPERIENCE',
  cv: 'CV',
};

export function stepsDone(s: CompletionSnapshot): Record<WizardStep, boolean> {
  const experience =
    s.hasExperience === false ||
    (s.hasExperience === true && s.yearsOfExperience !== null && s.positionCount > 0 && s.hasVerifier);
  return {
    personal: s.hasPerson,
    affiliation: s.hasPerson && (!s.darRequired || !!s.darId) && (!s.fakhdhRequired || !!s.fakhdhId),
    contact: s.hasPerson && !!s.mobile && !!s.email,
    education: s.hasEducation,
    experience,
    cv: s.hasCv,
  };
}

/**
 * completion_step: the first required step still missing; CV once the required steps are done;
 * COMPLETED once the seeker finished the wizard (completedAt) and everything required is there.
 */
export function completionOf(s: CompletionSnapshot): {
  steps: Record<WizardStep, boolean>;
  completionStep: ProfileStep;
  missing: WizardStep[];
  percent: number;
} {
  const steps = stepsDone(s);
  const missing = REQUIRED_STEPS.filter((k) => !steps[k]);
  let completionStep: ProfileStep;
  if (missing.length) completionStep = STEP_ENUM[missing[0]];
  else completionStep = s.completedAt ? 'COMPLETED' : 'CV';
  const done = WIZARD_STEPS.filter((k) => steps[k]).length;
  return { steps, completionStep, missing, percent: Math.round((done / WIZARD_STEPS.length) * 100) };
}
