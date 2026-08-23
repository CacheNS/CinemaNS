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
      raw('arena-novi-sad', 'SPAJDERMEN:NOVI DAN 3D', 'SPAJDERMEN:NOVI DAN'),
      raw('cinestar-novi-sad', 'Spajdermen: Novi dan', 'Spajdermen: Novi dan'),
      raw('cineplexx-novi-sad', 'Spajdermen: Novi Dan', 'Spider-Man: Brand New Day'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
  assert.equal(new Set(movies[0]!.showtimes.map((s) => s.cinemaId)).size, 3);
});

// The case that forced per-venue ids: five Cineplexx venues in Beograd would
// otherwise all claim `cineplexx` and collapse into one block, showing Delta
// City and Galerija showtimes as if they were the same building.
test('venues of the same chain stay distinct after merging', async () => {
  const { movies } = await mergeMovies(
    [
      raw('cineplexx-delta-city', 'Spajdermen: Novi dan', 'Spajdermen: Novi dan'),
      raw('cineplexx-galerija', 'Spajdermen: Novi dan', 'Spajdermen: Novi dan'),
      raw('cineplexx-novi-sad', 'Spajdermen: Novi dan', 'Spajdermen: Novi dan'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
  assert.deepEqual(
    [...new Set(movies[0]!.showtimes.map((s) => s.cinemaId))].sort(),
    ['cineplexx-delta-city', 'cineplexx-galerija', 'cineplexx-novi-sad'],
  );
});

// A film in both cities is one Movie with showtimes from both, which halves
// the TMDb lookups; the split back into cities happens at render.
test('a film showing in two cities merges into one entry', async () => {
  const { movies } = await mergeMovies(
    [
      raw('arena-novi-sad', 'Vajana 2', 'Vajana 2'),
      raw('cinestar-beograd-ada', 'Vajana 2', 'Vajana 2'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
  assert.equal(movies[0]!.showtimes.length, 2);
});

test('matches a Serbian title against another cinema English title', async () => {
  const { movies } = await mergeMovies(
    [
      raw('cinestar-novi-sad', 'Odiseja', 'Odiseja'),
      // Cineplexx publishes the English original as the searchable title.
      raw('cineplexx-novi-sad', 'Odiseja', 'The Odyssey'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
});

test('keeps genuinely different films apart', async () => {
  const { movies } = await mergeMovies(
    [raw('cinestar-novi-sad', 'Odiseja', 'Odiseja'), raw('arena-novi-sad', 'OPSESIJA', 'OPSESIJA')],
    offlineTmdb(),
  );

  assert.equal(movies.length, 2);
});

test('prefers a readable display title over the caps format-laden one', async () => {
  const { movies } = await mergeMovies(
    [
      raw('arena-novi-sad', 'MALCI I MONSTRUMI 3D (sinhronizovano)', 'MALCI I MONSTRUMI'),
      raw('cinestar-novi-sad', 'Malci i monstrumi', 'Malci i monstrumi'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies[0]!.title, 'Malci i monstrumi');
});

test('dubbing is tracked per showtime and summarised on the movie', async () => {
  const mixed: RawMovie = {
    cinemaId: 'cinestar-novi-sad',
    rawTitle: 'Vajana',
    cleanTitle: 'Vajana',
    showtimes: [showtime('cinestar-novi-sad', '14:00', 'dubbed'), showtime('cinestar-novi-sad', '20:00', 'subtitled')],
  };

  const { movies } = await mergeMovies([mixed], offlineTmdb());
  assert.equal(movies[0]!.hasDubbed, true);
  assert.equal(movies[0]!.showtimes.filter((s) => s.audio === 'dubbed').length, 1);
});

test('uses cinema genres for the kids heuristic when TMDb is unavailable', async () => {
  const { movies } = await mergeMovies(
    [raw('cinestar-novi-sad', 'Vajana', 'Vajana', { genres: ['Animirani', 'Porodični'] })],
    offlineTmdb(),
  );

  assert.equal(movies[0]!.kidFriendly, true);
  assert.equal(movies[0]!.ageRating?.confident, false);
});

test('an unrated film is never presented as kid friendly', async () => {
  const { movies } = await mergeMovies([raw('arena-novi-sad', 'HAJDUK U BEOGRADU', 'HAJDUK U BEOGRADU')], offlineTmdb());
  assert.equal(movies[0]!.kidFriendly, false);
  assert.equal(movies[0]!.ageRating, undefined);
});

test('showtimes are sorted chronologically', async () => {
  const unsorted: RawMovie = {
    cinemaId: 'cinestar-novi-sad',
    rawTitle: 'X',
    cleanTitle: 'X',
    showtimes: [showtime('cinestar-novi-sad', '22:00', 'subtitled'), showtime('cinestar-novi-sad', '09:30', 'subtitled')],
  };

  const { movies } = await mergeMovies([unsorted], offlineTmdb());
  assert.deepEqual(movies[0]!.showtimes.map((s) => s.time), ['09:30', '22:00']);
});

test('a labelled original title beats one scraped positionally', async () => {
  const { movies } = await mergeMovies(
    [
      // Arena has no original title for this film, so its page shows the
      // director in that position instead.
      raw('arena-novi-sad', 'ASTRALNA PODMUKLOST', 'ASTRALNA PODMUKLOST', {
        originalTitle: 'Jacob Chase',
      }),
      raw('cinestar-novi-sad', 'Astralna podmuklost', 'Astralna podmuklost', {
        originalTitle: 'Insidious: Out of the Further',
      }),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
  assert.equal(movies[0]?.originalTitle, 'Insidious: Out of the Further');
});

test('an exact running time beats a rounded one', async () => {
  const { movies } = await mergeMovies(
    [
      raw('arena-novi-sad', 'SPAJDERMEN', 'SPAJDERMEN', { runtimeMinutes: 150 }),
      raw('cineplexx-novi-sad', 'Spajdermen', 'Spider-Man', { runtimeMinutes: 145 }),
    ],
    offlineTmdb(),
  );

  assert.equal(movies[0]?.runtimeMinutes, 145);
});

test('Tuck metadata is trusted over Arena but not over CineStar', async () => {
  // Tuck labels its fields explicitly (title, runtime) like CineStar, unlike
  // Arena's positional prose, so it should win against Arena but lose to
  // CineStar in the trust order (R-4.8).
  const { movies: vsArena } = await mergeMovies(
    [
      raw('arena-novi-sad', 'SPAJDERMEN', 'SPAJDERMEN', { runtimeMinutes: 150 }),
      raw('tuck-beograd', 'Spajdermen', 'Spider-Man', { runtimeMinutes: 145 }),
    ],
    offlineTmdb(),
  );
  assert.equal(vsArena[0]?.runtimeMinutes, 145);

  const { movies: vsCinestar } = await mergeMovies(
    [
      raw('tuck-beograd', 'Spajdermen', 'Spider-Man', { runtimeMinutes: 150 }),
      raw('cinestar-novi-sad', 'Spajdermen', 'Spider-Man', { runtimeMinutes: 145 }),
    ],
    offlineTmdb(),
  );
  assert.equal(vsCinestar[0]?.runtimeMinutes, 145);
});

test('a domestic film is neither dubbed nor subtitled', async () => {
  const { movies } = await mergeMovies(
    [
      raw('arena-novi-sad', 'HAJDUK U BEOGRADU DS', 'HAJDUK U BEOGRADU', { originCountry: 'RS' }),
      raw('cinestar-novi-sad', 'Hajduk u Beogradu', 'Hajduk u Beogradu'),
    ],
    offlineTmdb(),
  );

  assert.equal(movies.length, 1);
  assert.ok(movies[0]?.showtimes.length);
  // The label must be consistent even for the cinema that said nothing.
  assert.ok(movies[0]?.showtimes.every((s) => s.audio === 'original'));

  const foreign = await mergeMovies([raw('arena-novi-sad', 'THE ODYSSEY', 'THE ODYSSEY')], offlineTmdb());
  assert.ok(foreign.movies[0]?.showtimes.every((s) => s.audio === 'subtitled'));
});

test('a domestic film is recognised in a city that has no Arena', async () => {
  // Only Arena publishes a country of production and Arena exists only in Novi
  // Sad, so a domestic film playing exclusively in Beograd used to come out
  // "titlovano". TMDb's original language is the city-independent fallback.
  const tmdb = new TmdbClient(undefined);
  tmdb.resolve = async (lookup: { cleanTitle: string }) =>
    ({
      id: 1,
      title: lookup.cleanTitle,
      originalTitle: lookup.cleanTitle,
      originalLanguage: 'sr',
      genres: [],
      adult: false,
      certifications: {},
    }) as never;

  const { movies } = await mergeMovies(
    [raw('cineplexx-usce', 'Nedelja', 'Nedelja'), raw('cinestar-beograd-ada', 'Nedelja', 'Nedelja')],
    tmdb,
  );

  assert.equal(movies.length, 1);
  assert.ok(movies[0]?.showtimes.length);
  assert.ok(movies[0]?.showtimes.every((s) => s.audio === 'original'));
});

test('a foreign film is not called domestic just because TMDb resolved it', async () => {
  const tmdb = new TmdbClient(undefined);
  tmdb.resolve = async (lookup: { cleanTitle: string }) =>
    ({
      id: 2,
      title: lookup.cleanTitle,
      originalTitle: lookup.cleanTitle,
      originalLanguage: 'hr',
      genres: [],
      adult: false,
      certifications: {},
    }) as never;

  // Croatian films also play untranslated here, but "domaći film" would be a
  // false claim about a foreign production.
  const { movies } = await mergeMovies([raw('cineplexx-usce', 'Ćiro', 'Ćiro')], tmdb);
  assert.ok(movies[0]?.showtimes.every((s) => s.audio === 'subtitled'));
});

/**
 * Resolves only the listings whose cleanTitle is in `known`, which is what real
 * TMDb resolution looks like: it is per-listing, so one cinema's spelling of a
 * film can resolve while another's does not.
 */
function partialTmdb(known: Record<string, number>): TmdbClient {
  const client = new TmdbClient(undefined);
  client.resolve = async (lookup: { cleanTitle: string }) => {
    const id = known[lookup.cleanTitle];
    if (id === undefined) return null;
    return {
      id,
      title: lookup.cleanTitle,
      originalTitle: lookup.cleanTitle,
      genres: [],
      adult: false,
      certifications: {},
    } as never;
  };
  return client;
}

test('a film is not split when only one cinema listing resolves to TMDb', async () => {
  // Enabling TMDb once *increased* the film count, because an unresolved
  // listing was only ever matched against other unresolved groups.
  const { movies } = await mergeMovies(
    [
      raw('cineplexx-novi-sad', 'Spajdermen: Novi Dan', 'Spider-Man: Brand New Day'),
      raw('arena-novi-sad', 'SPAJDERMEN:NOVI DAN 3D', 'SPAJDERMEN:NOVI DAN'),
    ],
    partialTmdb({ 'Spider-Man: Brand New Day': 1234 }),
  );

  assert.equal(movies.length, 1);
  assert.equal(movies[0]?.tmdbId, 1234);
  assert.deepEqual(
    [...new Set(movies[0]!.showtimes.map((s) => s.cinemaId))].sort(),
    ['arena-novi-sad', 'cineplexx-novi-sad'],
  );
});

test('the unresolved listing may arrive first and still be adopted', async () => {
  const { movies } = await mergeMovies(
    [
      raw('arena-novi-sad', 'SPAJDERMEN:NOVI DAN 3D', 'SPAJDERMEN:NOVI DAN'),
      raw('cineplexx-novi-sad', 'Spajdermen: Novi Dan', 'Spider-Man: Brand New Day'),
    ],
    partialTmdb({ 'Spider-Man: Brand New Day': 1234 }),
  );

  assert.equal(movies.length, 1);
  assert.equal(movies[0]?.tmdbId, 1234, 'the group must adopt the id it later learned');
});
