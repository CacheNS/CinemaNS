import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseArenaListings,
  parseArenaOriginalTitle,
  parseArenaRuntime,
  parseArenaShowtimes,
  parseArenaTitle,
} from './arena.js';
import { FIXTURE_DAYS, assertValidShowtimes, fixture } from './testing.js';

const home = fixture('arena-home.html');
const film = fixture('arena-film.html');

test('collects every film linked from the Arena home page', () => {
  const listings = parseArenaListings(home);

  // Five films are linked twice (absolute and relative), so the unique count
  // is slightly below the raw link count.
  assert.ok(listings.length >= 18, `expected the full programme, got ${listings.length}`);
  for (const listing of listings) {
    assert.match(listing.url, /^http:\/\/www\.arenacineplex\.com\/film\/\d+/);
  }
  assert.equal(new Set(listings.map((listing) => listing.url)).size, listings.length);
  assert.ok(listings.some((listing) => listing.title));
  assert.ok(listings.some((listing) => listing.posterUrl));
});

test('reads the title from a film page when the home page had none', () => {
  const title = parseArenaTitle(film);
  assert.ok(title && title.length > 0);
  assert.ok(!/\|/.test(title), 'must not include the site name');
});

test('pairs Arena date tabs with their panes', () => {
  const showtimes = parseArenaShowtimes(film, { url: 'http://www.arenacineplex.com/film/1/X' }, FIXTURE_DAYS);

  assert.ok(showtimes.length >= 20, `expected a full week, got ${showtimes.length}`);
  assertValidShowtimes(showtimes);

  // Each tab is a distinct day, so showtimes must spread across several dates.
  assert.ok(new Set(showtimes.map((showtime) => showtime.date)).size >= 5);
  assert.ok(showtimes.every((showtime) => showtime.cinemaId === 'arena'));
});

test('reads dubbing from the Arena title', () => {
  const dubbed = parseArenaShowtimes(
    film,
    { url: 'http://x/film/1/Y', title: 'ZOOTROPOLIS 2 (sinhronizovano) DS' },
    FIXTURE_DAYS,
  );
  assert.ok(dubbed.every((showtime) => showtime.audio === 'dubbed'));

  const plain = parseArenaShowtimes(
    film,
    { url: 'http://x/film/1/Y', title: 'IZLAZ IZ IGRE' },
    FIXTURE_DAYS,
  );
  assert.ok(plain.every((showtime) => showtime.audio === 'subtitled'));
});

test('drops dates outside the requested window', () => {
  const showtimes = parseArenaShowtimes(film, { url: 'http://x/film/1/Y' }, ['2026-08-19']);
  assert.ok(showtimes.length > 0);
  assert.ok(showtimes.every((showtime) => showtime.date === '2026-08-19'));
});

test('reads the original title printed next to the Serbian one', () => {
  assert.equal(parseArenaOriginalTitle(film), 'Spider-Man: Brand New Day');
  assert.equal(parseArenaOriginalTitle('<html><body><h1>X</h1></body></html>'), undefined);
});

test('reads the running time, tolerating the empty field Arena often leaves', () => {
  // This fixture is one of the films where Arena printed "Trajanje:  min".
  assert.equal(parseArenaRuntime(film), undefined);
  assert.equal(
    parseArenaRuntime('<html><body><div><strong>Trajanje:&nbsp; </strong> 128 min</div></body></html>'),
    128,
  );
  assert.equal(parseArenaRuntime('<html><body>Trajanje: 5 min</body></html>'), undefined);
});
