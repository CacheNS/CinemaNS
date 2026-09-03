import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  escapeHtml,
  renderDayPage,
  renderPages,
  renderRobots,
  renderSitemap,
  runtimeBucket,
  scoreBucket,
  safeUrl,
  BASE_URL,
} from './html.js';
import { CINEMA_IDS, CITIES, DEFAULT_CITY } from '../core/types.js';
import type { CinemaId, Snapshot, SourceStatus } from '../core/types.js';

// Every venue needs a status; the three the fixture cares about are overridden
// below, the rest just have to exist.
const ok3 = Object.fromEntries(
  CINEMA_IDS.map((id) => [
    id,
    { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 0, showtimeCount: 0, stale: false },
  ]),
) as Record<CinemaId, SourceStatus>;

const snapshot: Snapshot = {
  generatedAt: '2026-08-19T10:00:00.000Z',
  days: ['2026-08-19', '2026-08-20'],
  movies: [
    {
      key: 'tmdb:1',
      title: 'Vajana',
      originalTitle: 'Moana 2',
      runtimeMinutes: 100,
      score: { value: 7.25, votes: 1200, source: 'TMDb', url: 'https://example.test/tmdb/1' },
      genres: ['Animirani'],
      ageRating: { label: 'Bez ograničenja', minAge: 0, source: 'HR', confident: true },
      kidFriendly: true,
      hasDubbed: true,
      aliases: ['Vajana', 'VAJANA (sinhronizovano)'],
      showtimes: [
        {
          cinemaId: 'cinestar-novi-sad',
          date: '2026-08-19',
          time: '14:00',
          format: '2D',
          audio: 'dubbed',
          bookingUrl: 'https://example.test/a',
        },
        {
          cinemaId: 'arena-novi-sad',
          date: '2026-08-19',
          time: '20:00',
          format: '3D',
          audio: 'subtitled',
          bookingUrl: 'https://example.test/b',
        },
        {
          cinemaId: 'cineplexx-galerija',
          date: '2026-08-19',
          time: '18:00',
          format: '2D',
          audio: 'dubbed',
          bookingUrl: 'https://example.test/bg',
        },
      ],
    },
    {
      key: 'tmdb:3',
      title: 'Samo u Beogradu',
      genres: ['Drama'],
      kidFriendly: false,
      hasDubbed: false,
      aliases: [],
      showtimes: [
        {
          cinemaId: 'cinestar-beograd-ada',
          date: '2026-08-19',
          time: '21:00',
          format: '2D',
          audio: 'subtitled',
          bookingUrl: 'https://example.test/d',
        },
      ],
    },
    {
      key: 'tmdb:2',
      title: 'Zli mrtvi <script>',
      genres: ['Horor'],
      kidFriendly: false,
      hasDubbed: false,
      aliases: [],
      showtimes: [
        {
          cinemaId: 'cineplexx-novi-sad',
          date: '2026-08-20',
          time: '22:00',
          format: '2D',
          audio: 'subtitled',
          bookingUrl: 'https://example.test/c',
        },
      ],
    },
  ],
  sources: {
    ...ok3,
    'arena-novi-sad': { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 1, showtimeCount: 1, stale: false },
    'cineplexx-novi-sad': { ok: true, fetchedAt: '2026-08-19T10:00:00.000Z', movieCount: 1, showtimeCount: 1, stale: false },
    'cinestar-novi-sad': {
      ok: true,
      fetchedAt: '2026-08-19T08:00:00.000Z',
      movieCount: 1,
      showtimeCount: 1,
      stale: true,
      error: 'timeout',
    },
  },
  cities: CITIES,
  diagnostics: { tmdbResolved: 2, tmdbUnresolved: 0, unresolvedTitles: [], unknownAudioShowtimes: 0 },
};

