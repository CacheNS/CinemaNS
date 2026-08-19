import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cineplexxBookingUrl } from './cineplexx.js';

test('a Cineplexx chip deep-links to the ticket wizard for that screening', () => {
  // The API session id already carries the venue ("1116-89916"), which is what
  // makes this link venue-specific where a film page is not.
  assert.equal(
    cineplexxBookingUrl('1116-89916', 'novi-sad'),
    'https://www.cineplexx.rs/purchase/wizard/1116-89916',
  );
});

test('the Cineplexx booking link never points at /movie/, which is a 404', () => {
  // /movie/<slug> looks plausible and was shipped, but the site serves film
  // pages from /film/<slug>; the wrong path made every chip a dead link.
  const url = cineplexxBookingUrl('1113-120355', 'usce');
  assert.ok(!url.includes('/movie/'));
});

test('a session with no id falls back to the venue programme, not a dead film page', () => {
  assert.equal(
    cineplexxBookingUrl(undefined, 'delta-city'),
    'https://www.cineplexx.rs/cinemas/delta-city?date=all',
  );
});
