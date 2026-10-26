import {
  ageFrom,
  FieldErrorDetail,
  isNationalIdFormat,
  isPassportFormat,
  PROFILE_LIMITS,
  ProfileRule,
} from '@sanad/shared';
import { CryptoService } from '../crypto/crypto.service';

/**
 * Semantic checks that class-validator cannot express (plausible dates, date order, ID formats).
 * Pure functions: each returns field errors in the same shape as the validation pipe, so the
 * web app shows them next to the field. `today` is injectable for tests.
 */

type Errs = FieldErrorDetail[];
const err = (field: string, rule: ProfileRule | string): FieldErrorDetail => ({ field, errors: [rule] });

/** YYYY-MM-DD or YYYY-MM (-> first of month) to a real calendar date string, else null. */
export function parseDateInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3] ?? '1')];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export const todayIso = (today: Date): string => today.toISOString().slice(0, 10);

/** Normalised ID number format by type. */
export function idNumberRules(idType: 'NATIONAL_ID' | 'PASSPORT', raw: string, field = 'idNumber'): Errs {
  const n = CryptoService.normalizeIdNumber(raw);
  if (idType === 'NATIONAL_ID' && !isNationalIdFormat(n)) return [err(field, 'NATIONAL_ID_FORMAT')];
  if (idType === 'PASSPORT' && !isPassportFormat(n)) return [err(field, 'PASSPORT_FORMAT')];
  return [];
}

/** Birth date must be a real date giving an age within PROFILE_LIMITS (DB CHECK: >= 1900). */
export function birthDateRules(birthDate: string, today: Date): Errs {
  const iso = parseDateInput(birthDate);
  if (!iso || birthDate.length !== 10) return [err('birthDate', 'isDate')];
  if (iso > todayIso(today)) return [err('birthDate', 'DATE_IN_FUTURE')];
  const age = ageFrom(iso, today);
  if (age === null || age < PROFILE_LIMITS.minAge || age > PROFILE_LIMITS.maxAge) {
    return [err('birthDate', 'AGE_RANGE')];
  }
  return [];
}

export function graduationYearRules(year: number, birthDate: string | null, today: Date): Errs {
  const max = today.getUTCFullYear() + PROFILE_LIMITS.graduationYearsAhead;
  let min: number = PROFILE_LIMITS.minGraduationYear;
  if (birthDate) min = Math.max(min, Number(birthDate.slice(0, 4)) + 10);
  return year < min || year > max ? [err('graduationYear', 'GRADUATION_YEAR_RANGE')] : [];
}

export interface PositionDates {
  startDate: string;
  endDate?: string | null;
}

/**
 * start and end must be real dates (months accepted), not in the future, end >= start,
 * and not before the seeker was born. Returns normalised dates when valid.
 */
export function positionDateRules(
  p: PositionDates,
  birthDate: string | null,
  today: Date,
  prefix = '',
): { errors: Errs; start: string | null; end: string | null } {
  const errors: Errs = [];
  const start = parseDateInput(p.startDate);
  const end = p.endDate ? parseDateInput(p.endDate) : null;
  const now = todayIso(today);
  if (!start) errors.push(err(`${prefix}startDate`, 'isDate'));
  if (p.endDate && !end) errors.push(err(`${prefix}endDate`, 'isDate'));
  if (start && start > now) errors.push(err(`${prefix}startDate`, 'DATE_IN_FUTURE'));
  if (end && end > now) {
    // "To" entered as the current month resolves to its first day, which is never in the future.
    errors.push(err(`${prefix}endDate`, 'DATE_IN_FUTURE'));
  }
  if (start && end && end < start) errors.push(err(`${prefix}endDate`, 'DATE_ORDER'));
  if (start && birthDate && start < birthDate) errors.push(err(`${prefix}startDate`, 'DATE_BEFORE_BIRTH'));
  return { errors, start, end };
}

export function experienceRules(hasExperience: boolean, years: number | null | undefined): Errs {
  if (!hasExperience) return [];
  if (years === null || years === undefined) return [err('yearsOfExperience', 'isNotEmpty')];
  if (years < 0 || years > PROFILE_LIMITS.maxYearsOfExperience)
    return [err('yearsOfExperience', 'YEARS_RANGE')];
  return [];
}