test('escapes user-visible strings', () => {
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

test('offers every city, with the default one selected', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  for (const city of CITIES) {
    assert.ok(today.includes(`data-city="${city.id}"`), `missing ${city.id}`);
    assert.ok(today.includes(`?grad=${city.slug}`), `missing link for ${city.slug}`);
  }
  assert.ok(today.includes('citytab citytab--active'));
});

// Without JS the page must be a correct single-city page: a superset is fine
// for the audio filter but plainly wrong for city.
test('only the default city is visible before JS runs', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  const blocks = today.match(/<div class="cinema"[^>]*>/g) ?? [];
  assert.ok(blocks.length >= 4, `expected blocks from both cities, got ${blocks.length}`);

  for (const block of blocks) {
    const isDefault = block.includes(`data-city="${DEFAULT_CITY}"`);
    assert.equal(
      block.includes('hidden'),
      !isDefault,
      `wrong initial visibility: ${block}`,
    );
  }
});

test('a film playing only in another city starts hidden', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  const card = today.slice(0, today.indexOf('Samo u Beogradu'));
  const openTag = card.slice(card.lastIndexOf('<article'));
  assert.ok(openTag.includes('data-cities="beograd"'));
  assert.ok(openTag.includes('hidden'));
});

test('counts describe the visible city, not the whole payload', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  // Novi Sad has one film with two showtimes; Beograd's are excluded.
  assert.ok(
    today.includes('data-total-movies="1"'),
    today.match(/data-total-movies="\d+"/)?.[0] ?? 'no data-total-movies attribute rendered',
  );
  assert.ok(today.includes('data-total-showtimes="2"'));
});

test('stale-source warnings are scoped to their city', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes(`<div class="notice notice--stale" data-city="${DEFAULT_CITY}">`));
});

test('renders one page per day per language, with today as index.html', () => {
  const pages = renderPages(snapshot);
  // Serbian is the default and stays at the root; English is a parallel tree.
  assert.deepEqual(
    [...pages.keys()],
    ['index.html', '2026-08-20.html', 'en/index.html', 'en/2026-08-20.html'],
  );
});

test('shows only the films playing on that day', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('Vajana'));
  assert.ok(!today.includes('Zli mrtvi'));
});

test('cinema names carry their location', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('Arena Centar'));
  assert.ok(today.includes('CineStar BIG'));
  assert.ok(renderDayPage(snapshot, '2026-08-20').includes('Cineplexx Promenada'));
});

test('emits the attributes the filters rely on', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('data-kid-friendly="1"'));
  assert.ok(today.includes('data-min-age="0"'));
  assert.ok(today.includes('data-audio="dubbed"'));
  assert.ok(today.includes('data-audio="subtitled"'));
  assert.ok(today.includes('id="filter-kids"'));
});

test('the audio filter is one radio group with an unfiltered default', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('id="audio-all"'));
  assert.ok(today.includes('id="audio-dubbed"'));
  assert.ok(today.includes('id="audio-subtitled"'));
  // One name for all three is what makes the three states mutually exclusive
  // without any JS, so a checkbox pair can never re-appear by accident.
  assert.equal(today.match(/name="audio"/g)?.length, 3);
  assert.ok(today.includes('<input type="radio" name="audio" id="audio-all" value="" checked>'));
  // The old boolean contract is gone: no checkbox, and no ?dubbed=1 to read.
  assert.ok(!today.includes('id="filter-dubbed"'));
});

test('renders data-audio for original and unknown, which the subtitled mode keeps', () => {
  // "Bez sinhronizacije" hides only `dubbed`, so these two values have to reach
  // the DOM for the client to have anything left to show.
  const mixed: Snapshot = {
    ...snapshot,
    movies: snapshot.movies.map((movie, index) =>
      index === 0
        ? {
            ...movie,
            showtimes: movie.showtimes.map((showtime, i) =>
              i === 0
                ? { ...showtime, audio: 'original' as const }
                : i === 1
                  ? { ...showtime, audio: 'unknown' as const }
                  : showtime,
            ),
          }
        : movie,
    ),
  };
  const today = renderDayPage(mixed, '2026-08-19');
  assert.ok(today.includes('data-audio="original"'));
  assert.ok(today.includes('data-audio="unknown"'));
  // Audio drives the filter, never the chip's colour (R-8.3a).
  assert.ok(!/class="showtime showtime--/.test(today));
});

test('emits a search box and a folded data-search haystack before the listing', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('id="movie-search"'));
  // The box must appear before the movie listing so it reads as a filter for
  // it, not an unrelated control elsewhere on the page.
  assert.ok(today.indexOf('id="movie-search"') < today.indexOf('id="movies"'));
  // Folded lowercase, and covering both the local and the original title, so
  // typing either "Vajana" or "Moana" matches the same card.
  assert.ok(today.includes('data-search="vajana moana 2"'));
});

