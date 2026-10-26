import {
  birthDateRules,
  experienceRules,
  graduationYearRules,
  idNumberRules,
  parseDateInput,
  positionDateRules,
} from './profile-rules';
import { completionOf, CompletionSnapshot } from './profile-completion';

const TODAY = new Date(Date.UTC(2026, 9, 26));
const rules = (errs: { errors: string[] }[]) => errs.flatMap((e) => e.errors);

describe('profile rules: dates', () => {
  it('parses full dates and months, rejects impossible dates', () => {
    expect(parseDateInput('2024-02-29')).toBe('2024-02-29');
    expect(parseDateInput('2023-02-29')).toBeNull();
    expect(parseDateInput('2022-05')).toBe('2022-05-01');
    expect(parseDateInput('2022-13')).toBeNull();
    expect(parseDateInput('22-05-01')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });

  it('accepts a plausible birth date and rejects ages outside 15..80 or future dates', () => {
    expect(birthDateRules('1995-05-20', TODAY)).toEqual([]);
    expect(rules(birthDateRules('2015-01-01', TODAY))).toEqual(['AGE_RANGE']);
    expect(rules(birthDateRules('1940-01-01', TODAY))).toEqual(['AGE_RANGE']);
    expect(rules(birthDateRules('2027-01-01', TODAY))).toEqual(['DATE_IN_FUTURE']);
    expect(rules(birthDateRules('1995-02-30', TODAY))).toEqual(['isDate']);
  });

  it('checks graduation year range against today and the birth year', () => {
    expect(graduationYearRules(2018, '1995-05-20', TODAY)).toEqual([]);
    expect(graduationYearRules(2032, null, TODAY)).toEqual([]);
    expect(rules(graduationYearRules(2033, null, TODAY))).toEqual(['GRADUATION_YEAR_RANGE']);
    expect(rules(graduationYearRules(1949, null, TODAY))).toEqual(['GRADUATION_YEAR_RANGE']);
    expect(rules(graduationYearRules(2000, '1995-05-20', TODAY))).toEqual(['GRADUATION_YEAR_RANGE']);
  });

  it('validates position dates: from <= to, not in the future, not before birth; to may be empty', () => {
    expect(positionDateRules({ startDate: '2022-05', endDate: null }, '1995-05-20', TODAY)).toEqual({
      errors: [],
      start: '2022-05-01',
      end: null,
    });
    const order = positionDateRules(
      { startDate: '2022-05', endDate: '2021-01' },
      null,
      TODAY,
      'positions.1.',
    );
    expect(order.errors).toEqual([{ field: 'positions.1.endDate', errors: ['DATE_ORDER'] }]);
    expect(rules(positionDateRules({ startDate: '2027-01' }, null, TODAY).errors)).toEqual([
      'DATE_IN_FUTURE',
    ]);
    expect(rules(positionDateRules({ startDate: '2026-11-01' }, null, TODAY).errors)).toEqual([
      'DATE_IN_FUTURE',
    ]);
    expect(rules(positionDateRules({ startDate: '1990-01' }, '1995-05-20', TODAY).errors)).toEqual([
      'DATE_BEFORE_BIRTH',
    ]);
    // the current month is allowed as "to"
    expect(positionDateRules({ startDate: '2020-01', endDate: '2026-10' }, null, TODAY).errors).toEqual([]);
  });

  it('requires years when there is experience and keeps them in range', () => {
    expect(experienceRules(false, null)).toEqual([]);
    expect(rules(experienceRules(true, null))).toEqual(['isNotEmpty']);
    expect(rules(experienceRules(true, 61))).toEqual(['YEARS_RANGE']);
    expect(experienceRules(true, 0)).toEqual([]);
  });
});

describe('profile rules: ID numbers', () => {
  it('national ID: 10 digits starting with 1 or 2, Arabic digits and spaces accepted', () => {
    expect(idNumberRules('NATIONAL_ID', '1012345678')).toEqual([]);
    expect(idNumberRules('NATIONAL_ID', '٢٠١٢ ٣٤٥ ٦٧٨')).toEqual([]);
    expect(rules(idNumberRules('NATIONAL_ID', '3012345678'))).toEqual(['NATIONAL_ID_FORMAT']);
    expect(rules(idNumberRules('NATIONAL_ID', '101234567'))).toEqual(['NATIONAL_ID_FORMAT']);
  });
  it('passport: 5..20 letters and digits', () => {
    expect(idNumberRules('PASSPORT', 'a1234567')).toEqual([]);
    expect(rules(idNumberRules('PASSPORT', 'A12'))).toEqual(['PASSPORT_FORMAT']);
    expect(rules(idNumberRules('PASSPORT', 'A12#4567'))).toEqual(['PASSPORT_FORMAT']);
  });
});

describe('profile completion', () => {
  const base: CompletionSnapshot = {
    hasPerson: true,
    darId: 'd',
    fakhdhId: 'f',
    darRequired: true,
    fakhdhRequired: true,
    mobile: '+966512345678',
    email: 'a@b.co',
    hasEducation: true,
    hasExperience: true,
    yearsOfExperience: 3,
    positionCount: 1,
    hasVerifier: true,
    hasCv: false,
    completedAt: null,
  };

  it('points at the first missing step, in wizard order', () => {
    expect(completionOf({ ...base, hasPerson: false }).completionStep).toBe('PERSONAL');
    expect(completionOf({ ...base, fakhdhId: null }).completionStep).toBe('TRIBE');
    expect(completionOf({ ...base, mobile: null }).completionStep).toBe('CONTACT');
    expect(completionOf({ ...base, hasEducation: false }).completionStep).toBe('EDUCATION');
    expect(completionOf({ ...base, positionCount: 0 }).completionStep).toBe('EXPERIENCE');
    expect(completionOf({ ...base, hasVerifier: false }).completionStep).toBe('EXPERIENCE');
    expect(completionOf({ ...base, hasExperience: null }).completionStep).toBe('EXPERIENCE');
  });

  it('treats "no experience" as complete and empty tribe lists as not required', () => {
    const s = completionOf({ ...base, hasExperience: false, positionCount: 0, hasVerifier: false });
    expect(s.steps.experience).toBe(true);
    const t = completionOf({
      ...base,
      darId: null,
      fakhdhId: null,
      darRequired: false,
      fakhdhRequired: false,
    });
    expect(t.steps.affiliation).toBe(true);
  });

  it('is CV after the required steps and COMPLETED once finished; CV counts in the percentage', () => {
    expect(completionOf(base)).toMatchObject({ completionStep: 'CV', missing: [], percent: 83 });
    expect(completionOf({ ...base, completedAt: new Date(), hasCv: true })).toMatchObject({
      completionStep: 'COMPLETED',
      percent: 100,
    });
  });
});
