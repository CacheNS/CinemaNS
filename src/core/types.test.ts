import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CINEMAS, CINEMA_IDS, CITIES, DEFAULT_CITY, cityById } from './types.js';
import type { CinemaId } from './types.js';

// The registry is written by hand in two places - the per-venue table and each
// city's ordered id list - so it is worth asserting they cannot drift apart.
test('every venue belongs to exactly one city, and every city lists only its own', () => {
  const listed = CITIES.flatMap((city) => city.cinemaIds);
  assert.equal(listed.length, new Set(listed).size, 'a venue is listed in two cities');
  assert.deepEqual([...listed].sort(), [...CINEMA_IDS].sort());

  for (const city of CITIES) {
    for (const id of city.cinemaIds) {
      assert.equal(CINEMAS[id].city, city.id, `${id} claims a different city`);
    }
  }
});

test('the default city exists and every city slug is unique', () => {
  assert.ok(cityById(DEFAULT_CITY));
  const slugs = CITIES.map((city) => city.slug);
  assert.equal(slugs.length, new Set(slugs).size);
});

test('a venue id is never reused for a different chain', () => {
  for (const id of CINEMA_IDS) {
    assert.ok(id.startsWith(CINEMAS[id].chain), `${id} does not name its chain`);
  }
});

test('Arena exists only in Novi Sad', () => {
  const arena = CINEMA_IDS.filter((id: CinemaId) => CINEMAS[id].chain === 'arena');
  assert.deepEqual(arena, ['arena-novi-sad']);
});
