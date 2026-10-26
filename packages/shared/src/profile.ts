/**
 * Seeker profile (S-05 wizard, S-06 CV): shared contract between the API and the web app.
 * FR-2.1.2 to FR-2.1.9.
 */

export const PROFILE_STEPS = [
  'PERSONAL',
  'TRIBE',
  'CONTACT',
  'EDUCATION',
  'EXPERIENCE',
  'CV',
  'COMPLETED',
] as const;
export type ProfileStep = (typeof PROFILE_STEPS)[number];

/** The six wizard steps, in order. Step n of 6 in the UI is WIZARD_STEPS[n - 1]. */
export const WIZARD_STEPS = ['personal', 'affiliation', 'contact', 'education', 'experience', 'cv'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** completion_step value that corresponds to each wizard step. */
export const WIZARD_STEP_TO_PROFILE_STEP: Record<WizardStep, ProfileStep> = {
  personal: 'PERSONAL',
  affiliation: 'TRIBE',
  contact: 'CONTACT',
  education: 'EDUCATION',
  experience: 'EXPERIENCE',
  cv: 'CV',
};

export type IdType = 'NATIONAL_ID' | 'PASSPORT';
export type Gender = 'MALE' | 'FEMALE';

// ---------------------------------------------------------------------------
// Limits and validation rules (checked again on the server)
// ---------------------------------------------------------------------------

export const PROFILE_LIMITS = {
  nameMax: 100,
  institutionMax: 200,
  titleMax: 200,
  notesMax: 500,
  minAge: 15,
  maxAge: 80,
  maxYearsOfExperience: 60,
  /** Earliest accepted graduation year (DB CHECK: 1950..2100). */
  minGraduationYear: 1950,
  /** Graduation year may be at most this many years in the future (students). */
  graduationYearsAhead: 6,
} as const;

export const CV_MAX_BYTES = 10 * 1024 * 1024;
/** Lifetime of a CV download link (architecture section 8). */
export const FILE_LINK_TTL_SECONDS = 300;
export const CV_EXTENSIONS = ['pdf', 'doc', 'docx'] as const;
export type CvExtension = (typeof CV_EXTENSIONS)[number];
export const CV_MIME_TYPES: Record<CvExtension, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
/** `accept` attribute for the file input. */
export const CV_ACCEPT = '.pdf,.doc,.docx,' + Object.values(CV_MIME_TYPES).join(',');

/**
 * Field-level rule names returned in VALIDATION_FAILED details (besides class-validator's own
 * names such as isNotEmpty). The web app translates them with validation.<rule>.
 */
export const PROFILE_RULES = [
  'SAUDI_MOBILE',
  'NATIONAL_ID_FORMAT',
  'PASSPORT_FORMAT',
  'AGE_RANGE',
  'DATE_IN_FUTURE',
  'DATE_ORDER',
  'DATE_BEFORE_BIRTH',
  'GRADUATION_YEAR_RANGE',
  'YEARS_RANGE',
  'LOOKUP_INVALID',
  'FAKHDH_DAR_MISMATCH',
  'PHONE_FORMAT',
  'CONTACT_REQUIRED',
] as const;
export type ProfileRule = (typeof PROFILE_RULES)[number];

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Arabic-Indic and Persian digits to Latin digits. */
export function toLatinDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

/**
 * Saudi mobile numbers in any common spelling (05xxxxxxxx, 5xxxxxxxx, +9665xxxxxxxx,
 * 009665xxxxxxxx, with spaces or dashes, Arabic digits) to E.164 (+9665xxxxxxxx). Null if invalid.
 */
export function normalizeSaudiMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = toLatinDigits(raw).replace(/[\s\-().]/g, '');
  const m = /^(?:\+966|00966|966|0)?(5\d{8})$/.exec(digits);
  return m ? `+966${m[1]}` : null;
}

/** +9665xxxxxxxx -> 05xxxxxxxx for display and editing. */
export function localSaudiMobile(e164: string | null | undefined): string {
  if (!e164) return '';
  return e164.startsWith('+966') ? `0${e164.slice(4)}` : e164;
}

