import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trailerLink, trailerSearchUrl } from './trailer.js';

test('a known trailer opens that video directly', () => {
  const link = trailerLink({ title: 'Spajdermen: Novi dan', trailerKey: 'abc123' });
  assert.equal(link.url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(link.exact, true);
});

test('without a trailer the poster falls back to a YouTube search', () => {
  const link = trailerLink({ title: 'Spajdermen: Novi dan' });
  assert.equal(link.exact, false, 'the UI must be able to word the tooltip honestly');
  assert.match(link.url, /^https:\/\/www\.youtube\.com\/results\?search_query=/);
});

test('the search asks in Serbian, and includes the original title when it differs', () => {
  const url = trailerSearchUrl({
    title: 'Spajdermen: Novi dan',
    originalTitle: 'Spider-Man: Brand New Day',
  });
  const query = decodeURIComponent(new URL(url).searchParams.get('search_query') ?? '');
  assert.equal(query, 'Spajdermen: Novi dan Spider-Man: Brand New Day trailer srpski');
});

test('a title identical to the original is not repeated in the query', () => {
  const url = trailerSearchUrl({ title: 'Dune', originalTitle: 'Dune' });
  const query = new URL(url).searchParams.get('search_query') ?? '';
  assert.equal(query, 'Dune trailer srpski');
});

test('titles with characters that break URLs are escaped', () => {
  // A raw '&' or '#' would silently truncate the query.
  const url = trailerSearchUrl({ title: 'Fast & Furious #9' });
  const query = new URL(url).searchParams.get('search_query') ?? '';
  assert.equal(query, 'Fast & Furious #9 trailer srpski');
});
