/** Public read-only lookup lists: GET /api/lookups/:type */
export const LOOKUP_TYPES = [
  'countries',
  'sectors',
  'education-levels',
  'dars',
  'fakhdhs',
  'business-types',
] as const;
export type LookupType = (typeof LOOKUP_TYPES)[number];

export interface LookupItemDto {
  id: string;
  /** `code` for every list except countries, where it is the ISO 3166-1 alpha-2 code. */
  code: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  /** education-levels only */
  rank?: number;
  /** fakhdhs only */
  darId?: string | null;
}