test('escapes titles coming from the cinemas', () => {
  const page = renderDayPage(snapshot, '2026-08-20');
  assert.ok(!page.includes('<script>'));
  assert.ok(page.includes('&lt;script&gt;'));
});

test('emits what the past-showtime filter needs to work', () => {
  const today = renderDayPage(snapshot, '2026-08-19');

  // The filter runs in the browser, so the page must state its own date and
  // each showtime's start time; without both it cannot tell "today" apart from
  // a day the reader is browsing ahead to.
  assert.ok(today.includes('data-date="2026-08-19"'));
  // Every chip must carry its start time; one without would silently survive
  // the cutoff.
  const chips = today.match(/class="showtime"/g) ?? [];
  const times = today.match(/data-time="\d{2}:\d{2}"/g) ?? [];
  assert.ok(chips.length > 0);
  assert.equal(times.length, chips.length);

  // The end-of-day message ships hidden and is revealed only by the script.
  assert.match(today, /id="empty-past"[^>]*hidden/);
  assert.ok(today.includes('data-daylink'));
  // With a grace period the page no longer empties the moment the last film
  // starts, so the message must not claim that everything has already begun.
  assert.ok(today.includes('Za danas više nema projekcija.'));
  assert.ok(!today.includes('već počele'));
  // The label for a started-but-still-listed chip is markup, not JS copy.
  assert.ok(today.includes('data-started-label="već počelo"'));
});

test('warns about stale sources', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('nisu ažurni'));
  assert.ok(today.includes('CineStar BIG'));
});

test('the English page translates the chrome and declares its own locale', () => {
  const en = renderDayPage(snapshot, '2026-08-19', '', 'en');
  assert.ok(en.includes('<html lang="en">'));
  assert.ok(en.includes('<meta property="og:locale" content="en_US">'));
  assert.ok(en.includes('For kids'));
  assert.ok(en.includes('Not dubbed'));
  assert.ok(en.includes('Search films…'));
  assert.ok(en.includes('data-started-label="already started"'));
  assert.ok(en.includes('Data for some cinemas may be out of date:'));
  // No Serbian chrome should survive into the English tree.
  assert.ok(!en.includes('Za decu'));
  assert.ok(!en.includes('Pretraga filmova'));
  assert.ok(!en.includes('Poslednje osvežavanje'));
});

test('English pages reach the shared root assets one level up', () => {
  // style.css, app.js and sw.js are single-copy at the root (R-19.4), so an
  // /en/ page asking for a bare "assets/…" or "sw.js" would 404.
  const en = renderDayPage(snapshot, '2026-08-19', 'abc123', 'en');
  assert.ok(en.includes('href="../assets/style.css"'));
  assert.ok(en.includes('src="../assets/app.js"'));
  assert.ok(en.includes('<meta name="sw-path" content="../sw.js">'));
  assert.ok(en.includes('href="../assets/icon-192.png"'));
  // The manifest is the one per-language file, so it stays tree-relative.
  assert.ok(en.includes('href="manifest.webmanifest"'));

  const sr = renderDayPage(snapshot, '2026-08-19', 'abc123');
  assert.ok(sr.includes('href="assets/style.css"'));
  assert.ok(sr.includes('<meta name="sw-path" content="sw.js">'));
});

test('both trees cross-link with hreflang and name Serbian as x-default', () => {
  for (const page of [
    renderDayPage(snapshot, '2026-08-19'),
    renderDayPage(snapshot, '2026-08-19', '', 'en'),
  ]) {
    assert.ok(page.includes(`<link rel="alternate" hreflang="sr-Latn-RS" href="${BASE_URL}/">`));
    assert.ok(page.includes(`<link rel="alternate" hreflang="en" href="${BASE_URL}/en/">`));
    assert.ok(page.includes(`<link rel="alternate" hreflang="x-default" href="${BASE_URL}/">`));
  }
});

