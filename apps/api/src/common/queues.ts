/** BullMQ queue names. The API produces; the worker (src/worker.ts) consumes. */
export const QUEUES = {
  email: 'email',
  /** { analysisId } -> extract CV text, call the analyzer, store the result. */
  cvAnalysis: 'cv-analysis',
  /** profile.updated { seekerId } / job.updated { jobId } -> recompute match_scores. */
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

/** Job name on the matching queue for a created or edited job. */
export const JOB_UPDATED_JOB = 'job.updated';

export interface JobUpdatedJob {
  jobId: string;
  at: string;
}

/** Wait before recomputing, so a burst of edits is computed once (same job id while waiting). */
export const MATCHING_DEBOUNCE_MS = 3000;
