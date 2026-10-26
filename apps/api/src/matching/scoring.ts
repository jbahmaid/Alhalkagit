import {
  DEFAULT_MATCH_THRESHOLDS,
  DEFAULT_MATCH_WEIGHTS,
  MatchBreakdown,
  MatchLabel,
  matchLabel,
  toLatinDigits,
} from '@sanad/shared';

/**
 * Matching (architecture section 6). Pure functions only: no database, no clock, so they are
 * tested exhaustively and used the same way by the worker and the API.
 */

export interface MatchWeights {
  sector: number;
  education: number;
  experience: number;
  keywords: number;
}

export interface MatchThresholds {
  suitable: number;
  near: number;
}

export interface MatchSettings {
  weights: MatchWeights;
  thresholds: MatchThresholds;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  weights: { ...DEFAULT_MATCH_WEIGHTS },
  thresholds: { ...DEFAULT_MATCH_THRESHOLDS },
};

/** What scoring needs to know about a seeker. */
export interface SeekerFacts {
  /** CV-analysis sector (corrected, else suggested) plus the sectors of the experience positions. */
  sectorIds: string[];
  /** Rank of the seeker's education level (higher = more advanced), null if not entered. */
  educationRank: number | null;
  /** Declared years; falls back to the CV-inferred years; 0 when the seeker has no experience. */
  years: number;
  /** Position titles, field of study and CV skills. */
  keywordSources: string[];
}

/** What scoring needs to know about a job. */
export interface JobFacts {
  sectorId: string;
  /** null = no education requirement */
  requiredEducationRank: number | null;
  minYearsExperience: number;
  title: string;
}

export interface MatchResult {
  score: number;
  label: MatchLabel;
  breakdown: MatchBreakdown;
}

// ---------------------------------------------------------------------------
// Settings validation (values come from the settings table, edited by admins)
// ---------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Turns raw `matching.weights` / `matching.thresholds` values into usable settings. Anything
 * malformed falls back to the defaults, so a bad admin edit can never break matching.
 */
export function parseMatchSettings(weightsRaw: unknown, thresholdsRaw: unknown): MatchSettings {
  const d = DEFAULT_MATCH_SETTINGS;
  const w = (weightsRaw ?? {}) as Record<string, unknown>;
  const weights: MatchWeights =
    isNum(w.sector) && isNum(w.education) && isNum(w.experience) && isNum(w.keywords)
      ? { sector: w.sector, education: w.education, experience: w.experience, keywords: w.keywords }
      : { ...d.weights };
  const t = (thresholdsRaw ?? {}) as Record<string, unknown>;
  const thresholds: MatchThresholds =
    isNum(t.suitable) && isNum(t.near) && t.near <= t.suitable && t.suitable <= 100
      ? { suitable: t.suitable, near: t.near }
      : { ...d.thresholds };
  return { weights, thresholds };
}

// ---------------------------------------------------------------------------
// Keywords (Arabic and English)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  // Arabic (after normalisation)
  'في',
  'من',
  'علي',
  'الي',
  'عن',
  'مع',
  'او',
  'و',
  'ثم',
  'لدي',
  'بين',
  // English
  'and',
  'or',
  'of',
  'the',
  'in',
  'for',
  'with',
  'a',
  'an',
  'to',
  'at',
  'on',
  'by',
]);

/** Lower-case, Latin digits, no Arabic diacritics or tatweel, unified alef / ya / ta marbuta. */
export function normalizeText(s: string): string {
  return toLatinDigits(s)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** Distinct meaningful words. Drops the Arabic definite article on longer words ("المحاسب" -> "محاسب"). */
export function keywords(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeText(s).split(/[^\p{L}\p{N}+#]+/u)) {
    let w = raw;
    if (/^ال\p{L}{3,}$/u.test(w)) w = w.slice(2);
    if (!w || STOPWORDS.has(w)) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.add(w);
  }
  return out;
}

/** Share (0..1) of the job title's words found anywhere in the seeker's sources. */
export function keywordShare(jobTitle: string, seekerSources: string[]): number {
  const wanted = keywords(jobTitle);
  if (!wanted.size) return 0;
  const have = new Set<string>();
  for (const s of seekerSources) for (const w of keywords(s)) have.add(w);
  let hit = 0;
  for (const w of wanted) if (have.has(w)) hit += 1;
  return hit / wanted.size;
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** Score 0..100 with its breakdown and label. */
export function scoreMatch(
  seeker: SeekerFacts,
  job: JobFacts,
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
): MatchResult {
  const { weights, thresholds } = settings;
  const sectorMatch = seeker.sectorIds.includes(job.sectorId);
  const educationMet =
    job.requiredEducationRank === null ||
    (seeker.educationRank !== null && seeker.educationRank >= job.requiredEducationRank);
  const experienceMet = Math.max(0, seeker.years) >= Math.max(0, job.minYearsExperience);
  const share = keywordShare(job.title, seeker.keywordSources);

  const breakdown: MatchBreakdown = {
    sector: sectorMatch ? weights.sector : 0,
    education: educationMet ? weights.education : 0,
    experience: experienceMet ? weights.experience : 0,
    keywords: Math.round(weights.keywords * share),
    sectorMatch,
    educationMet,
    experienceMet,
    keywordShare: Math.round(share * 100) / 100,
  };
  const total = breakdown.sector + breakdown.education + breakdown.experience + breakdown.keywords;
  const max = weights.sector + weights.education + weights.experience + weights.keywords;
  // Weights are meant to sum to 100; if an admin enters another total, scale to 0..100.
  const score = Math.max(0, Math.min(100, Math.round(max > 0 ? (total * 100) / max : 0)));
  return { score, label: matchLabel(score, thresholds), breakdown };
}

/** Seeker facts from loaded rows (kept here so the rule is unit-tested, not buried in a query). */
export function seekerFacts(input: {
  analysisSectorId: string | null;
  positionSectorIds: (string | null)[];
  educationRank: number | null;
  hasExperience: boolean | null;
  yearsOfExperience: number | null;
  inferredYears: number | null;
  positionTitles: string[];
  fieldOfStudy: string | null;
  skills: string[];
}): SeekerFacts {
  const sectors = new Set<string>();
  if (input.analysisSectorId) sectors.add(input.analysisSectorId);
  for (const s of input.positionSectorIds) if (s) sectors.add(s);
  const years = input.hasExperience === false ? 0 : (input.yearsOfExperience ?? input.inferredYears ?? 0);
  return {
    sectorIds: [...sectors],
    educationRank: input.educationRank,
    years,
    keywordSources: [
      ...input.positionTitles,
      ...(input.fieldOfStudy ? [input.fieldOfStudy] : []),
      ...input.skills,
    ],
  };
}
