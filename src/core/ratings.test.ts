import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatAgeLabel, heuristicRating, isKidFriendly, resolveAgeRating } from './ratings.js';
import { toSerbianLatin } from './titles.js';
import type { TmdbMovie } from '../tmdb/client.js';

function movie(certifications: Record<string, string>, extra: Partial<TmdbMovie> = {}): TmdbMovie {
  return {
    id: 1,
    title: 'Test',
    originalTitle: 'Test',
    genres: [],
    adult: false,
    certifications,
    ...extra,
  };
}

test('prefers the closest market that publishes a certification', () => {
  const rating = resolveAgeRating(movie({ HR: 'N12', US: 'R' }), [], false);
  assert.equal(rating?.source, 'HR');
  assert.equal(rating?.minAge, 12);
  assert.equal(rating?.confident, true);
});

test('maps foreign label systems onto a comparable age', () => {
  assert.equal(resolveAgeRating(movie({ US: 'PG-13' }), [], false)?.minAge, 13);
  assert.equal(resolveAgeRating(movie({ GB: 'U' }), [], false)?.minAge, 0);
  assert.equal(resolveAgeRating(movie({ DE: '16' }), [], false)?.minAge, 16);
});

test('the adult flag always wins', () => {
  const rating = resolveAgeRating(movie({ US: 'G' }, { adult: true }), [], false);
  assert.equal(rating?.minAge, 18);
});

test('falls back to a genre heuristic and marks it as unconfident', () => {
  const kid = heuristicRating(['Animirani', 'Porodični'], true);
  assert.equal(kid?.confident, false);
  assert.equal(kid?.minAge, 0);

  const horror = heuristicRating(['Horor'], false);
  assert.equal(horror?.minAge, 16);
  assert.equal(horror?.confident, false);

  // Nothing recognizable must stay unknown rather than become a guess.
  assert.equal(heuristicRating(['Drama'], false), undefined);
});

test('a horror animation is not treated as kid friendly', () => {
  assert.equal(heuristicRating(['Animirani', 'Horor'], true)?.minAge, 16);
});

test('kid-friendly cutoff and labels', () => {
  assert.equal(formatAgeLabel(0), 'Bez ograničenja');
  assert.equal(formatAgeLabel(12), '12+');
  assert.equal(isKidFriendly({ label: '12+', minAge: 12, source: 'HR', confident: true }), true);
  assert.equal(isKidFriendly({ label: '15+', minAge: 15, source: 'HR', confident: true }), false);
  // No rating at all must not count as kid friendly.
  assert.equal(isKidFriendly(undefined), false);
});

test('Cyrillic genres from TMDb still drive the heuristic', () => {
  // Regression: TMDb returns sr-RS genres in Cyrillic ("Хорор"), while the
  // keyword lists are Latin. Before transliteration at the TMDb boundary the
  // heuristic silently matched nothing, so horror films got no age badge at
  // all. Genres reaching this function must already be Latin.
  assert.equal(heuristicRating([toSerbianLatin('Хорор')], false)?.minAge, 16);
  assert.equal(heuristicRating([toSerbianLatin('Трилер')], false)?.minAge, 16);
  assert.equal(heuristicRating([toSerbianLatin('Цртани')], true)?.minAge, 0);
  assert.equal(heuristicRating([toSerbianLatin('Породични')], false)?.minAge, 6);
});

test('raw Cyrillic genres match nothing, which is why the boundary conversion matters', () => {
  assert.equal(heuristicRating(['Хорор'], false), undefined);
});
