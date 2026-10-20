/**
 * All instants are stored as UTC ISO-8601 strings. Local wall-clock times
 * (appointment times, dose times) are converted using the IANA zone the user
 * entered them in, so a schedule keeps meaning across DST and travel.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

const PARTS = {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
} as const;

/** Milliseconds to add to a UTC instant to get the same wall clock in `tz`. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, ...PARTS });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) if (part.type !== 'literal') p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return asUtc - instant.getTime();
}

/**
 * "2026-03-14" + "09:30" in Asia/Kolkata -> UTC instant.
 * Two passes converge on the correct offset even across a DST boundary.
 */
export function localToUtc(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0);
  let guess = naive - zoneOffsetMs(new Date(naive), tz);
  guess = naive - zoneOffsetMs(new Date(guess), tz);
  return new Date(guess).toISOString();
}

/** Wall-clock parts of a UTC instant in `tz`, as "YYYY-MM-DD" and "HH:MM". */
export function utcToLocalParts(iso: string, tz: string): { date: string; time: string } {
  const offset = zoneOffsetMs(new Date(iso), tz);
  const shifted = new Date(new Date(iso).getTime() + offset).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

const LOCALE_TAG = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN' } as const;
export type Locale = keyof typeof LOCALE_TAG;

/** India-friendly day-month-year with a 12-hour clock. */
export function formatDateTime(iso: string, tz: string, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: tz, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function formatDate(iso: string, tz: string, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: tz, day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
}

export function formatTime(iso: string, tz: string, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

/** "in 2 days" / "3 hours ago". Used for administrative context only. */
export function relative(iso: string, locale: Locale = 'en', from = Date.now()): string {
  const diff = new Date(iso).getTime() - from;
  const rtf = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' });
  const abs = Math.abs(diff);
  const min = 60_000, hr = 3_600_000, day = 86_400_000;
  if (abs < hr) return rtf.format(Math.round(diff / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hr), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day');
  return rtf.format(Math.round(diff / (30 * day)), 'month');
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function todayInZone(tz: string, at = new Date()): string {
  return utcToLocalParts(at.toISOString(), tz).date;
}

export const DEFAULT_TZ = 'Asia/Kolkata';
