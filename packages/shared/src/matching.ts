/** Defaults from architecture section 6; the live values are in settings (matching.*). */
export const DEFAULT_MATCH_WEIGHTS = { sector: 40, education: 25, experience: 25, keywords: 10 } as const;
export const DEFAULT_MATCH_THRESHOLDS = { suitable: 70, near: 45 } as const;
export type MatchLabel = 'SUITABLE' | 'NEAR' | 'NONE';

export function matchLabel(
  score: number,
  thresholds: { suitable: number; near: number } = DEFAULT_MATCH_THRESHOLDS,
): MatchLabel {
  if (score >= thresholds.suitable) return 'SUITABLE';
  if (score >= thresholds.near) return 'NEAR';
  return 'NONE';
}

/** Report groups smaller than this are hidden (architecture section 8). */
export const DEFAULT_REPORT_MIN_GROUP_SIZE = 5;
