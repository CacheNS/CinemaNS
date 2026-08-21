import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  audioFromFormatCode,
  formatFromCode,
  parseCinestar,
  parseCinestarOriginalTitle,
  resolveDate,
} from './cinestar.js';
import { FIXTURE_DAYS, assertValidShowtimes, fixture } from './testing.js';

const html = fixture('cinestar.html');
const PAGE_URL = 'https://www.cinestarcinemas.rs/bioskop/novi-sad-big';

test('resolves CineStar day labels without a year', () => {
  assert.equal(resolveDate('DANAS, 19.08.', FIXTURE_DAYS), '2026-08-19');
  assert.equal(resolveDate('SUTRA, 20.08.', FIXTURE_DAYS), '2026-08-20');
  // Comma placement is inconsistent on the site.
  assert.equal(resolveDate('subota 22.08.', FIXTURE_DAYS), '2026-08-22');
  assert.equal(resolveDate('nedelja, 23.08.', FIXTURE_DAYS), '2026-08-23');
  // Outside the window, so it must not be guessed into it.
  assert.equal(resolveDate('sreda 30.09.', FIXTURE_DAYS), null);
});

test('reads dubbing from CineStar format codes', () => {
  assert.equal(audioFromFormatCode('TITL'), 'subtitled');
  assert.equal(audioFromFormatCode('SINH'), 'dubbed');
  assert.equal(audioFromFormatCode('KIDS/SINH'), 'dubbed');
  assert.equal(audioFromFormatCode('4DX/3D/TITL'), 'subtitled');
  assert.equal(audioFromFormatCode('OV'), 'subtitled');
});

test('reads projection format from CineStar codes', () => {
  assert.equal(formatFromCode('4DX/TITL'), '4DX');
  assert.equal(formatFromCode('SCREENX/TITL'), 'ScreenX');
  assert.equal(formatFromCode('3D/OV'), '3D');
  assert.equal(formatFromCode('TITL'), '2D');
});

test('parses the saved CineStar page', () => {
  const movies = parseCinestar(html, FIXTURE_DAYS, 'cinestar-novi-sad', PAGE_URL);

  assert.ok(movies.length >= 15, `expected many films, got ${movies.length}`);
  const showtimes = movies.flatMap((movie) => movie.showtimes);
  assert.ok(showtimes.length >= 150, `expected many showtimes, got ${showtimes.length}`);
  assertValidShowtimes(showtimes);

  for (const movie of movies) {
    assert.equal(movie.cinemaId, 'cinestar-novi-sad');
    assert.ok(movie.rawTitle.length > 0);
    // The genre label must not leak into the title.
    assert.ok(!/žanr/i.test(movie.rawTitle), `genre leaked into title: ${movie.rawTitle}`);
  }

  // Both audio kinds are present in the real programme.
  assert.ok(showtimes.some((showtime) => showtime.audio === 'dubbed'));
  assert.ok(showtimes.some((showtime) => showtime.audio === 'subtitled'));

  // Genres are captured so the kids heuristic works without TMDb.
  assert.ok(movies.some((movie) => (movie.genres ?? []).length > 0));
});

test('reads the original title from a CineStar film page', () => {
  const page = `
    <div class="movie-detail-item">
      <span class="gray">Izvorni naslov: </span><span>Practical Magic 2</span>
    </div>
    <div class="movie-detail-item">
      <span class="gray">Režiser: </span><span>Susanne Bier</span>
    </div>`;
  assert.equal(parseCinestarOriginalTitle(page), 'Practical Magic 2');
  assert.equal(parseCinestarOriginalTitle('<div class="movie-detail-item"></div>'), undefined);
});

test('film page links are absolute so they can be fetched', () => {
  const movies = parseCinestar(html, FIXTURE_DAYS, 'cinestar-novi-sad', PAGE_URL);
  const linked = movies.filter((movie) => movie.detailUrl);
  assert.ok(linked.length > 0);
  for (const movie of linked) {
    assert.match(movie.detailUrl ?? '', /^https:\/\/cinestarcinemas\.rs\//);
  }
});

test('a booking or detail link pointing off cinestarcinemas.rs is refused', () => {
  const page = `
    <div class="movie-item" data-genre="Drama">
      <div class="movie-desc">
        <h2>Naslov</h2>
        <a href="https://evil.test/film/naslov"></a>
      </div>
      <div class="poster-wrapper"><img src="/img/poster.jpg"></div>
      <div class="day-wrapper">
        <div class="day">DANAS, ${FIXTURE_DAYS[0]!.slice(8, 10)}.${FIXTURE_DAYS[0]!.slice(
    5,
    7,
  )}.</div>
        <a class="perf" href="https://evil.test/Shop?perf=1">
          <span class="time">18:00</span>
        </a>
        <a class="perf" href="/Shop?perf=2">
          <span class="time">20:00</span>
        </a>
      </div>
    </div>`;
  const [movie] = parseCinestar(page, FIXTURE_DAYS, 'cinestar-novi-sad', PAGE_URL);
  assert.equal(movie?.detailUrl, undefined, 'an off-origin detail link must not be trusted');

  const [offOrigin, onOrigin] = movie?.showtimes ?? [];
  assert.equal(offOrigin?.bookingUrl, PAGE_URL, 'an off-origin booking link falls back to the page');
  assert.equal(onOrigin?.bookingUrl, 'https://cinestarcinemas.rs/Shop?perf=2');
});

test('a premium format keeps its 3D', () => {
  assert.equal(formatFromCode('4DX/3D/TITL'), '4DX 3D');
  assert.equal(formatFromCode('4DX/TITL'), '4DX');
  assert.equal(formatFromCode('3D/TITL'), '3D');
  assert.equal(formatFromCode('SCREENX/3D/TITL'), 'ScreenX 3D');
  assert.equal(formatFromCode('TITL'), '2D');
});
