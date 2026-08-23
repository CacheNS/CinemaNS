import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTuck, parseTuckDate, parseTuckRuntime } from './tuck.js';
import { FIXTURE_DAYS, assertValidShowtimes, fixture } from './testing.js';

const html = fixture('tuck.html');

test('parses Tuck runtime out of its declined Serbian noun forms', () => {
  assert.equal(parseTuckRuntime('01 sata 28 minuta'), 88);
  assert.equal(parseTuckRuntime('02 sata 25 minuta'), 145);
  // A film under an hour, in case Tuck ever omits the "sata" clause entirely.
  assert.equal(parseTuckRuntime('45 minuta'), 45);
  assert.equal(parseTuckRuntime('nema podataka'), undefined);
});

test('parses Tuck day headers with a spelled-out Serbian month', () => {
  assert.equal(parseTuckDate('Ned 23. avgust 2026.'), '2026-08-23');
  assert.equal(parseTuckDate('Pon 24. avgust 2026.'), '2026-08-24');
  assert.equal(parseTuckDate('garbage'), null);
});

test('splits the local title from the original one on the slash', () => {
  const movies = parseTuck(html, FIXTURE_DAYS);
  const dubbed = movies.find((m) => m.rawTitle.startsWith('Patrolne'));
  assert.ok(dubbed);
  assert.equal(dubbed.rawTitle, 'Patrolne Šape: Dino Avantura (sinhro.)');
  assert.equal(dubbed.originalTitle, 'PAW Patrol: The Dino Movie');
});

test('a title marked "(sinhro.)" is dubbed; an unmarked one is subtitled', () => {
  const movies = parseTuck(html, FIXTURE_DAYS);
  const dubbed = movies.find((m) => m.rawTitle.startsWith('Patrolne'));
  const subtitled = movies.find((m) => m.rawTitle.startsWith('Ukus Straha'));
  assert.ok(dubbed?.showtimes.every((s) => s.audio === 'dubbed'));
  assert.ok(subtitled?.showtimes.every((s) => s.audio === 'subtitled'));
});

test('2D and 3D versions of the same film are kept as separate items with their own format', () => {
  const movies = parseTuck(html, FIXTURE_DAYS);
  const twoD = movies.find((m) => m.rawTitle.includes('2D'));
  const threeD = movies.find((m) => m.rawTitle.includes('3D'));
  assert.ok(twoD?.showtimes.every((s) => s.format === '2D'));
  assert.ok(threeD?.showtimes.every((s) => s.format === '3D'));
  assert.equal(twoD?.originalTitle, 'Spider-Man: Brand New Day');
  assert.equal(threeD?.originalTitle, 'Spider-Man: Brand New Day');
});

test('reads runtime, genres, poster and hall names off the listing', () => {
  const movies = parseTuck(html, FIXTURE_DAYS);
  const patrolne = movies.find((m) => m.rawTitle.startsWith('Patrolne'));
  assert.equal(patrolne?.runtimeMinutes, 88);
  assert.deepEqual(patrolne?.genres, ['Akcioni', 'Animirani', 'Porodični']);
  assert.match(patrolne?.posterUrl ?? '', /^https:\/\/www\.tuck\.rs\//);
  assert.ok(patrolne?.showtimes.some((s) => s.hall === 'Rita Hayworth'));
  assert.ok(patrolne?.showtimes.some((s) => s.hall === 'Lauren Bacall'));
});

test('every showtime lands in the requested window with a valid time and booking URL', () => {
  const movies = parseTuck(html, FIXTURE_DAYS);
  for (const movie of movies) assertValidShowtimes(movie.showtimes);
});

test('a showtime outside the requested window is dropped', () => {
  const movies = parseTuck(html, ['2099-01-01']);
  assert.equal(movies.length, 0);
});

test('an off-origin booking link is refused and the programme page is used instead', () => {
  const hostile = html.replace(
    /href="http:\/\/ulaznice\.tuck\.rs\/rs\/site\/repertoireDetail\/index\/2092"/g,
    'href="https://phishing.test/pay"',
  );
  const movies = parseTuck(hostile, FIXTURE_DAYS);
  const patrolne = movies.find((m) => m.rawTitle.startsWith('Patrolne'));
  for (const showtime of patrolne?.showtimes ?? []) {
    assert.ok(
      /^https:\/\/www\.tuck\.rs\//.test(showtime.bookingUrl),
      `off-origin booking URL survived: ${showtime.bookingUrl}`,
    );
  }
});

test('a javascript: booking link never reaches a showtime', () => {
  const hostile = html.replace(
    /href="http:\/\/ulaznice\.tuck\.rs\/rs\/site\/repertoireDetail\/index\/2092"/g,
    'href="javascript:alert(1)"',
  );
  const movies = parseTuck(hostile, FIXTURE_DAYS);
  const patrolne = movies.find((m) => m.rawTitle.startsWith('Patrolne'));
  for (const showtime of patrolne?.showtimes ?? []) {
    assert.ok(!showtime.bookingUrl.startsWith('javascript:'), showtime.bookingUrl);
  }
});
