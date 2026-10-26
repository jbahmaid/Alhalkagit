/**
 * S-22 reports (FR-2.5.1 to FR-2.5.3). Aggregates only: no row ever names or identifies a
 * person. A count below the minimum group size is sent as `null` ("hidden, fewer than 5"),
 * decided on the server; the client never sees the real value.
 */

/** Default minimum group size; the `reports.minGroupSize` setting may raise it, never lower it. */
export const REPORT_MIN_GROUP = 5;

/** A count, or null when it is hidden (fewer than the minimum group size). */
export type ReportCount = number | null;

/**
 * One bar. `key` is a fixed code (age band, gender, experience, job status) or a lookup id
 * (sector, education level, country) with its names in both languages.
 */
export interface ReportRow {
  key: string;
  nameAr?: string;
  nameEn?: string;
  count: ReportCount;
}

export const AGE_BANDS = ['UNDER_18', '18_24', '25_34', '35_44', '45_54', '55_PLUS'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Experience rows: YES / NO, and UNSPECIFIED for profiles that have not reached that step. */
export const EXPERIENCE_KEYS = ['YES', 'NO', 'UNSPECIFIED'] as const;

/** Job status rows: open, hired via the platform, closed without hiring. */
export const JOB_STATUS_KEYS = ['OPEN', 'HIRED_VIA_PLATFORM', 'CLOSED_WITHOUT_HIRING'] as const;

export interface SeekerReportDto {
  total: ReportCount;
  withExperience: ReportCount;
  withoutExperience: ReportCount;
  byAge: ReportRow[];
  byGender: ReportRow[];
  byEducation: ReportRow[];
  byExperience: ReportRow[];
  /** Sectors of the seekers' experience positions; a seeker can count in more than one. */
  bySector: ReportRow[];
  byNationality: ReportRow[];
}

export interface JobReportDto {
  total: ReportCount;
  open: ReportCount;
  unavailable: ReportCount;
  hiredViaPlatform: ReportCount;
  closedWithoutHiring: ReportCount;
  interestRequests: ReportCount;
  bySector: ReportRow[];
  byStatus: ReportRow[];
}

/** An employer's own jobs: their own data, so nothing is hidden, and no person is named. */
export interface OwnJobsReportDto {
  total: number;
  open: number;
  unavailable: number;
  hiredViaPlatform: number;
  closedWithoutHiring: number;
  interestRequests: number;
  jobs: {
    id: string;
    title: string;
    status: 'OPEN' | 'UNAVAILABLE';
    closedOutcome: 'HIRED_VIA_PLATFORM' | 'CLOSED_WITHOUT_HIRING' | null;
    interestRequests: number;
  }[];
}

/** Admin filters (S-22). Dates are YYYY-MM-DD, inclusive. */
export interface ReportFilters {
  from?: string;
  to?: string;
  sectorId?: string;
  countryId?: string;
}

export interface ReportsDto {
  /** `all` for admins (filters apply), `general` for employers (no filters). */
  scope: 'all' | 'general';
  minGroupSize: number;
  filters: ReportFilters;
  seekers: SeekerReportDto;
  jobs: JobReportDto;
  /** Employers only. */
  own: OwnJobsReportDto | null;
  generatedAt: string;
}
