import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, renderDayPage, renderPages, runtimeBucket } from './html.js';
import { CINEMA_IDS, CITIES, DEFAULT_CITY } from '../core/types.js';
import type { CinemaId, Snapshot, SourceStatus } from '../core/types.js';

// Every venue needs a status; the three the fixture cares about are overridden
// below, the rest just have to exist.
const ok3 = Object.fromEntries(
  CINEMA_IDS.map((id) => [
    id,
    { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 0, showtimeCount: 0, stale: false },
  ]),
) as Record<CinemaId, SourceStatus>;

const snapshot: Snapshot = {
  generatedAt: '2026-08-19T10:00:00.000Z',
  days: ['2026-08-19', '2026-08-20'],
  movies: [
    {
      key: 'tmdb:1',
      title: 'Vajana',
      originalTitle: 'Moana 2',
      runtimeMinutes: 100,
      score: { value: 7.25, votes: 1200, source: 'TMDb', url: 'https://example.test/tmdb/1' },
      genres: ['Animirani'],
      ageRating: { label: 'Bez ograničenja', minAge: 0, source: 'HR', confident: true },
      kidFriendly: true,
      hasDubbed: true,
      aliases: ['Vajana', 'VAJANA (sinhronizovano)'],
      showtimes: [
        {
          cinemaId: 'cinestar-novi-sad',
          date: '2026-08-19',
          time: '14:00',
          format: '2D',
          audio: 'dubbed',
          bookingUrl: 'https://example.test/a',
        },
        {
          cinemaId: 'arena-novi-sad',
          date: '2026-08-19',
          time: '20:00',
          format: '3D',
          audio: 'subtitled',
          bookingUrl: 'https://example.test/b',
        },
        {
          cinemaId: 'cineplexx-galerija',
          date: '2026-08-19',
          time: '18:00',
          format: '2D',
          audio: 'dubbed',
          bookingUrl: 'https://example.test/bg',
        },
      ],
    },
    {
      key: 'tmdb:3',
      title: 'Samo u Beogradu',
      genres: ['Drama'],
      kidFriendly: false,
      hasDubbed: false,
      aliases: [],
      showtimes: [
        {
          cinemaId: 'cinestar-beograd-ada',
          date: '2026-08-19',
          time: '21:00',
          format: '2D',
          audio: 'subtitled',
          bookingUrl: 'https://example.test/d',
        },
      ],
    },
    {
      key: 'tmdb:2',
      title: 'Zli mrtvi <script>',
      genres: ['Horor'],
      kidFriendly: false,
      hasDubbed: false,
      aliases: [],
      showtimes: [
        {
          cinemaId: 'cineplexx-novi-sad',
          date: '2026-08-20',
          time: '22:00',
          format: '2D',
          audio: 'subtitled',
          bookingUrl: 'https://example.test/c',
        },
      ],
    },
  ],
  sources: {
    ...ok3,
    'arena-novi-sad': { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 1, showtimeCount: 1, stale: false },
    'cineplexx-novi-sad': { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 1, showtimeCount: 1, stale: false },
    'cinestar-novi-sad': {
      ok: true,
      fetchedAt: '2026-08-19T08:00:00.000Z',
      movieCount: 1,
      showtimeCount: 1,
      stale: true,
      error: 'timeout',
    },
  },
  cities: CITIES,
  diagnostics: { tmdbResolved: 2, tmdbUnresolved: 0, unresolvedTitles: [], unknownAudioShowtimes: 0 },
};

test('escapes user-visible strings', () => {
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

test('offers every city, with the default one selected', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  for (const city of CITIES) {
    assert.ok(today.includes(`data-city="${city.id}"`), `missing ${city.id}`);
    assert.ok(today.includes(`?grad=${city.slug}`), `missing link for ${city.slug}`);
  }
  assert.ok(today.includes('citytab citytab--active'));
});

// Without JS the page must be a correct single-city page: a superset is fine
// for the dubbed filter but plainly wrong for city.
test('only the default city is visible before JS runs', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  const blocks = today.match(/<div class="cinema"[^>]*>/g) ?? [];
  assert.ok(blocks.length >= 4, `expected blocks from both cities, got ${blocks.length}`);

  for (const block of blocks) {
    const isDefault = block.includes(`data-city="${DEFAULT_CITY}"`);
    assert.equal(
      block.includes('hidden'),
      !isDefault,
      `wrong initial visibility: ${block}`,
    );
  }
});

test('a film playing only in another city starts hidden', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  const card = today.slice(0, today.indexOf('Samo u Beogradu'));
  const openTag = card.slice(card.lastIndexOf('<article'));
  assert.ok(openTag.includes('data-cities="beograd"'));
  assert.ok(openTag.includes('hidden'));
});

test('counts describe the visible city, not the whole payload', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  // Novi Sad has one film with two showtimes; Beograd's are excluded.
  assert.ok(today.includes('data-total-movies="1"'), today.match(/data-total-movies="\d+"/)?.[0]);
  assert.ok(today.includes('data-total-showtimes="2"'));
});

