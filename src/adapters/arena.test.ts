import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseArenaListings,
  parseArenaOriginCountry,
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
  assert.ok(showtimes.every((showtime) => showtime.cinemaId === 'arena-novi-sad'));
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

test('ignores the placeholder row Arena leaves behind for a passed screening', () => {
  // Real markup shape: the pane holds one genuine screening and one leftover
  // stub whose booking link stops at /index/ with no screening id. Both read
  // 00:00, so only the missing id tells them apart.
  const html = `<ul class="datumar-list">
      <li class="datumar"><a href="#t1">sre 19.08.2026.</a></li>
    </ul>
    <div class="tab-content">
      <div class="tab-pane" id="t1">
        <a href="http://www.arenacineplex.com/rezervacija/numSale/index/"><h3>00:00</h3><span>Sala:4</span></a>
        <a href="http://www.arenacineplex.com/rezervacija/numSale/index/197750"><h3>00:00</h3><span>Sala:2</span></a>
      </div>
    </div>`;

  const showtimes = parseArenaShowtimes(html, { url: 'http://x/film/1/Y', title: 'UKUS STRAHA' }, [
    '2026-08-19',
  ]);

  // A genuine midnight screening must survive; only the id-less stub goes.
  assert.equal(showtimes.length, 1);
  assert.equal(showtimes[0]?.time, '00:00');
  assert.equal(showtimes[0]?.hall, '2');
});

test('booking links use the ticket host over HTTPS', () => {
  // Arena's own site has no working HTTPS, but ulaznice.arenacineplex.com does,
  // and that is where the reader types card details.
  const showtimes = parseArenaShowtimes(film, { url: 'http://x/film/1/Y' }, FIXTURE_DAYS);
  const booking = showtimes.filter((showtime) => /ulaznice\.arenacineplex\.com/.test(showtime.bookingUrl));

  assert.ok(booking.length > 0, 'fixture should contain real booking links');
  assert.ok(booking.every((showtime) => showtime.bookingUrl.startsWith('https://')));
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

test('reads the country of production', () => {
  // The real page renders sibling rows with no whitespace between them, so the
  // value runs straight into the next label.
  const html =
    '<body><div class="d"><div><strong>Distributer:&nbsp;</strong>MegaCom Film</div>' +
    '<div><strong>Zemlja porekla:&nbsp;</strong>RS</div>' +
    '<div><strong>Godina proizvodnje:&nbsp;</strong>2025</div></div></body>';
  assert.equal(parseArenaOriginCountry(html), 'RS');
  assert.equal(parseArenaOriginCountry('<body>nema podataka</body>'), undefined);
});

test('a booking link pointing off Arena is refused rather than rendered', () => {
  // Arena is the one source fetched over plaintext HTTP, so its markup is the
  // most tamperable input we have: an injected link must not become a chip.
  const hostile = film.replace(
    /href="([^"]*numSale[^"]*)"/,
    'href="https://phishing.test/pay"',
  );
  const showtimes = parseArenaShowtimes(hostile, { url: `${'http://www.arenacineplex.com'}/film/1` }, FIXTURE_DAYS);
  for (const showtime of showtimes) {
    assert.ok(
      /^https?:\/\/(www\.arenacineplex\.com|ulaznice\.arenacineplex\.com)\//.test(showtime.bookingUrl),
      `off-origin booking URL survived: ${showtime.bookingUrl}`,
    );
  }
});

test('a javascript: link in Arena markup never reaches a listing', () => {
  const hostile = home.replace(/href="\/film\//, 'href="javascript:alert(1)#/film/');
  for (const listing of parseArenaListings(hostile)) {
    assert.ok(listing.url.startsWith('http://www.arenacineplex.com/'), listing.url);
    if (listing.posterUrl) {
      assert.ok(listing.posterUrl.startsWith('http://www.arenacineplex.com/'), listing.posterUrl);
    }
  }
});
