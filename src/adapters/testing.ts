import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `lib/…/x.test.js` → repository root. */
export function fixture(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..', '..');
  return readFileSync(path.join(root, 'fixtures', name), 'utf8');
}

/** The date window the saved fixtures were captured in. */
export const FIXTURE_DAYS = [
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
];

/** The Roda fixtures were captured later, so they need their own window. */
export const RODA_FIXTURE_DAYS = [
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
];

export function assertValidShowtimes(
  showtimes: { date: string; time: string; bookingUrl: string }[],
  days: string[] = FIXTURE_DAYS,
): void {
  const allowed = new Set(days);
  for (const showtime of showtimes) {
    assert.ok(allowed.has(showtime.date), `date out of window: ${showtime.date}`);
    assert.match(showtime.time, /^\d{2}:\d{2}$/, `bad time: ${showtime.time}`);
    assert.match(showtime.bookingUrl, /^https?:\/\//, `bad url: ${showtime.bookingUrl}`);
  }
}