test('stale-source warnings are scoped to their city', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes(`<div class="notice notice--stale" data-city="${DEFAULT_CITY}">`));
});

test('renders one page per day, with today as index.html', () => {
  const pages = renderPages(snapshot);
  assert.deepEqual([...pages.keys()], ['index.html', '2026-08-20.html']);
});

test('shows only the films playing on that day', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('Vajana'));
  assert.ok(!today.includes('Zli mrtvi'));
});

test('cinema names carry their location', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('Arena Centar'));
  assert.ok(today.includes('CineStar BIG'));
  assert.ok(renderDayPage(snapshot, '2026-08-20').includes('Cineplexx Promenada'));
});

test('emits the attributes the filters rely on', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('data-kid-friendly="1"'));
  assert.ok(today.includes('data-min-age="0"'));
  assert.ok(today.includes('data-audio="dubbed"'));
  assert.ok(today.includes('data-audio="subtitled"'));
  assert.ok(today.includes('id="filter-dubbed"'));
  assert.ok(today.includes('id="filter-kids"'));
});

test('escapes titles coming from the cinemas', () => {
  const page = renderDayPage(snapshot, '2026-08-20');
  assert.ok(!page.includes('<script>'));
  assert.ok(page.includes('&lt;script&gt;'));
});

test('emits what the past-showtime filter needs to work', () => {
  const today = renderDayPage(snapshot, '2026-08-19');

  // The filter runs in the browser, so the page must state its own date and
  // each showtime's start time; without both it cannot tell "today" apart from
  // a day the reader is browsing ahead to.
  assert.ok(today.includes('data-date="2026-08-19"'));
  // Every chip must carry its start time; one without would silently survive
  // the cutoff.
  const chips = today.match(/class="showtime /g) ?? [];
  const times = today.match(/data-time="\d{2}:\d{2}"/g) ?? [];
  assert.ok(chips.length > 0);
  assert.equal(times.length, chips.length);

  // The end-of-day message ships hidden and is revealed only by the script.
  assert.match(today, /id="empty-past"[^>]*hidden/);
  assert.ok(today.includes('data-daylink'));
});

test('warns about stale sources', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('nisu ažurni'));
  assert.ok(today.includes('CineStar BIG'));
});

test('an unrated film is not marked kid friendly', () => {
  const page = renderDayPage(snapshot, '2026-08-20');
  assert.ok(page.includes('data-kid-friendly="0"'));
  assert.ok(page.includes('Uzrast nepoznat'));
});

test('shows the original title in brackets next to the local one', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('Vajana <span class="movie__original">(Moana 2)</span>'));
});

test('shows the audience score', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('★ 7,3'));
  assert.ok(today.includes('/10 TMDb'));
  assert.ok(today.includes('https://example.test/tmdb/1'));
});

test('pairs each format with its audio version', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('2D · sinhronizovano'));
  assert.ok(today.includes('3D · titlovano'));
  // Showtime chips use the short form so they stay narrow on phones.
  assert.ok(today.includes('2D · sinh.'));
  assert.ok(today.includes('3D · titl.'));
});

test('colour-codes the running time', () => {
  assert.equal(runtimeBucket(89), 'short');
  assert.equal(runtimeBucket(90), 'medium');
  assert.equal(runtimeBucket(119), 'medium');
  assert.equal(runtimeBucket(120), 'long');
  assert.equal(runtimeBucket(185), 'long');

  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('badge--runtime-medium'));
  assert.ok(today.includes('1 h 40 min'));
});

test('is installable as an app', () => {  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('rel="manifest" href="manifest.webmanifest"'));
  assert.ok(today.includes('id="install-button"'));
  assert.ok(today.includes('Dodaj na početni ekran'));
  assert.ok(today.includes('apple-touch-icon'));
});

test('no Cyrillic reaches the rendered page', () => {
  // The site is Latin-only. escapeHtml is the single choke point every string
  // passes through, so converting there makes this structural rather than a
  // rule each call site must remember.
  const cyrillic: Snapshot = {
    ...snapshot,
    movies: [
      {
        ...snapshot.movies[0]!,
        title: 'Спајдермен: Нови дан',
        genres: ['Научна фантастика', 'Хорор'],
        aliases: ['Спајдермен'],
      },
    ],
  };
  const html = renderDayPage(cyrillic, '2026-08-19');
  assert.doesNotMatch(html, /[\u0400-\u04FF]/, 'page must contain no Cyrillic');
  assert.match(html, /Spajdermen: Novi dan/);
  assert.match(html, /Naučna fantastika/);
});

test('escapeHtml converts Cyrillic while still escaping markup', () => {
  assert.equal(escapeHtml('Хорор & <b>'), 'Horor &amp; &lt;b&gt;');
});