test('each page canonicalises to its own language tree', () => {
  assert.ok(renderDayPage(snapshot, '2026-08-19').includes(`<link rel="canonical" href="${BASE_URL}/">`));
  assert.ok(
    renderDayPage(snapshot, '2026-08-19', '', 'en').includes(
      `<link rel="canonical" href="${BASE_URL}/en/">`,
    ),
  );
  assert.ok(
    renderDayPage(snapshot, '2026-08-20', '', 'en').includes(
      `<link rel="canonical" href="${BASE_URL}/en/2026-08-20.html">`,
    ),
  );
});

test('the language switcher navigates and never self-links to index.html', () => {
  const sr = renderDayPage(snapshot, '2026-08-19');
  assert.ok(sr.includes('<span class="langtab langtab--active" aria-current="page">SR</span>'));
  assert.ok(sr.includes('href="en/"'));

  const en = renderDayPage(snapshot, '2026-08-19', '', 'en');
  assert.ok(en.includes('<span class="langtab langtab--active" aria-current="page">EN</span>'));
  // Climbs out of /en/ back to the Serbian root.
  assert.ok(en.includes('href="../"'));
  assert.ok(renderDayPage(snapshot, '2026-08-20', '', 'en').includes('href="../2026-08-20.html"'));
});

test('the client gets its plural forms from the page, not from app.js', () => {
  const sr = renderDayPage(snapshot, '2026-08-19');
  assert.ok(sr.includes('data-plural-rule="sr"'));
  // Three forms for Serbian, two for English - the count of `|` is the rule.
  assert.ok(sr.includes('data-plural-movies="{n} film|{n} filma|{n} filmova"'));

  const en = renderDayPage(snapshot, '2026-08-19', '', 'en');
  assert.ok(en.includes('data-plural-rule="en"'));
  assert.ok(en.includes('data-plural-movies="{n} film|{n} films"'));
});

test('the sitemap lists both trees with alternates', () => {
  const sitemap = renderSitemap(snapshot);
  assert.ok(sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  assert.ok(sitemap.includes(`<loc>${BASE_URL}/</loc>`));
  assert.ok(sitemap.includes(`<loc>${BASE_URL}/en/</loc>`));
  assert.ok(sitemap.includes(`<loc>${BASE_URL}/en/2026-08-20.html</loc>`));
  assert.ok(sitemap.includes('hreflang="x-default"'));
  // One <url> per day per language.
  assert.equal(sitemap.match(/<url>/g)?.length, snapshot.days.length * 2);
});

test('every page a day page links to is one the build actually writes', () => {
  const pages = renderPages(snapshot, 'v1');
  for (const [name, html] of pages) {
    const dir = name.includes('/') ? `${name.slice(0, name.lastIndexOf('/'))}/` : '';
    for (const href of html.matchAll(/href="([^":#?]+\.html)"/g)) {
      const resolved = new URL(href[1]!, `https://x/${dir}`).pathname.slice(1);
      assert.ok(pages.has(resolved), `${name} links to missing page ${href[1]}`);
    }
  }
});

test('an unrated film is not marked kid friendly', () => {
  const page = renderDayPage(snapshot, '2026-08-20');
  assert.ok(page.includes('data-kid-friendly="0"'));
  assert.ok(page.includes('Uzrast nepoznat'));
});

test('shows the original title in brackets next to the local one', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('Vajana <span class="movie__original">(Moana 2)</span>'));
});

test('shows the audience score', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('★ 7,3'));
  assert.ok(today.includes('/10 TMDb'));
  assert.ok(today.includes('https://example.test/tmdb/1'));
});

test('colour-codes the audience score', () => {
  assert.equal(scoreBucket(4.9), 'bad');
  assert.equal(scoreBucket(5.0), 'mixed');
  assert.equal(scoreBucket(7.4), 'mixed');
  assert.equal(scoreBucket(7.5), 'good');

  // Fixture score is 7.25, which lands in the amber "mixed" band.
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('badge--score-mixed'));
});

