import { DEFAULT_LANG } from './i18n.js';
import type { Lang } from './i18n.js';

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

const WEEKDAYS: Record<Lang, string[]> = {
  sr: ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

/**
 * Serbian month names, lower-case nominative, index 0 = January.
 *
 * Also the Tuck adapter's parsing table, not only a display list — it reads
 * month names straight off the scraped page — so this array must stay Serbian
 * whatever language the page is rendered in.
 */
export const MONTHS = [
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

const DISPLAY_MONTHS: Record<Lang, string[]> = {
  sr: MONTHS,
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

const RELATIVE_DAYS: Record<Lang, { today: string; tomorrow: string }> = {
  sr: { today: 'danas', tomorrow: 'sutra' },
  en: { today: 'today', tomorrow: 'tomorrow' },
};

function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** "petak, 21. avgust" / "Friday, 21 August" — or "danas"/"sutra" when close. */
export function formatDayLabel(
  date: string,
  today: string = localDate(),
  lang: Lang = DEFAULT_LANG,
): string {
  const delta = daysBetween(today, date);
  if (delta === 0) return RELATIVE_DAYS[lang].today;
  if (delta === 1) return RELATIVE_DAYS[lang].tomorrow;
  const [, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[lang][weekdayIndex(date)];
  const month = DISPLAY_MONTHS[lang][m! - 1];
  return lang === 'en' ? `${weekday}, ${d} ${month}` : `${weekday}, ${d}. ${month}`;
}

/** "pet 21.8." / "Fri 21/8" — compact form used in the day tabs. */
export function formatDayShort(
  date: string,
  today: string = localDate(),
  lang: Lang = DEFAULT_LANG,
): string {
  const delta = daysBetween(today, date);
  const [, m, d] = date.split('-').map(Number);
  const stamp = lang === 'en' ? `${d}/${m}` : `${d}.${m}.`;
  if (delta === 0) return `${RELATIVE_DAYS[lang].today} ${stamp}`;
  if (delta === 1) return `${RELATIVE_DAYS[lang].tomorrow} ${stamp}`;
  return `${WEEKDAYS[lang][weekdayIndex(date)]!.slice(0, 3)} ${stamp}`;
}

/** "21.08.2026. u 18:32" / "21/08/2026 at 18:32" — used for the build timestamp. */
export function formatTimestamp(iso: string, lang: Lang = DEFAULT_LANG): string {
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
  const time = `${get('hour')}:${get('minute')}`;
  return lang === 'en'
    ? `${get('day')}/${get('month')}/${get('year')} at ${time}`
    : `${get('day')}.${get('month')}.${get('year')}. u ${time}`;
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
