import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeMovies } from './merge.js';
import { TmdbClient } from '../tmdb/client.js';
import type { CinemaId, RawMovie, Showtime } from './types.js';

/** TMDb disabled: this is the fallback path that must work on its own. */
const offlineTmdb = (): TmdbClient => new TmdbClient(undefined);

function showtime(cinemaId: CinemaId, time: string, audio: Showtime['audio']): Showtime {
  return {
    cinemaId,
    date: '2026-08-19',
    time,
    format: '2D',
    audio,
    bookingUrl: `https://example.test/${cinemaId}/${time}`,
  };
}

function raw(cinemaId: CinemaId, rawTitle: string, clean: string, extra: Partial<RawMovie> = {}): RawMovie {
  return {
    cinemaId,
    rawTitle,
    cleanTitle: clean,
    showtimes: [showtime(cinemaId, '18:00', 'subtitled')],
    ...extra,
  };
}

test('merges the same film across cinemas despite different spellings', async () => {
  const { movies } = await mergeMovies(
    [
      raw('arena', 'SPAJDERMEN:NOVI DAN 3D', 'SPAJDERMEN:NOVI DAN'),
      raw('cinestar', 'Spajdermen: Novi dan', 'Spajdermen: Novi dan'),
      raw('cineplexx', 'Spajdermen: Novi Dan', 'Spider-Man: Brand New Day'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
  assert.equal(new Set(movies[0]!.showtimes.map((s) => s.cinemaId)).size, 3);
});

test('matches a Serbian title against another cinema English title', async () => {
  const { movies } = await mergeMovies(
    [
      raw('cinestar', 'Odiseja', 'Odiseja'),
      // Cineplexx publishes the English original as the searchable title.
      raw('cineplexx', 'Odiseja', 'The Odyssey'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
});

test('keeps genuinely different films apart', async () => {
  const { movies } = await mergeMovies(
    [raw('cinestar', 'Odiseja', 'Odiseja'), raw('arena', 'OPSESIJA', 'OPSESIJA')],
    offlineTmdb(),
  );

  assert.equal(movies.length, 2);
});

test('prefers a readable display title over the caps format-laden one', async () => {
  const { movies } = await mergeMovies(
    [
      raw('arena', 'MALCI I MONSTRUMI 3D (sinhronizovano)', 'MALCI I MONSTRUMI'),
      raw('cinestar', 'Malci i monstrumi', 'Malci i monstrumi'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies[0]!.title, 'Malci i monstrumi');
});

test('dubbing is tracked per showtime and summarised on the movie', async () => {
  const mixed: RawMovie = {
    cinemaId: 'cinestar',
    rawTitle: 'Vajana',
    cleanTitle: 'Vajana',
    showtimes: [showtime('cinestar', '14:00', 'dubbed'), showtime('cinestar', '20:00', 'subtitled')],
  };

  const { movies } = await mergeMovies([mixed], offlineTmdb());
  assert.equal(movies[0]!.hasDubbed, true);
  assert.equal(movies[0]!.showtimes.filter((s) => s.audio === 'dubbed').length, 1);
});

test('uses cinema genres for the kids heuristic when TMDb is unavailable', async () => {
  const { movies } = await mergeMovies(
    [raw('cinestar', 'Vajana', 'Vajana', { genres: ['Animirani', 'Porodični'] })],
    offlineTmdb(),
  );

  assert.equal(movies[0]!.kidFriendly, true);
  assert.equal(movies[0]!.ageRating?.confident, false);
});

test('an unrated film is never presented as kid friendly', async () => {
  const { movies } = await mergeMovies([raw('arena', 'HAJDUK U BEOGRADU', 'HAJDUK U BEOGRADU')], offlineTmdb());
  assert.equal(movies[0]!.kidFriendly, false);
  assert.equal(movies[0]!.ageRating, undefined);
});

test('showtimes are sorted chronologically', async () => {
  const unsorted: RawMovie = {
    cinemaId: 'cinestar',
    rawTitle: 'X',
    cleanTitle: 'X',
    showtimes: [showtime('cinestar', '22:00', 'subtitled'), showtime('cinestar', '09:30', 'subtitled')],
  };

  const { movies } = await mergeMovies([unsorted], offlineTmdb());
  assert.deepEqual(movies[0]!.showtimes.map((s) => s.time), ['09:30', '22:00']);
});