test('pairs each format with its audio version', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('2D · sinhronizovano'));
  assert.ok(today.includes('3D · titlovano'));
  // Showtime chips use the short form so they stay narrow on phones. The
  // format is its own span so a premium screen can be accented on its own.
  assert.ok(today.includes('<span class="showtime__format">2D</span> · sinh.'));
  assert.ok(today.includes('<span class="showtime__format">3D</span> · titl.'));
});

test('marks a premium screen on the chip and on the card badge', () => {
  const premium = structuredClone(snapshot);
  premium.movies.find((movie) => movie.key === 'tmdb:3')!.showtimes[0]!.format = 'IMAX 3D';

  const today = renderDayPage(premium, '2026-08-19');
  assert.ok(today.includes('class="showtime showtime--premium"'));
  assert.ok(today.includes('data-format="IMAX 3D"'));
  assert.ok(today.includes('badge--premium'));
  // The accent is opt-in: an ordinary chip keeps the bare class.
  assert.ok(today.includes('class="showtime"'));
  // Started-ness is only knowable in the browser, so the server still ships a
  // real link and app.js takes the href away (R-7c.2b).
  assert.ok(!today.includes('data-started="1"'));
  assert.match(today, /<a class="showtime showtime--premium"\s+href="https:\/\//);
});

test('colour-codes the running time', () => {
  assert.equal(runtimeBucket(89), 'short');
  assert.equal(runtimeBucket(90), 'medium');
  assert.equal(runtimeBucket(119), 'medium');
  assert.equal(runtimeBucket(120), 'long');
  assert.equal(runtimeBucket(185), 'long');

  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('badge--runtime-medium'));
  assert.ok(today.includes('1 h 40 min'));
});

test('is installable as an app', () => {  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes('rel="manifest" href="manifest.webmanifest"'));
  assert.ok(today.includes('id="install-button"'));
  assert.ok(today.includes('Dodaj na početni ekran'));
  assert.ok(today.includes('apple-touch-icon'));
});

// Regression: GitHub Pages serves sw.js with a multi-hour Cache-Control, so a
// browser can keep re-installing the *previous* worker straight from its own
// HTTP cache without ever fetching the new bytes — only "clear site data"
// forced an update (R-9.7b). The page must carry the same build-time asset
// hash used for the service worker's own cache key, so app.js can tag the
// registration URL with it and always reach the network on a real change.
test('the page carries the service worker version for cache-busting registration', () => {
  const withVersion = renderDayPage(snapshot, '2026-08-19', 'abc123def456');
  assert.ok(withVersion.includes('<meta name="sw-version" content="abc123def456">'));

  const withoutVersion = renderDayPage(snapshot, '2026-08-19');
  assert.ok(!withoutVersion.includes('sw-version'));
});

test('no Cyrillic reaches the rendered page', () => {
  // The site is Latin-only. escapeHtml is the single choke point every string
  // passes through, so converting there makes this structural rather than a
  // rule each call site must remember.
  const cyrillic: Snapshot = {
    ...snapshot,
    movies: [
      {
        ...snapshot.movies[0]!,
        title: 'Спајдермен: Нови дан',
        genres: ['Научна фантастика', 'Хорор'],
        aliases: ['Спајдермен'],
      },
    ],
  };
  const html = renderDayPage(cyrillic, '2026-08-19');
  assert.doesNotMatch(html, /[\u0400-\u04FF]/, 'page must contain no Cyrillic');
  assert.match(html, /Spajdermen: Novi dan/);
  assert.match(html, /Naučna fantastika/);
  // The search haystack folds Cyrillic to plain lowercase Latin too, so a
  // reader who types with a Latin keyboard still matches the Cyrillic title.
  assert.ok(html.includes('data-search="spajdermen: novi dan moana 2"'));
});

test('escapeHtml converts Cyrillic while still escaping markup', () => {
  assert.equal(escapeHtml('Хорор & <b>'), 'Horor &amp; &lt;b&gt;');
});