/** Saudi national ID / iqama: 10 digits starting with 1 (citizen) or 2 (resident). */
export function isNationalIdFormat(normalized: string): boolean {
  return /^[12]\d{9}$/.test(normalized);
}

/** Passport numbers: 5 to 20 letters or digits. */
export function isPassportFormat(normalized: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(normalized);
}

/** Generic phone for the verification contact: optional +, 7 to 15 digits. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const saudi = normalizeSaudiMobile(raw);
  if (saudi) return saudi;
  const v = toLatinDigits(raw).replace(/[\s\-().]/g, '');
  return /^\+?\d{7,15}$/.test(v) ? v : null;
}

/** Whole years between a YYYY-MM-DD birth date and `today` (UTC dates). Null if not a date. */
export function ageFrom(birthDate: string | null | undefined, today: Date = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth() + 1;
  const td = today.getUTCDate();
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age >= 0 ? age : null;
}

// ---------------------------------------------------------------------------
// DTOs (GET /api/me/profile)
// ---------------------------------------------------------------------------

export interface PersonalDto {
  firstName: string;
  fatherName: string;
  grandfatherName: string;
  familyName: string;
  idType: IdType;
  /** Only the last 4 characters are ever sent back, e.g. "••••••1234". */
  idNumberMasked: string;
  gender: Gender;
  /** YYYY-MM-DD */
  birthDate: string;
  nationalityId: string;
  hasSpecialNeeds: boolean;
}

export interface AffiliationDto {
  darId: string | null;
  fakhdhId: string | null;
}

export interface ContactDto {
  /** E.164, e.g. +966512345678 */
  mobile: string | null;
  email: string | null;
}

export interface EducationDto {
  id: string;
  educationLevelId: string;
  graduationYear: number | null;
  institution: string;
  countryId: string;
  fieldOfStudy: string | null;
}

export interface PositionDto {
  id: string;
  title: string;
  organization: string | null;
  sectorId: string | null;
  /** YYYY-MM-DD (first day of the month when entered as a month) */
  startDate: string;
  /** null means "present" */
  endDate: string | null;
  sortOrder: number;
}

export interface VerifierDto {
  id: string;
  name: string;
  jobTitle: string | null;
  organization: string | null;
  phone: string | null;
  email: string | null;
}

export interface ExperienceDto {
  hasExperience: boolean | null;
  yearsOfExperience: number | null;
  positions: PositionDto[];
  verifier: VerifierDto | null;
}

export type CvAnalysisStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface CvFileDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface CvAnalysisDto {
  id: string;
  status: CvAnalysisStatus;
  suggestedSectorId: string | null;
  correctedSectorId: string | null;
  /** corrected ?? suggested */
  sectorId: string | null;
  skills: string[];
  inferredYears: number | null;
  tipsAr: string[];
  tipsEn: string[];
  completedAt: string | null;
}

export interface CvDto {
  file: CvFileDto | null;
  analysis: CvAnalysisDto | null;
  /** CV_ANALYSIS_ENABLED=true and an API key is configured. */
  analysisEnabled: boolean;
  /** Number of earlier CV files kept (FR-2.1.9). */
  previousVersions: number;
}

export interface ProfileDto {
  completionStep: ProfileStep;
  completedAt: string | null;
  /** Which wizard steps are complete. */
  steps: Record<WizardStep, boolean>;
  /** 0..100, the share of the six steps that are complete. */
  percent: number;
  /** Login email, suggested as the contact email. */
  accountEmail: string;
  personal: PersonalDto | null;
  affiliation: AffiliationDto;
  contact: ContactDto;
  education: EducationDto | null;
  experience: ExperienceDto;
  cv: CvDto;
}

export interface FileLinkDto {
  /** Same-origin path, e.g. /api/files/<token>. Valid for FILE_LINK_TTL_SECONDS. */
  url: string;
  expiresAt: string;
}
