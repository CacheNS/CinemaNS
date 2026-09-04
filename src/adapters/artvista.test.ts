import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ARENA,
  RODA,
  parseArtVistaListings,
  parseArtVistaOriginCountry,
  parseArtVistaOriginalTitle,
  parseArtVistaRuntime,
  parseArtVistaShowtimes,
  parseArtVistaTitle,
} from './artvista.js';
import { FIXTURE_DAYS, RODA_FIXTURE_DAYS, assertValidShowtimes, fixture } from './testing.js';

const home = fixture('arena-home.html');
const film = fixture('arena-film.html');
const rodaHome = fixture('roda-home.html');
const rodaFilm = fixture('roda-film.html');

test('collects every film linked from the Arena home page', () => {
  const listings = parseArtVistaListings(ARENA, home);

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
  const title = parseArtVistaTitle(film);
  assert.ok(title && title.length > 0);
  assert.ok(!/\|/.test(title), 'must not include the site name');
});

test('pairs Arena date tabs with their panes', () => {
  const showtimes = parseArtVistaShowtimes(
    ARENA,
    film,
    { url: 'http://www.arenacineplex.com/film/1/X' },
    FIXTURE_DAYS,
  );

  assert.ok(showtimes.length >= 20, `expected a full week, got ${showtimes.length}`);
  assertValidShowtimes(showtimes);

  // Each tab is a distinct day, so showtimes must spread across several dates.
  assert.ok(new Set(showtimes.map((showtime) => showtime.date)).size >= 5);
  assert.ok(showtimes.every((showtime) => showtime.cinemaId === 'arena-novi-sad'));
});

test('reads dubbing from the Arena title', () => {
  const dubbed = parseArtVistaShowtimes(
    ARENA,
    film,
    { url: 'http://x/film/1/Y', title: 'ZOOTROPOLIS 2 (sinhronizovano) DS' },
    FIXTURE_DAYS,
  );
  assert.ok(dubbed.every((showtime) => showtime.audio === 'dubbed'));

  const plain = parseArtVistaShowtimes(
    ARENA,
    film,
    { url: 'http://x/film/1/Y', title: 'IZLAZ IZ IGRE' },
    FIXTURE_DAYS,
  );
  assert.ok(plain.every((showtime) => showtime.audio === 'subtitled'));
});

test('drops dates outside the requested window', () => {
  const showtimes = parseArtVistaShowtimes(ARENA, film, { url: 'http://x/film/1/Y' }, [
    '2026-08-19',
  ]);
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

  const showtimes = parseArtVistaShowtimes(
    ARENA,
    html,
    { url: 'http://x/film/1/Y', title: 'UKUS STRAHA' },
    ['2026-08-19'],
  );

  // A genuine midnight screening must survive; only the id-less stub goes.
  assert.equal(showtimes.length, 1);
  assert.equal(showtimes[0]?.time, '00:00');
  assert.equal(showtimes[0]?.hall, '2');
});

test('booking links use the ticket host over HTTPS', () => {
  // Arena's own site has no working HTTPS, but ulaznice.arenacineplex.com does,
  // and that is where the reader types card details.
  const showtimes = parseArtVistaShowtimes(ARENA, film, { url: 'http://x/film/1/Y' }, FIXTURE_DAYS);
  const booking = showtimes.filter((showtime) =>
    /ulaznice\.arenacineplex\.com/.test(showtime.bookingUrl),
  );

  assert.ok(booking.length > 0, 'fixture should contain real booking links');
  assert.ok(booking.every((showtime) => showtime.bookingUrl.startsWith('https://')));
});

test('reads the original title printed next to the Serbian one', () => {
  assert.equal(parseArtVistaOriginalTitle(film), 'Spider-Man: Brand New Day');
  assert.equal(parseArtVistaOriginalTitle('<html><body><h1>X</h1></body></html>'), undefined);
});

test('reads the running time, tolerating the empty field Arena often leaves', () => {
  // This fixture is one of the films where Arena printed "Trajanje:  min".
  assert.equal(parseArtVistaRuntime(film), undefined);
  assert.equal(
    parseArtVistaRuntime(
      '<html><body><div><strong>Trajanje:&nbsp; </strong> 128 min</div></body></html>',
    ),
    128,
  );
  assert.equal(parseArtVistaRuntime('<html><body>Trajanje: 5 min</body></html>'), undefined);
});

test('reads the country of production', () => {
  // The real page renders sibling rows with no whitespace between them, so the
  // value runs straight into the next label.
  const html =
    '<body><div class="d"><div><strong>Distributer:&nbsp;</strong>MegaCom Film</div>' +
    '<div><strong>Zemlja porekla:&nbsp;</strong>RS</div>' +
    '<div><strong>Godina proizvodnje:&nbsp;</strong>2025</div></div></body>';
  assert.equal(parseArtVistaOriginCountry(html), 'RS');
  assert.equal(parseArtVistaOriginCountry('<body>nema podataka</body>'), undefined);
});

test('a booking link pointing off Arena is refused rather than rendered', () => {
  // Arena is fetched over plaintext HTTP, so its markup is among the most
  // tamperable input we have: an injected link must not become a chip.
  const hostile = film.replace(/href="([^"]*numSale[^"]*)"/, 'href="https://phishing.test/pay"');
  const showtimes = parseArtVistaShowtimes(
    ARENA,
    hostile,
    { url: 'http://www.arenacineplex.com/film/1' },
    FIXTURE_DAYS,
  );
  for (const showtime of showtimes) {
    assert.ok(
      /^https?:\/\/(www\.arenacineplex\.com|ulaznice\.arenacineplex\.com)\//.test(
        showtime.bookingUrl,
      ),
      `off-origin booking URL survived: ${showtime.bookingUrl}`,
    );
  }
});