test('safeUrl passes ordinary links through and drops script schemes', () => {
  assert.equal(safeUrl('https://example.test/x?a=1'), 'https://example.test/x?a=1');
  assert.equal(safeUrl('assets/style.css'), 'assets/style.css');
  assert.equal(safeUrl('/film/12'), '/film/12');
  assert.equal(safeUrl('mailto:a@example.test'), 'mailto:a@example.test');

  // Escaping alone never removes these: they contain no HTML metacharacter.
  assert.equal(safeUrl('javascript:alert(1)'), undefined);
  assert.equal(safeUrl('  JaVaScRiPt:alert(1)'), undefined);
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), undefined);
  assert.equal(safeUrl('vbscript:msgbox(1)'), undefined);
  assert.equal(safeUrl('//evil.test/x'), undefined);
  assert.equal(safeUrl('   '), undefined);
});

test('a tab or newline hidden inside the scheme does not smuggle a script URL past safeUrl', () => {
  // A URL parser strips these before reading the scheme, so a naive regex
  // check that only looks at the raw string can be walked straight past.
  assert.equal(safeUrl('jav\tascript:alert(1)'), undefined);
  assert.equal(safeUrl('jav\nascript:alert(1)'), undefined);
  assert.equal(safeUrl('jav\rascript:alert(1)'), undefined);
  // Same trick against the protocol-relative-URL check.
  assert.equal(safeUrl('/\t/evil.test/phish'), undefined);
});

test('a poisoned booking URL falls back to the venue instead of shipping a script link', () => {
  // A cinema site we do not control supplies every booking URL, so this is the
  // realistic shape of the attack: valid HTML, hostile scheme.
  const poisoned = structuredClone(snapshot);
  poisoned.movies[0]!.showtimes[0]!.bookingUrl = 'javascript:alert(document.domain)';
  poisoned.movies[0]!.posterUrl = 'javascript:alert(2)';

  const page = renderDayPage(poisoned, '2026-08-19');
  assert.ok(!page.includes('javascript:'), 'no javascript: URL may reach the page');
  // The chip still points somewhere useful rather than vanishing.
  assert.ok(page.includes('href="https://cinestarcinemas.rs/novi-sad-big"'));
});

test('the page carries a CSP that forbids inline script', () => {
  const page = renderDayPage(snapshot, '2026-08-19');
  assert.ok(page.includes('http-equiv="Content-Security-Policy"'));
  assert.ok(page.includes("default-src 'none'"));
  assert.ok(!page.includes("'unsafe-inline'"));
  assert.ok(!page.includes("'unsafe-eval'"));
  // The CSP is worthless if the page grows an inline script or style — except
  // the JSON-LD block, which is allowed by exact-content hash rather than
  // 'unsafe-inline' (see the next test).
  assert.ok(
    !/<script(?![^>]*\ssrc=)(?![^>]*application\/ld\+json)/.test(page),
    'inline <script> would be blocked by the CSP unless it is the hashed JSON-LD block',
  );
  assert.ok(!/\sstyle="/.test(page), 'inline style= would be blocked by the CSP');
});

test('the CSP hash matches the actual JSON-LD script content', () => {
  // If these ever drift apart, the browser silently drops the structured
  // data instead of throwing, so this is the only thing that would catch it.
  const page = renderDayPage(snapshot, '2026-08-19');
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)?.[1];
  assert.ok(script, 'a JSON-LD script block must be present');
  const expectedHash = createHash('sha256').update(script!, 'utf8').digest('base64');
  assert.ok(
    page.includes(`'sha256-${expectedHash}'`),
    'script-src must carry the hash of the exact rendered JSON-LD content',
  );
});

