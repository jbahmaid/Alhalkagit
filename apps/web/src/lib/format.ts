/** Latin digits in both languages (design decision 4.3). */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Gregorian calendar with Latin digits in both languages. */
const intlLocale = (locale: string) => (locale === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en-GB');

/** "2024-03" or "2024-03-01" -> "Mar 2024" / "مارس 2024". */
export function formatMonth(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const [y, m] = value.split('-').map(Number);
  if (!y || !m) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** ISO date or timestamp -> "5 March 2024" / "5 مارس 2024". */
export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: value.length === 10 ? 'UTC' : undefined,
  }).format(d);
}

/** 1536000 -> "1.5 MB" (units stay Latin, like the prototype's "10MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Timestamp -> "5 March 2024, 14:05" / "5 مارس 2024، 14:05" (local time, Latin digits). */
export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}
