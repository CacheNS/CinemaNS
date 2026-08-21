import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeDegradedSources } from './alert.js';
import type { SourceStatus } from './core/types.js';

const healthy: SourceStatus = {
  ok: true,
  fetchedAt: '2026-08-21T06:00:00.000Z',
  movieCount: 5,
  showtimeCount: 40,
  stale: false,
};

test('a fully healthy run has nothing to report', () => {
  assert.deepEqual(
    describeDegradedSources({ 'arena-novi-sad': healthy, 'cinestar-novi-sad': healthy }),
    [],
  );
});

test('a single failure does not alert yet, to avoid paging on a one-off blip', () => {
  const firstFailure: SourceStatus = {
    ok: true,
    stale: true,
    fetchedAt: '2026-08-20T06:00:00.000Z',
    movieCount: 5,
    showtimeCount: 40,
    error: '403 Forbidden',
    consecutiveFailures: 1,
  };
  assert.deepEqual(describeDegradedSources({ 'cinestar-novi-sad': firstFailure }), []);
});

test('a source serving cached data is reported once it has failed twice in a row', () => {
  const stale: SourceStatus = {
    ok: true,
    stale: true,
    fetchedAt: '2026-08-20T06:00:00.000Z',
    movieCount: 5,
    showtimeCount: 40,
    error: '403 Forbidden',
    consecutiveFailures: 2,
  };
  const [line] = describeDegradedSources({ 'cinestar-novi-sad': stale });
  assert.match(line!, /CineStar/);
  assert.match(line!, /zastarele podatke od 2026-08-20/);
  assert.match(line!, /403 Forbidden/);
});

test('a source with no fallback at all is worded differently from a stale one', () => {
  const dead: SourceStatus = {
    ok: false,
    stale: true,
    fetchedAt: '2026-08-21T06:00:00.000Z',
    movieCount: 0,
    showtimeCount: 0,
    error: 'timeout',
    consecutiveFailures: 3,
  };
  const [line] = describeDegradedSources({ 'arena-novi-sad': dead });
  assert.match(line!, /nema nikakvih podataka/);
});

test('an unrecognized cinema id still produces a line instead of throwing', () => {
  const dead: SourceStatus = {
    ok: false,
    stale: false,
    fetchedAt: '2026-08-21T06:00:00.000Z',
    movieCount: 0,
    showtimeCount: 0,
    error: 'boom',
    consecutiveFailures: 2,
  };
  const lines = describeDegradedSources({
    // Cast is intentional: this exercises the fallback for a key not in CINEMAS.
    ['not-a-real-cinema' as never]: dead,
  });
  assert.equal(lines.length, 1);
});