test('the CSP keeps allowing the edge-injected analytics beacon', () => {
  // Cloudflare injects beacon.min.js into the HTML at its edge, so nothing in
  // this repository references these hosts and the allowances read as dead
  // config. Removing them does not break a test elsewhere or fail the build —
  // it just leaves Web Analytics enabled in the dashboard and counting nothing,
  // because default-src 'none' blocks the injected script. Hence this test.
  const page = renderDayPage(snapshot, '2026-08-19');
  const csp = /content="([^"]*Content-Security|[^"]*default-src[^"]*)"/.exec(page)?.[1] ?? page;
  assert.ok(
    /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/.test(csp),
    'script-src must allow static.cloudflareinsights.com or the edge-injected beacon is blocked',
  );
  assert.ok(
    /connect-src[^;]*https:\/\/cloudflareinsights\.com/.test(csp),
    'connect-src must allow cloudflareinsights.com or the beacon cannot report the page view',
  );
});

test('no analytics beacon is built into the page', () => {
  // The beacon is the edge's job now. A tag here as well would double-count
  // every visit.
  const page = renderDayPage(snapshot, '2026-08-19');
  assert.ok(!page.includes('beacon.min.js'), 'the beacon must come from the edge, not the build');
  assert.ok(!page.includes('data-cf-beacon'));
});

test('every page declares its own canonical URL under the live domain', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  assert.ok(today.includes(`<link rel="canonical" href="${BASE_URL}/">`));

  const tomorrow = renderDayPage(snapshot, '2026-08-20');
  assert.ok(tomorrow.includes(`<link rel="canonical" href="${BASE_URL}/2026-08-20.html">`));
});

test('titles are unique per day and carry the target keywords', () => {
  const today = renderDayPage(snapshot, '2026-08-19');
  const tomorrow = renderDayPage(snapshot, '2026-08-20');
  const todayTitle = /<title>([^<]*)<\/title>/.exec(today)?.[1];
  const tomorrowTitle = /<title>([^<]*)<\/title>/.exec(tomorrow)?.[1];
  assert.ok(todayTitle?.includes('Repertoar bioskopa za Novi Sad i Beograd'));
  assert.notEqual(todayTitle, tomorrowTitle, 'each day page needs its own title');
});

test('emits Open Graph and Twitter Card tags with absolute image URLs', () => {
  const page = renderDayPage(snapshot, '2026-08-19');
  assert.ok(page.includes('property="og:title"'));
  assert.ok(page.includes('property="og:description"'));
  assert.ok(page.includes(`property="og:url" content="${BASE_URL}/"`));
  assert.ok(page.includes(`property="og:image" content="${BASE_URL}/assets/icon-512.png"`));
  assert.ok(page.includes('name="twitter:card" content="summary"'));
});

test('poster images carry the film title as alt text', () => {
  const withPoster = structuredClone(snapshot);
  withPoster.movies[0]!.posterUrl = 'https://example.test/poster.jpg';
  const page = renderDayPage(withPoster, '2026-08-19');
  assert.ok(page.includes('alt="Vajana — plakat"'));
});

test('JSON-LD structured data lists screenings for the default city only', () => {
  const page = renderDayPage(snapshot, '2026-08-19');
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)?.[1];
  assert.ok(script);
  const parsed = JSON.parse(script!);
  assert.equal(parsed['@context'], 'https://schema.org');
  const names = parsed['@graph'].map((event: { name: string }) => event.name);
  // "Vajana" plays in both cities on 2026-08-19; "Samo u Beogradu" plays only
  // in Beograd, which is not the default city, so it must be absent.
  assert.ok(names.includes('Vajana'));
  assert.ok(!names.includes('Samo u Beogradu'));
  for (const event of parsed['@graph']) {
    assert.equal(event['@type'], 'ScreeningEvent');
    assert.equal(event.workPresented['@type'], 'Movie');
  }
});

test('renderSitemap lists an absolute, canonical URL for every day', () => {
  const xml = renderSitemap(snapshot);
  assert.ok(xml.includes(`<loc>${BASE_URL}/</loc>`));
  assert.ok(xml.includes(`<loc>${BASE_URL}/2026-08-20.html</loc>`));
});

test('renderRobots allows everything and points at the sitemap', () => {
  const robots = renderRobots();
  assert.ok(robots.includes('Allow: /'));
  assert.ok(robots.includes(`Sitemap: ${BASE_URL}/sitemap.xml`));
});
