export const TZ = 'Europe/Belgrade';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** YYYY-MM-DD for the given instant, in Europe/Belgrade. */
export function localDate(instant: Date = new Date()): string {
  return dateFormatter.format(instant);
}

/** HH:mm for the given instant, in Europe/Belgrade. */
export function localTime(instant: Date = new Date()): string {
  return timeFormatter.format(instant);
}

/** Adds whole days to a YYYY-MM-DD string without tripping over DST. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Today plus the next `count - 1` days, in Europe/Belgrade. */
export function windowDays(count = 8, from: string = localDate()): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

const WEEKDAYS = [
  'nedelja',
  'ponedeljak',
  'utorak',
  'sreda',
  'četvrtak',
  'petak',
  'subota',
];

const MONTHS = [
  'januar',
  'februar',
  'mart',
  'april',
  'maj',
  'jun',
  'jul',
  'avgust',
  'septembar',
  'oktobar',
  'novembar',
  'decembar',
];

function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** "petak, 21. avgust" — or "danas" / "sutra" when close. */
export function formatDayLabel(date: string, today: string = localDate()): string {
  const delta = daysBetween(today, date);
  if (delta === 0) return 'danas';
  if (delta === 1) return 'sutra';
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekdayIndex(date)]}, ${d}. ${MONTHS[m! - 1]}`;
}

/** "pet 21.8." — compact form used in the day tabs. */
export function formatDayShort(date: string, today: string = localDate()): string {
  const delta = daysBetween(today, date);
  const [, m, d] = date.split('-').map(Number);
  if (delta === 0) return `danas ${d}.${m}.`;
  if (delta === 1) return `sutra ${d}.${m}.`;
  return `${WEEKDAYS[weekdayIndex(date)]!.slice(0, 3)} ${d}.${m}.`;
}

/** "21.08.2026. u 18:32" — used for the build timestamp. */
export function formatTimestamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('sr-Latn-RS', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}. u ${get('hour')}:${get('minute')}`;
}

/** Normalizes "9:05", "09.05", "9h05" to "09:05". Returns null if unparseable. */
export function normalizeTime(raw: string): string | null {
  const match = raw.match(/(\d{1,2})\s*[:.hH]\s*(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
