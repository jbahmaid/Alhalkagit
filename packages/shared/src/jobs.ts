import type { MatchLabel } from './matching';
import type { CvAnalysisStatus, Gender } from './profile';

// ---------------------------------------------------------------------------
// Enums (mirror apps/api/prisma/schema.prisma)
// ---------------------------------------------------------------------------

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'FREELANCE'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type JobStatus = 'OPEN' | 'UNAVAILABLE';
export type JobClosedOutcome = 'HIRED_VIA_PLATFORM' | 'CLOSED_WITHOUT_HIRING';
export type InterestStatus = 'SUBMITTED' | 'VIEWED' | 'CONTACTED' | 'HIRED' | 'NOT_SELECTED' | 'WITHDRAWN';
export type EmployerApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export const JOB_LIMITS = {
  titleMax: 200,
  descriptionMin: 20,
  descriptionMax: 5000,
  cityMax: 120,
  maxYears: 40,
  nameMax: 200,
  rejectionReasonMax: 500,
} as const;

// ---------------------------------------------------------------------------
// Matching result as shown to people
// ---------------------------------------------------------------------------

/** Points per factor plus whether each requirement is met (S-08 "why it fits"). */
export interface MatchBreakdown {
  sector: number;
  education: number;
  experience: number;
  keywords: number;
  sectorMatch: boolean;
  educationMet: boolean;
  experienceMet: boolean;
  /** 0..1 share of the job title words found in the seeker's titles, specialty and skills */
  keywordShare: number;
}

export interface MatchDto {
  score: number;
  label: MatchLabel;
  breakdown: MatchBreakdown;
}

// ---------------------------------------------------------------------------
// Seeker side (S-07, S-08, S-09). PRIVACY: these types never carry any employer field or id.
// ---------------------------------------------------------------------------

export interface SeekerJobDto {
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
  publishedAt: string;
  match: MatchDto;
  /** The seeker's own interest request on this job, if any. */
  interest: { status: InterestStatus; createdAt: string } | null;
}

export interface SeekerJobListDto {
  items: SeekerJobDto[];
  /** Distinct cities of open jobs, for the city filter. */
  cities: string[];
  /** Thresholds in force, for the legend. */
  thresholds: { suitable: number; near: number };
}

export interface MyInterestDto {
  id: string;
  status: InterestStatus;
  createdAt: string;
  /** false once the job is closed: "job no longer available" */
  jobAvailable: boolean;
  job: { id: string; title: string; sectorId: string; city: string };
}

// ---------------------------------------------------------------------------
// Employer side (S-10..S-16)
// ---------------------------------------------------------------------------

export interface EmployerAccountDto {
  contactName: string;
  organizationName: string;
  sectorId: string;
  businessTypeId: string;
  email: string;
  phone: string;
  approvalStatus: EmployerApprovalStatus;
  rejectionReason: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
  approvedAt: string | null;
}

export interface EmployerJobDto {
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
  closedOutcome: JobClosedOutcome | null;
  closedAt: string | null;
  publishedAt: string;
  applicantCount: number;
}

export interface EmployerDashboardDto {
  account: EmployerAccountDto;
  stats: { openJobs: number; interestRequests: number; hiredViaPlatform: number };
  jobs: EmployerJobDto[];
}

/** One row of S-14. Only people who expressed interest in this employer's job. */
export interface ApplicantSummaryDto {
  interestId: string;
  fullName: string;
  age: number | null;
  gender: Gender | null;
  educationLevelId: string | null;
  yearsOfExperience: number | null;
  match: { score: number; label: MatchLabel };
  status: InterestStatus;
  requestedAt: string;
}

export interface ApplicantsDto {
  job: EmployerJobDto;
  applicants: ApplicantSummaryDto[];
}

/** S-15. Never contains the ID number, dar or fakhdh. */
export interface ApplicantProfileDto {
  interestId: string;
  jobId: string;
  jobTitle: string;
  status: InterestStatus;
  requestedAt: string;
  match: { score: number; label: MatchLabel };
  fullName: string;
  age: number | null;
  gender: Gender | null;
  nationalityId: string | null;
  hasSpecialNeeds: boolean | null;
  mobile: string | null;
  email: string | null;
  education: {
    educationLevelId: string;
    graduationYear: number | null;
    institution: string;
    countryId: string;
    fieldOfStudy: string | null;
  } | null;
  hasExperience: boolean | null;
  yearsOfExperience: number | null;
  positions: { title: string; organization: string | null; startDate: string; endDate: string | null }[];
  verifier: { name: string; phone: string | null; email: string | null } | null;
  cv: { originalName: string; sizeBytes: number; uploadedAt: string } | null;
  cvAnalysisStatus: CvAnalysisStatus | null;
}

/** Admin list of employers waiting for a decision (the admin screen comes in batch 4). */
export interface AdminEmployerDto extends EmployerAccountDto {
  id: string;
}
