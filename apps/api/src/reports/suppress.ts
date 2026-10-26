import type { ReportCount } from '@sanad/shared';

/**
 * Small-group suppression for S-22 (architecture §8: "no group under 5 is shown").
 *
 * 1. Primary: any count below `min` becomes null.
 * 2. Secondary: in a breakdown, if exactly one non-empty category is hidden, the smallest shown
 *    category is hidden too; otherwise the hidden one could be worked out from the total
 *    (for example 43 seekers, 40 men, so 3 women).
 *
 * Categories with a count of 0 never reach here (the queries only return groups that exist).
 */
export function hideSmall(count: number, min: number): ReportCount {
  return count < min ? null : count;
}

export function suppressBreakdown<T extends { count: number }>(
  rows: T[],
  min: number,
): (Omit<T, 'count'> & { count: ReportCount })[] {
  const hidden = new Set<number>();
  rows.forEach((r, i) => {
    if (r.count < min) hidden.add(i);
  });
  if (hidden.size === 1) {
    let smallest = -1;
    rows.forEach((r, i) => {
      if (!hidden.has(i) && (smallest < 0 || r.count < rows[smallest].count)) smallest = i;
    });
    if (smallest >= 0) hidden.add(smallest);
  }
  return rows.map((r, i) => ({ ...r, count: hidden.has(i) ? null : r.count }));
}

/**
 * A pair that adds up to a shown total (with / without experience; open / closed): hidden
 * together when either is small, for the same reason as the secondary rule above.
 */
export function suppressPair(a: number, b: number, min: number): [ReportCount, ReportCount] {
  // A zero member is not a group: only the other one is judged.
  if (a === 0) return [0, hideSmall(b, min)];
  if (b === 0) return [hideSmall(a, min), 0];
  const [x, y] = suppressBreakdown([{ count: a }, { count: b }], min);
  return [x.count, y.count];
}
