import type { EmploymentType, InterestStatus, JobStatus, MatchDto, SeekerJobDto } from '@sanad/shared';

/**
 * PRIVACY (architecture section 4): what a seeker may know about a job. This is the ONLY
 * Prisma `select` used for seeker-facing job queries, so employer columns (employer_id and,
 * through it, name, organization, email, phone, business type) are never even read.
 */
export const SEEKER_JOB_SELECT = {
  id: true,
  title: true,
  description: true,
  sectorId: true,
  city: true,
  countryId: true,
  requiredEducationLevelId: true,
  minYearsExperience: true,
  employmentType: true,
  status: true,
  publishedAt: true,
} as const;

export type SeekerJobRow = {
  id: string;
  title: string;
  description: string;
  sectorId: string;
  city: string;
  countryId: string;
  requiredEducationLevelId: string | null;
  minYearsExperience: number;
  employmentType: EmploymentType;
  status: JobStatus;
  publishedAt: Date;
};

/** The exact keys a seeker receives for a job (checked by the privacy unit test). */
export const SEEKER_JOB_KEYS = [...Object.keys(SEEKER_JOB_SELECT), 'match', 'interest'].sort();

/**
 * Seeker-facing job, built field by field. Even if a caller passes a wider object (for example
 * a row that includes employer data), only the listed fields are copied.
 */
export class SeekerJobView implements SeekerJobDto {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly sectorId: string;
  readonly city: string;
  readonly countryId: string;
  readonly requiredEducationLevelId: string | null;
  readonly minYearsExperience: number;
  readonly employmentType: EmploymentType;
  readonly status: JobStatus;
  readonly publishedAt: string;
  readonly match: MatchDto;
  readonly interest: { status: InterestStatus; createdAt: string } | null;

  constructor(
    row: SeekerJobRow,
    match: MatchDto,
    interest: { status: InterestStatus; createdAt: Date } | null | undefined,
  ) {
    this.id = row.id;
    this.title = row.title;
    this.description = row.description;
    this.sectorId = row.sectorId;
    this.city = row.city;
    this.countryId = row.countryId;
    this.requiredEducationLevelId = row.requiredEducationLevelId;
    this.minYearsExperience = row.minYearsExperience;
    this.employmentType = row.employmentType;
    this.status = row.status;
    this.publishedAt = row.publishedAt.toISOString();
    this.match = {
      score: match.score,
      label: match.label,
      breakdown: {
        sector: match.breakdown.sector,
        education: match.breakdown.education,
        experience: match.breakdown.experience,
        keywords: match.breakdown.keywords,
        sectorMatch: match.breakdown.sectorMatch,
        educationMet: match.breakdown.educationMet,
        experienceMet: match.breakdown.experienceMet,
        keywordShare: match.breakdown.keywordShare,
      },
    };
    this.interest = interest
      ? { status: interest.status, createdAt: interest.createdAt.toISOString() }
      : null;
  }
}
