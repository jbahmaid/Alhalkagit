import { z } from 'zod';

export const CV_ANALYZER = Symbol('CV_ANALYZER');

export interface SectorOption {
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface CvAnalyzerInput {
  /** The CV text only. Never the ID number, dar, fakhdh or any other profile field. */
  text: string;
  sectors: SectorOption[];
}

export interface CvAnalysisResult {
  sectorCode: string;
  skills: string[];
  inferredYears: number;
  tipsAr: string[];
  tipsEn: string[];
}

export interface CvAnalyzerOutput {
  result: CvAnalysisResult;
  /** Model that actually answered (may be a fallback model). */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** External service behind an interface; the worker never imports a vendor SDK directly. */
export interface CvAnalyzer {
  analyze(input: CvAnalyzerInput): Promise<CvAnalyzerOutput>;
}

/** Why an analysis failed. `retryable` decides whether the queue tries again. */
export class CvAnalysisError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
  }
}

const tip = z.string().trim().min(3).max(400);

/**
 * Final validation of what the model returned (also applied to the structured output).
 * Skills are de-duplicated and capped; tips must be 3 to 5 in each language.
 */
export function resultSchema(sectorCodes: string[]) {
  return z.object({
    sectorCode: z.string().refine((c) => sectorCodes.includes(c), 'unknown sector code'),
    skills: z
      .array(z.string().trim().min(1).max(80))
      .max(60)
      .transform((list) => {
        const seen = new Set<string>();
        return list.filter((s) => !seen.has(s.toLowerCase()) && !!seen.add(s.toLowerCase())).slice(0, 30);
      }),
    inferredYears: z.number().int().min(0).max(60),
    tipsAr: z.array(tip).min(3).max(5),
    tipsEn: z.array(tip).min(3).max(5),
  });
}

export function validateResult(raw: unknown, sectorCodes: string[]): CvAnalysisResult {
  const parsed = resultSchema(sectorCodes).safeParse(raw);
  if (!parsed.success) throw new CvAnalysisError('INVALID_OUTPUT', true);
  return parsed.data;
}
