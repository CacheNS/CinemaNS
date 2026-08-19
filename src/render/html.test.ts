import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, renderDayPage, renderPages, runtimeBucket } from './html.js';
import type { Snapshot } from '../core/types.js';

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
          cinemaId: 'cinestar',
          date: '2026-08-19',
          time: '14:00',
          format: '2D',
          audio: 'dubbed',
          bookingUrl: 'https://example.test/a',
        },
        {
          cinemaId: 'arena',
          date: '2026-08-19',
          time: '20:00',
          format: '3D',
          audio: 'subtitled',
          bookingUrl: 'https://example.test/b',
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
          cinemaId: 'cineplexx',
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
    arena: { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 1, showtimeCount: 1, stale: false },
    cineplexx: { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 1, showtimeCount: 1, stale: false },
    cinestar: {
      ok: true,
      fetchedAt: '2026-08-19T08:00:00.000Z',
      movieCount: 1,
      showtimeCount: 1,
      stale: true,
      error: 'timeout',
    },
  },
  diagnostics: { tmdbResolved: 2, tmdbUnresolved: 0, unresolvedTitles: [], unknownAudioShowtimes: 0 },
};

test('escapes user-visible strings', () => {
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
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