test('a javascript: link in Arena markup never reaches a listing', () => {
  const hostile = home.replace(/href="\/film\//, 'href="javascript:alert(1)#/film/');
  for (const listing of parseArtVistaListings(ARENA, hostile)) {
    assert.ok(listing.url.startsWith('http://www.arenacineplex.com/'), listing.url);
    if (listing.posterUrl) {
      assert.ok(listing.posterUrl.startsWith('http://www.arenacineplex.com/'), listing.posterUrl);
    }
  }
});

// --- Roda Cineplex: the same CMS, in Beograd -------------------------------
// These run against Roda's own saved pages, so a divergence between the two
// sites fails here rather than silently scraping one venue with the other's
// assumptions.

test('collects every film linked from the Roda home page', () => {
  const listings = parseArtVistaListings(RODA, rodaHome);

  assert.ok(listings.length >= 10, `expected the full programme, got ${listings.length}`);
  for (const listing of listings) {
    assert.match(listing.url, /^http:\/\/www\.rodacineplex\.com\/film\/\d+/);
  }
  assert.equal(new Set(listings.map((listing) => listing.url)).size, listings.length);
  assert.ok(listings.every((listing) => !/arenacineplex/.test(listing.url)));
});

test('pairs Roda date tabs with their panes and stamps the Beograd venue', () => {
  const showtimes = parseArtVistaShowtimes(
    RODA,
    rodaFilm,
    { url: 'http://www.rodacineplex.com/film/2766/SPAJDERMEN:NOVI-DAN-3D' },
    RODA_FIXTURE_DAYS,
  );

  assert.ok(showtimes.length > 0, 'expected screenings in the captured week');
  assertValidShowtimes(showtimes, RODA_FIXTURE_DAYS);
  assert.ok(showtimes.every((showtime) => showtime.cinemaId === 'roda-beograd'));
  assert.ok(new Set(showtimes.map((showtime) => showtime.date)).size >= 5);
});

test('Roda booking links are upgraded to the HTTPS ticket host', () => {
  // Measured: https://ulaznice.rodacineplex.com serves the real booking page,
  // unlike Tuck's ticket host, so the link is upgraded rather than left plain.
  const showtimes = parseArtVistaShowtimes(
    RODA,
    rodaFilm,
    { url: 'http://www.rodacineplex.com/film/1/Y' },
    RODA_FIXTURE_DAYS,
  );
  const booking = showtimes.filter((showtime) =>
    /ulaznice\.rodacineplex\.com/.test(showtime.bookingUrl),
  );

  assert.ok(booking.length > 0, 'fixture should contain real booking links');
  assert.ok(booking.every((showtime) => showtime.bookingUrl.startsWith('https://')));
});

test('Roda reads its own title, original title, country and format', () => {
  assert.equal(parseArtVistaTitle(rodaFilm), 'SPAJDERMEN:NOVI DAN 3D');
  assert.equal(parseArtVistaOriginalTitle(rodaFilm), 'Spider-Man: Brand New Day 3D');
  assert.equal(parseArtVistaOriginCountry(rodaFilm), 'US');

  const showtimes = parseArtVistaShowtimes(
    RODA,
    rodaFilm,
    { url: 'http://www.rodacineplex.com/film/2766/SPAJDERMEN:NOVI-DAN-3D' },
    RODA_FIXTURE_DAYS,
  );
  assert.ok(showtimes.every((showtime) => showtime.format === '3D'));
});

test('reads dubbing from the Roda title', () => {
  const dubbed = parseArtVistaShowtimes(
    RODA,
    rodaFilm,
    {
      url: 'http://www.rodacineplex.com/film/1/Y',
      title: 'PERA KOJOT PROTIV SISTEMA (sinhronizovano)',
    },
    RODA_FIXTURE_DAYS,
  );
  assert.ok(dubbed.length > 0);
  assert.ok(dubbed.every((showtime) => showtime.audio === 'dubbed'));
});

test('a booking link pointing off Roda is refused rather than rendered', () => {
  const hostile = rodaFilm.replace(
    /href="([^"]*numSale[^"]*)"/g,
    'href="https://phishing.test/pay"',
  );
  const showtimes = parseArtVistaShowtimes(
    RODA,
    hostile,
    { url: 'http://www.rodacineplex.com/film/1' },
    RODA_FIXTURE_DAYS,
  );
  for (const showtime of showtimes) {
    assert.ok(
      /^https?:\/\/(www\.rodacineplex\.com|ulaznice\.rodacineplex\.com)\//.test(
        showtime.bookingUrl,
      ),
      `off-origin booking URL survived: ${showtime.bookingUrl}`,
    );
  }
});

test('a javascript: link in Roda markup never reaches a listing', () => {
  const hostile = rodaHome.replace(/href="\/film\//, 'href="javascript:alert(1)#/film/');
  for (const listing of parseArtVistaListings(RODA, hostile)) {
    assert.ok(listing.url.startsWith('http://www.rodacineplex.com/'), listing.url);
    if (listing.posterUrl) {
      assert.ok(listing.posterUrl.startsWith('http://www.rodacineplex.com/'), listing.posterUrl);
    }
  }
});

test("one venue's markup can never yield the other's origins", () => {
  // The point of parameterising rather than copying: the venue config must
  // fully determine the origins, with no Arena constant left behind.
  const asRoda = parseArtVistaListings(RODA, home);
  assert.ok(
    asRoda.every((listing) => listing.url.startsWith('http://www.rodacineplex.com/')),
    'Arena markup parsed as Roda must resolve onto Roda origins only',
  );
});
