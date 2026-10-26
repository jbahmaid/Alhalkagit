/** BullMQ queue names. The API produces; the worker (src/worker.ts) consumes. */
export const QUEUES = {
  email: 'email',
  /** { analysisId } -> extract CV text, call the analyzer, store the result. */
  cvAnalysis: 'cv-analysis',
  /** { seekerId, reason } -> recompute the seeker's match scores (batch 3). */
  matching: 'matching',
} as const;

export interface CvAnalysisJob {
  analysisId: string;
}

export type ProfileChangeReason =
  | 'personal'
  | 'affiliation'
  | 'contact'
  | 'education'
  | 'experience'
  | 'positions'
  | 'verifier'
  | 'cv'
  | 'cv-analysis'
  | 'completed';

/** Job name on the matching queue for a changed seeker profile. */
export const PROFILE_UPDATED_JOB = 'profile.updated';

export interface ProfileUpdatedJob {
  seekerId: string;
  reason: ProfileChangeReason;
  at: string;
}
