import { createHash } from 'node:crypto';

import { formatDayLabel, formatDayShort, formatTimestamp } from '../core/dates.js';
import { DEFAULT_LANG, LANGS, LOCALES, STRINGS, otherLang, translateGenre } from '../core/i18n.js';
import type { Lang, Strings } from '../core/i18n.js';
import { trailerLink } from '../core/trailer.js';
import { isPremiumFormat, toSerbianLatin, transliterate } from '../core/titles.js';
import { CINEMAS, CITIES, DEFAULT_CITY, cityById } from '../core/types.js';
import type { Movie, Showtime, Snapshot } from '../core/types.js';

/**
 * The site's one and only domain since the migration off the GitHub Pages
 * subdomain. Every absolute URL on the page (canonical, Open Graph, sitemap,
 * robots.txt) is built from this single constant, so a future domain change
 * is a one-line edit rather than a search-and-replace.
 */
export const BASE_URL = 'https://kokice.org';

/**
 * Escapes for HTML, and converts any Serbian Cyrillic to Latin on the way out.
 *
 * The site is Latin-only, and this is the single choke point every piece of
 * text passes through, so enforcing it here makes the guarantee structural
 * rather than a rule each call site has to remember. TMDb is already converted
 * at its own boundary (see `tmdb/client.ts`); this catches anything a cinema
 * or a future source might introduce. It is a no-op on Latin input.
 */
export function escapeHtml(value: string): string {
  return toSerbianLatin(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Content Security Policy for every rendered page. Defence in depth behind
 * `escapeHtml`/{@link safeUrl}, not instead of them: this page is assembled
 * from three cinema sites plus TMDb, so if an escaping gap ever slips through,
 * the CSP is what stops it becoming script execution.
 *
 * It can be this strict because the page has no inline script and no inline
 * style except the JSON-LD block below, which is allowed by exact-content
 * hash rather than `'unsafe-inline'`. `img-src https:` stays deliberately
 * broad, since posters arrive from several CDNs, but it still refuses
 * `javascript:` and `data:` script vectors. `frame-ancestors` is omitted
 * because a meta-tag CSP ignores it; that one needs a real response header,
 * which GitHub Pages does not let us set.
 *
 * DO NOT REMOVE THE `cloudflareinsights.com` ENTRIES. Nothing in this
 * repository references those hosts any more, so they look like dead
 * allowances — they are not. Cloudflare injects the Web Analytics beacon into
 * the HTML at the edge, which needs `script-src` for `beacon.min.js` and
 * `connect-src` for the page-view it reports. Dropping them leaves analytics
 * switched on in the dashboard and silently counting nothing. `html.test.ts`
 * pins this.
 *
 * Built per page rather than as a constant: the inline JSON-LD block (see
 * {@link buildStructuredData}) needs its own `sha256-` source to be allowed
 * under `script-src`, since a CSP with no `'unsafe-inline'` blocks *any*
 * inline `<script>` — including `type="application/ld+json"`, which does
 * not execute but is still a script element as far as CSP enforcement is
 * concerned. The hash is exact-content, so it changes every hour with the
 * data and cannot be reused to smuggle in anything else.
 */
function buildCsp(jsonLdHash: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'sha256-${jsonLdHash}' https://static.cloudflareinsights.com`,
    "connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com",
    "style-src 'self'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function pageName(date: string, days: string[]): string {
  return date === days[0] ? 'index.html' : `${date}.html`;
}

/**
 * Absolute, canonical URL for a day page. `index.html` collapses to the bare
 * origin — the two must never both be indexable, or Search Console reports
 * them as duplicate content competing against each other.
 *
 * The language prefix lives here rather than at the call sites, so `/en/` and
 * `/en/index.html` collapse the same way `/` and `/index.html` do.
 */
function pageUrl(date: string, days: string[], lang: Lang = DEFAULT_LANG): string {
  const prefix = LOCALES[lang].pathPrefix;
  const name = pageName(date, days);
  return name === 'index.html' ? `${BASE_URL}/${prefix}` : `${BASE_URL}/${prefix}${name}`;
}

/**
 * Europe/Belgrade only ever runs at UTC+1 (CET) or UTC+2 (CEST), so the
 * offset can be read straight off `Intl` for the specific date/time rather
 * than hand-rolling DST rules that would drift the moment the EU changes
 * them.
 */
function belgradeOffset(date: string, time: string): string {
  const instant = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Belgrade',
    timeZoneName: 'shortOffset',
  }).formatToParts(instant);
  const zone = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+1';
  const hours = Number(/GMT([+-]\d+)/.exec(zone)?.[1] ?? 1);
  return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

/**
 * JSON-LD `ScreeningEvent` list for the films actually visible on first
 * paint (the default city, this date) — matching the structured data to the
 * visible content is what keeps it honest rather than a bait-and-switch for
 * crawlers. Each event embeds its own `Movie` under `workPresented`, which
 * is the shape schema.org's own `ScreeningEvent` examples use.
 *
 * Returned as a compact JSON string with every `<` escaped: the page embeds
 * this inside a `<script>` element, and a cinema-supplied title containing
 * `</script>` must not be able to end the element early.
 */
function buildStructuredData(snapshot: Snapshot, date: string): string {
  const defaultCinemas = new Set<string>(cityById(DEFAULT_CITY).cinemaIds);

  const events = snapshot.movies.flatMap((movie) => {
    const showtimesToday = movie.showtimes.filter(
      (showtime) => showtime.date === date && defaultCinemas.has(showtime.cinemaId),
    );
    if (showtimesToday.length === 0) return [];

    const movieObject: Record<string, unknown> = {
      '@type': 'Movie',
      name: toSerbianLatin(movie.title),
    };
    if (movie.originalTitle) movieObject.alternateName = toSerbianLatin(movie.originalTitle);
    const poster = movie.posterUrl ? isSafeUrl(movie.posterUrl) : undefined;
    if (poster) movieObject.image = poster;
    if (movie.genres.length) movieObject.genre = movie.genres.map(toSerbianLatin);
    if (movie.runtimeMinutes) movieObject.duration = `PT${movie.runtimeMinutes}M`;
    if (movie.score) {
      movieObject.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: movie.score.value,
        ratingCount: movie.score.votes,
        bestRating: 10,
        worstRating: 0,
      };
    }

    return showtimesToday.map((showtime) => {
      const cinema = CINEMAS[showtime.cinemaId];
      const eventUrl = isSafeUrl(showtime.bookingUrl) ?? isSafeUrl(cinema.url);
      const event: Record<string, unknown> = {
        '@type': 'ScreeningEvent',
        name: toSerbianLatin(movie.title),
        startDate: `${showtime.date}T${showtime.time}:00${belgradeOffset(
          showtime.date,
          showtime.time,
        )}`,
        location: {
          '@type': 'MovieTheater',
          name: toSerbianLatin(cinema.name),
          url: isSafeUrl(cinema.url),
        },
        workPresented: movieObject,
      };
      if (eventUrl) event.url = eventUrl;
      return event;
    });
  });

  const graph = { '@context': 'https://schema.org', '@graph': events };
  return JSON.stringify(graph).replace(/</g, '\\u003C');
}


/**
 * Escaping alone does not make a URL safe to put in an `href` or `src`:
 * `javascript:alert(1)` contains no character `escapeHtml` touches, so it
 * survives intact and runs on click. Every URL on this page — booking links,
 * cinema sites, posters, trailers, score links — comes from a third party we
 * do not control, and Arena in particular is fetched over plaintext HTTP.
 *
 * So schemes are allow-listed rather than denied: only `http`, `https` and
 * `mailto` reach the document, and anything else (including protocol-relative
 * `//evil.test` and `data:`) is dropped. Relative URLs are kept, since the
 * page's own assets are relative.
 *
 * `isSafeUrl` does the validation and returns the raw (trimmed) value;
 * `safeUrl` wraps it with HTML-escaping for use in attributes. Contexts
 * that are not HTML attributes — the JSON-LD block, in particular — must use
 * `isSafeUrl` directly, or `&` would come out as the literal text `&amp;`
 * inside a `<script>` element's raw, non-HTML-entity-decoded text.
 */
/**
 * A URL parser strips tab, LF and CR from anywhere in the string before
 * looking at the scheme — that's WHATWG URL Standard behaviour, not a bug —
 * so `"jav\tascript:alert(1)"` still runs on click even though it never
 * matches a scheme regex applied to the raw string. Stripping the same three
 * characters first means the checks below see exactly what a browser will
 * actually navigate to.
 */
const URL_STRIP_CHARS = /[\t\n\r]/g;

function isSafeUrl(value: string): string | undefined {
  const trimmed = value.trim().replace(URL_STRIP_CHARS, '');
  if (!trimmed) return undefined;
  if (/^\/\//.test(trimmed)) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return undefined;
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return undefined;
  }
  return trimmed;
}

export function safeUrl(value: string): string | undefined {
  const trimmed = isSafeUrl(value);
  return trimmed === undefined ? undefined : escapeHtml(trimmed);
}

function audioLabel(audio: Showtime['audio'], t: Strings): string {
  switch (audio) {
    case 'dubbed':
      return t.audioLabelDubbed;
    case 'subtitled':
      return t.audioLabelSubtitled;
    case 'original':
      return t.audioLabelOriginal;
    default:
      return t.audioLabelUnknown;
  }
}

/** Short form used on the compact showtime chips. */
function audioShort(audio: Showtime['audio'], t: Strings): string {
  switch (audio) {
    case 'dubbed':
      return t.audioShortDubbed;
    case 'subtitled':
      return t.audioShortSubtitled;
    case 'original':
      return t.audioShortOriginal;
    default:
      return t.audioShortUnknown;
  }
}

function renderShowtime(showtime: Showtime, t: Strings): string {
  const cinema = CINEMAS[showtime.cinemaId];
  const details = [showtime.format, audioLabel(showtime.audio, t)];
  if (showtime.hall) details.push(showtime.hall);

  // A booking URL that is not a plain web link is not shown as one; the venue's
  // own programme is the sanctioned fallback (§8.1a), and it comes from our
  // static registry rather than from a scrape.
  const href = safeUrl(showtime.bookingUrl) ?? safeUrl(cinema.url) ?? '#';
  const premium = isPremiumFormat(showtime.format) ? ' showtime--premium' : '';

  return `
        <a class="showtime${premium}"
           href="${href}"
           rel="noopener nofollow"
           target="_blank"
           data-audio="${showtime.audio}"
           data-format="${escapeHtml(showtime.format)}"
           data-time="${escapeHtml(showtime.time)}"
           title="${escapeHtml(`${cinema.name} · ${details.join(' · ')}`)}">
          <span class="showtime__time">${escapeHtml(showtime.time)}</span>
          <span class="showtime__meta"><span class="showtime__format">${escapeHtml(
            showtime.format,
          )}</span> · ${escapeHtml(audioShort(showtime.audio, t))}</span>
        </a>`;
}

function renderCinemaBlock(
  cinemaId: Movie['showtimes'][number]['cinemaId'],
  showtimes: Showtime[],
  t: Strings,
): string {
  const cinema = CINEMAS[cinemaId];
  // Pre-hidden for every city but the default. Without JS the page would
  // otherwise show Beograd's showtimes to a Novi Sad reader, which is worse
  // than showing too few: the audio filter degrades to a harmless superset,
  // but a mixed-city listing is simply wrong.
  const hidden = cinema.city === DEFAULT_CITY ? '' : ' hidden';
  return `
      <div class="cinema" data-cinema="${cinemaId}" data-city="${cinema.city}"${hidden}>
        <a class="cinema__name" href="${safeUrl(cinema.url) ?? '#'}" rel="noopener" target="_blank">${escapeHtml(
          cinema.shortName,
        )}</a>
        <div class="showtimes">${showtimes.map((showtime) => renderShowtime(showtime, t)).join('')}
        </div>
      </div>`;
}

function renderAgeBadge(movie: Movie, t: Strings): string {
  const rating = movie.ageRating;
  if (!rating) {
    return `<span class="badge badge--age badge--unknown" title="${escapeHtml(
      t.ageUnknownTitle,
    )}">${escapeHtml(t.ageUnknown)}</span>`;
  }
  const modifier = rating.minAge <= 12 ? 'kid' : rating.minAge >= 16 ? 'adult' : 'teen';
  const suffix = rating.confident ? '' : t.ageEstimateSuffix;
  const explanation = rating.confident ? t.ageOfficial(rating.source) : t.ageEstimate;
  return `<span class="badge badge--age badge--${modifier}${
    rating.confident ? '' : ' badge--estimate'
  }" title="${escapeHtml(explanation)}">${escapeHtml(rating.label)}${escapeHtml(suffix)}</span>`;
}

/** Same traffic-light idea as runtime: 7.5+ green, 5.0–7.5 amber, below 5.0 red. */
export function scoreBucket(value: number): 'good' | 'mixed' | 'bad' {
  if (value >= 7.5) return 'good';
  return value >= 5.0 ? 'mixed' : 'bad';
}

function renderScoreBadge(movie: Movie, t: Strings): string {
  const score = movie.score;
  if (!score) return '';
  const value = score.value.toFixed(1).replace('.', ',');
  const bucket = scoreBucket(score.value);
  const title = t.scoreTitle(score.source, score.votes);
  const scoreHref = score.url ? safeUrl(score.url) : undefined;
  // A wrapping <a> would be the flex item instead of the badge itself, leaving
  // the visible pill unstretched and a shade shorter than its siblings — so
  // the badge classes go on the link directly rather than on a nested span.
  const tag = scoreHref ? 'a' : 'span';
  const attrs = scoreHref
    ? `class="badge badge-link badge--score badge--score-${bucket}" href="${scoreHref}" rel="noopener nofollow" target="_blank"`
    : `class="badge badge--score badge--score-${bucket}"`;
  return `<${tag} ${attrs} title="${escapeHtml(title)}">★ ${escapeHtml(
    value,
  )}<span class="badge__sub">/10 ${escapeHtml(score.source)}</span></${tag}>`;
}

/**
 * Running time is the single thing people check before a weeknight screening,
 * so it gets a traffic-light badge: under 90 min green, up to 2 h amber,
 * 2 h and over red.
 */
export function runtimeBucket(minutes: number): 'short' | 'medium' | 'long' {
  if (minutes < 90) return 'short';
  return minutes < 120 ? 'medium' : 'long';
}

function formatRuntime(minutes: number, t: Strings): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? t.runtimeHours(hours, rest) : t.runtimeMinutes(minutes);
}

function renderRuntimeBadge(movie: Movie, t: Strings): string {
  const minutes = movie.runtimeMinutes;
  if (!minutes) return '';
  const bucket = runtimeBucket(minutes);
  const explanation = {
    short: t.runtimeShort,
    medium: t.runtimeMedium,
    long: t.runtimeLong,
  }[bucket];
  return `<span class="badge badge--runtime badge--runtime-${bucket}" title="${escapeHtml(
    explanation,
  )}">${escapeHtml(formatRuntime(minutes, t))}</span>`;
}

function renderMovie(movie: Movie, date: string, t: Strings, lang: Lang): string {
  const showtimes = movie.showtimes.filter((showtime) => showtime.date === date);
  if (showtimes.length === 0) return '';

  // TMDb's English localisation when there is one, otherwise the same text the
  // Serbian page shows — the build must still work with no API key at all.
  const title = (lang === 'en' && movie.titleEn) || movie.title;
  // Genres usually come from the cinemas rather than TMDb, so without the
  // English list they still need translating (R-19.5b). Deduped after
  // translating, not before: the cinemas spell one genre three ways
  // ("Akcija"/"Akcijski"/"Akcioni"), which collapse to a single "Action".
  const genres = [
    ...new Set(
      ((lang === 'en' && movie.genresEn) || movie.genres).map((genre) =>
        translateGenre(genre, lang),
      ),
    ),
  ];

  // Grouped city by city so a card's blocks read Novi Sad first, then Beograd,
  // rather than interleaving venues from both.
  const byCinema = CITIES.flatMap((city) => city.cinemaIds)
    .map((cinemaId) => ({
      cinemaId,
      showtimes: showtimes.filter((showtime) => showtime.cinemaId === cinemaId),
    }))
    .filter((entry) => entry.showtimes.length > 0);

  // Format and audio belong together: the same film runs 2D dubbed in the
  // afternoon and 3D subtitled at night, and that pairing is what people pick by.
  // Each variant remembers the cities it plays in, because a badge that outlives
  // its own showtimes is a false advertisement: Odiseja is IMAX in Beograd only,
  // and a Novi Sad reader was shown the IMAX pill above an all-2D chip list.
  const variantsByKey = new Map<
    string,
    { format: string; audio: Showtime['audio']; cities: Set<string> }
  >();
  for (const showtime of showtimes) {
    const key = `${showtime.format}|${showtime.audio}`;
    let variant = variantsByKey.get(key);
    if (!variant) {
      variant = { format: showtime.format, audio: showtime.audio, cities: new Set() };
      variantsByKey.set(key, variant);
    }
    variant.cities.add(CINEMAS[showtime.cinemaId].city);
  }
  const variants = [...variantsByKey.values()].sort(
    (a, b) => a.format.localeCompare(b.format) || a.audio.localeCompare(b.audio),
  );

  const hasDubbed = showtimes.some((showtime) => showtime.audio === 'dubbed');
  const minAge = movie.ageRating?.minAge ?? -1;

  // Which cities this film actually plays in today, so a card with nothing in
  // the active city starts hidden rather than empty.
  const cities = [...new Set(byCinema.map((entry) => CINEMAS[entry.cinemaId].city))];
  const hidden = cities.includes(DEFAULT_CITY) ? '' : ' hidden';

  // Folded to lowercase Latin ASCII with diacritics stripped, so the client
  // can match a plain-typed query against Serbian and English titles alike
  // without re-implementing transliteration — see core/titles.ts. Both display
  // titles are indexed on either tree, so searching "Vajana" still finds the
  // film on the English page.
  const searchText = [...new Set([movie.title, movie.titleEn, movie.originalTitle])]
    .filter((value): value is string => Boolean(value))
    .map((value) => transliterate(value).toLowerCase())
    .join(' ');

  const trailer = trailerLink(movie);
  const posterSrc = movie.posterUrl ? safeUrl(movie.posterUrl) : undefined;
  const posterImage = posterSrc
    ? `<img class="poster" src="${posterSrc}" alt="${escapeHtml(t.posterAlt(title))}" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="poster poster--empty" aria-hidden="true"></div>`;
  const trailerHref = safeUrl(trailer.url);
  // Wrapped rather than replaced, so a film with no poster is still clickable.
  const poster = trailerHref
    ? `<a class="poster-link" href="${trailerHref}"
       target="_blank" rel="noopener noreferrer"
       title="${escapeHtml(trailer.exact ? t.trailerExact : t.trailerSearch)}"
       aria-label="${escapeHtml(t.trailerAria(title))}"
    >${posterImage}<span class="poster-play" aria-hidden="true"></span></a>`
    : `<div class="poster-link">${posterImage}</div>`;

  const meta: string[] = [];
  if (genres.length) meta.push(genres.slice(0, 3).join(', '));

  return `
    <article class="movie"
             data-kid-friendly="${movie.kidFriendly ? '1' : '0'}"
             data-min-age="${minAge}"
             data-cities="${cities.join(' ')}"
             data-has-dubbed="${hasDubbed ? '1' : '0'}"
             data-rating-confident="${movie.ageRating?.confident ? '1' : '0'}"
             data-search="${escapeHtml(searchText)}"${hidden}>
      <div class="movie__poster">${poster}</div>
      <div class="movie__body">
        <h2 class="movie__title">${escapeHtml(title)}${
          movie.originalTitle && movie.originalTitle !== title
            ? ` <span class="movie__original">(${escapeHtml(movie.originalTitle)})</span>`
            : ''
        }</h2>
        <div class="badges">
          ${renderAgeBadge(movie, t)}
          ${renderRuntimeBadge(movie, t)}
          ${renderScoreBadge(movie, t)}
          ${variants
            .map(
              (variant) =>
                `<span class="badge badge--variant badge--${variant.audio}${
                  isPremiumFormat(variant.format) ? ' badge--premium' : ''
                }" data-variant data-format="${escapeHtml(
                  variant.format,
                )}" data-audio="${variant.audio}"${
                  variant.cities.has(DEFAULT_CITY) ? '' : ' hidden'
                }>${escapeHtml(variant.format)} · ${escapeHtml(
                  audioLabel(variant.audio, t),
                )}</span>`,
            )
            .join('\n          ')}
        </div>
        ${meta.length ? `<p class="movie__meta">${escapeHtml(meta.join(' · '))}</p>` : ''}
        <div class="cinemas">${byCinema
          .map((entry) => renderCinemaBlock(entry.cinemaId, entry.showtimes, t))
          .join('')}
        </div>
      </div>
    </article>`;
}

function renderDayNav(days: string[], active: string, lang: Lang): string {
  return days
    .map((date) => {
      const current = date === active;
      return `<a class="daytab${current ? ' daytab--active' : ''}" href="${pageName(
        date,
        days,
      )}"${current ? ' aria-current="page"' : ''}>${escapeHtml(
        formatDayShort(date, days[0], lang),
      )}</a>`;
    })
    .join('\n        ');
}

/**
 * One notice block per city, so a reader is only warned about the cinemas they
 * are actually looking at. All are rendered; JS reveals the active one.
 */
function renderSourceNotices(snapshot: Snapshot, lang: Lang, t: Strings): string {
  return CITIES.map((city) => {
    const problems = city.cinemaIds
      .map((id) => ({ id, status: snapshot.sources[id] }))
      .filter((entry) => entry.status && (!entry.status.ok || entry.status.stale));
    if (problems.length === 0) return '';

    const items = problems
      .map((entry) => {
        const cinema = CINEMAS[entry.id];
        const when = formatTimestamp(entry.status.fetchedAt, lang);
        const reason = entry.status.ok ? t.staleFromCache(when) : t.staleLastOk(when);
        return `<li><strong>${escapeHtml(cinema.name)}</strong> — ${escapeHtml(reason)}</li>`;
      })
      .join('\n          ');

    const hidden = city.id === DEFAULT_CITY ? '' : ' hidden';
    return `
      <div class="notice notice--stale" data-city="${city.id}"${hidden}>
        <p>${escapeHtml(t.staleIntro)}</p>
        <ul>
          ${items}
        </ul>
      </div>`;
  }).join('');
}

/**
 * Real links, so a chosen city is shareable and survives a reload. JS
 * intercepts them to switch without a round trip; the `noscript` note is there
 * because a static page genuinely cannot honour them on its own.
 */
function renderCityNav(t: Strings): string {
  const tabs = CITIES.map((city) => {
    const current = city.id === DEFAULT_CITY;
    return `<a class="citytab${current ? ' citytab--active' : ''}" href="?grad=${
      city.slug
    }" data-city="${city.id}"${current ? ' aria-current="page"' : ''}>${escapeHtml(
      city.name,
    )}</a>`;
  }).join('\n      ');

  return `
    <nav class="cities" id="cities" aria-label="${escapeHtml(t.cityNavLabel)}">
      ${tabs}
    </nav>
    <noscript><p class="subtitle">${escapeHtml(
      t.cityNoScript(cityById(DEFAULT_CITY).name),
    )}</p></noscript>`;
}

/** One venue list per city, since the cinemas differ between them. */
function renderCitySubtitles(): string {
  return CITIES.map((city) => {
    const names = city.cinemaIds.map((id) => CINEMAS[id].shortName).join(' · ');
    const hidden = city.id === DEFAULT_CITY ? '' : ' hidden';
    return `<p class="subtitle" data-city="${city.id}"${hidden}>${escapeHtml(names)}</p>`;
  }).join('\n    ');
}

/**
 * Where a page for `date` in this tree links to the same day in `to`.
 *
 * Relative rather than absolute so the local preview and the deployed site
 * behave identically. The source language's `assetPrefix` is what climbs out
 * of `/en/` first; the target's `pathPrefix` then descends into it.
 */
function langHref(date: string, days: string[], from: Lang, to: Lang): string {
  const name = pageName(date, days);
  const up = LOCALES[from].assetPrefix;
  const down = LOCALES[to].pathPrefix;
  return `${up}${down}${name === 'index.html' ? '' : name}` || './';
}

/**
 * Serbian and English are separate documents, so unlike the city tabs these
 * must really navigate — JS stores the choice but never intercepts the click.
 * The current language is a `<span>`, not a self-link, so the site never emits
 * a link to `index.html` competing with its own canonical `/`.
 */
function renderLangNav(date: string, days: string[], lang: Lang, t: Strings): string {
  const tabs = LANGS.map((code) => {
    const locale = LOCALES[code];
    if (code === lang) {
      return `<span class="langtab langtab--active" aria-current="page">${escapeHtml(
        locale.label,
      )}</span>`;
    }
    return `<a class="langtab" href="${escapeHtml(
      langHref(date, days, lang, code),
    )}" hreflang="${locale.hreflang}" data-lang="${code}" data-langlink>${escapeHtml(
      locale.label,
    )}</a>`;
  }).join('\n      ');

  return `
    <nav class="langs" id="langs" aria-label="${escapeHtml(t.langNavLabel)}">
      ${tabs}
    </nav>`;
}

export function renderDayPage(
  snapshot: Snapshot,
  date: string,
  swVersion = '',
  lang: Lang = DEFAULT_LANG,
): string {
  const t = STRINGS[lang];
  const locale = LOCALES[lang];
  // Assets and the service worker are single-copy at the site root (R-19.4),
  // so a page in the /en/ tree has to climb out of it to reach them.
  const asset = locale.assetPrefix;
  const days = snapshot.days;
  const moviesForDay = snapshot.movies.filter((movie) =>
    movie.showtimes.some((showtime) => showtime.date === date),
  );

  // Counts describe the city that is actually visible on first paint, not the
  // whole payload — otherwise a Novi Sad reader is told about Belgrade films.
  const defaultCinemas = new Set<string>(cityById(DEFAULT_CITY).cinemaIds);
  const showtimesToday = snapshot.movies
    .flatMap((movie) => movie.showtimes)
    .filter((showtime) => showtime.date === date && defaultCinemas.has(showtime.cinemaId));
  const showtimeCount = showtimesToday.length;
  const movieCount = moviesForDay.filter((movie) =>
    movie.showtimes.some(
      (showtime) => showtime.date === date && defaultCinemas.has(showtime.cinemaId),
    ),
  ).length;

  const cards = moviesForDay.map((movie) => renderMovie(movie, date, t, lang)).join('');

  const emptyHidden = movieCount === 0 ? '' : ' hidden';
  const emptyState = `<p class="empty" id="empty"${emptyHidden}>${escapeHtml(t.empty)}</p>`;

  // A second empty state, because "nothing found" and "the day is over" are
  // different facts and the second one has a useful next step. Only the client
  // knows which applies, since it depends on the current time.
  const tomorrow = days[days.indexOf(date) + 1];
  const tomorrowLink = tomorrow
    ? ` <a href="${escapeHtml(tomorrow)}.html" data-daylink>${escapeHtml(t.tomorrowLink)}</a>`
    : '';
  const pastState = `<p class="empty" id="empty-past" hidden>${escapeHtml(
    t.emptyPast,
  )}${tomorrowLink}</p>`;

  const dayLabel = formatDayLabel(date, days[0], lang);
  const canonicalUrl = pageUrl(date, days, lang);
  const pageTitle = `${t.siteTitle} | ${dayLabel}`;
  // Not "svakog sata": the cron asks for hourly but GitHub dispatches it 2-6
  // times a day, so the footer's real build time is the only exact claim (R-2.6).
  const description = t.metaDescription(dayLabel, movieCount, showtimeCount);
  const ogImage = `${BASE_URL}/assets/icon-512.png`;

  // Each tree points at the other and at itself, plus an x-default naming the
  // Serbian page as the one to serve a reader whose language we don't cover.
  const alternates = [
    ...LANGS.map(
      (code) =>
        `  <link rel="alternate" hreflang="${LOCALES[code].hreflang}" href="${pageUrl(
          date,
          days,
          code,
        )}">`,
    ),
    `  <link rel="alternate" hreflang="x-default" href="${pageUrl(date, days, DEFAULT_LANG)}">`,
  ].join('\n');

  const jsonLd = buildStructuredData(snapshot, date);
  const jsonLdHash = createHash('sha256').update(jsonLd, 'utf8').digest('base64');
  const csp = buildCsp(jsonLdHash);

  return `<!DOCTYPE html>
<html lang="${locale.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Kokice">
  <meta property="og:locale" content="${locale.ogLocale}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${ogImage}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${ogImage}">
${alternates}
  <link rel="stylesheet" href="${asset}assets/style.css">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#0f1115">${
    swVersion ? `\n  <meta name="sw-version" content="${escapeHtml(swVersion)}">` : ''
  }
  <meta name="sw-path" content="${asset}sw.js">
  <link rel="icon" href="${asset}assets/icon-192.png" sizes="192x192" type="image/png">
  <link rel="apple-touch-icon" href="${asset}assets/icon-180.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Kokice">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <header class="header">
    <div class="header__top">
      <h1>${escapeHtml(t.siteTitle)}</h1>
      ${renderLangNav(date, days, lang, t)}
    </div>
    ${renderCitySubtitles()}
    ${renderCityNav(t)}
  </header>

  <nav class="days" aria-label="${escapeHtml(t.dayNavLabel)}">
        ${renderDayNav(days, date, lang)}
  </nav>

  <main>
    <div class="toolbar">
      <h2 class="toolbar__day">${escapeHtml(dayLabel)}</h2>
      <form class="filters" id="filters">
        <div class="segmented" role="group" aria-label="${escapeHtml(t.audioGroupLabel)}">
          <label class="segmented__option">
            <input type="radio" name="audio" id="audio-all" value="" checked>
            <span>${escapeHtml(t.audioAll)}</span>
          </label>
          <label class="segmented__option">
            <input type="radio" name="audio" id="audio-dubbed" value="dubbed">
            <span>${escapeHtml(t.audioDubbedOption)}</span>
          </label>
          <label class="segmented__option"
                 title="${escapeHtml(t.audioSubtitledOptionTitle)}">
            <input type="radio" name="audio" id="audio-subtitled" value="subtitled">
            <span>${escapeHtml(t.audioSubtitledOption)}</span>
          </label>
        </div>
        <label class="filter">
          <input type="checkbox" id="filter-kids" name="kids" value="1">
          <span>${escapeHtml(t.kids)}</span>
        </label>
      </form>
    </div>

    <p class="counts" id="counts" data-total-movies="${movieCount}" data-total-showtimes="${showtimeCount}"
       data-plural-rule="${locale.pluralRule}"
       data-plural-movies="${escapeHtml(t.pluralMovies)}"
       data-plural-showtimes="${escapeHtml(t.pluralShowtimes)}"
       data-plural-unknown="${escapeHtml(t.pluralUnknownAudio)}">
      ${escapeHtml(t.counts(movieCount, showtimeCount))}
    </p>

    ${renderSourceNotices(snapshot, lang, t)}
    ${emptyState}
    ${pastState}

    <div class="search">
      <input type="search" class="search__input" id="movie-search"
             placeholder="${escapeHtml(t.searchLabel)}" aria-label="${escapeHtml(
               t.searchLabel,
             )}" autocomplete="off">
    </div>

    <div class="movies" id="movies" data-date="${escapeHtml(date)}" data-started-label="${escapeHtml(
      t.startedLabel,
    )}">${cards}
    </div>
  </main>

  <footer class="footer">
    <div class="install" id="install">
      <button type="button" class="install__button" id="install-button">
        ${escapeHtml(t.installButton)}
      </button>
      <div class="install__hint" id="install-hint" hidden>
        ${t.installHintHtml}
      </div>
    </div>
    <p>${escapeHtml(t.lastUpdate(formatTimestamp(snapshot.generatedAt, lang)))}</p>
    <p>${escapeHtml(t.disclaimerSource)}</p>
    <p>${escapeHtml(t.disclaimerAccuracy)}</p>
    <p class="footer__privacy">${escapeHtml(t.privacy)}</p>
  </footer>

  <a href="#top" class="scroll-top" aria-label="${escapeHtml(t.scrollTop)}">↑</a>

  <script src="${asset}assets/app.js" defer></script>
</body>
</html>
`;
}

/**
 * Every page of every language, keyed by its path inside `dist/` — Serbian at
 * the root, English under `en/` (R-19.1).
 */
export function renderPages(snapshot: Snapshot, swVersion = ''): Map<string, string> {
  const pages = new Map<string, string>();
  for (const lang of LANGS) {
    for (const date of snapshot.days) {
      pages.set(
        `${LOCALES[lang].pathPrefix}${pageName(date, snapshot.days)}`,
        renderDayPage(snapshot, date, swVersion, lang),
      );
    }
  }
  return pages;
}

/**
 * One `<url>` per day page **per language**, pointing at the same canonical
 * addresses the pages declare for themselves, each carrying `xhtml:link`
 * alternates so a crawler sees the two trees as translations of one page
 * rather than as duplicates. `lastmod` is the build time truncated to a date.
 */
export function renderSitemap(snapshot: Snapshot): string {
  const lastmod = snapshot.generatedAt.slice(0, 10);
  const alternates = (date: string) =>
    [
      ...LANGS.map(
        (code) =>
          `    <xhtml:link rel="alternate" hreflang="${LOCALES[code].hreflang}" href="${pageUrl(
            date,
            snapshot.days,
            code,
          )}"/>`,
      ),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(
        date,
        snapshot.days,
        DEFAULT_LANG,
      )}"/>`,
    ].join('\n');

  const urls = LANGS.flatMap((lang) =>
    snapshot.days.map(
      (date) => `  <url>
    <loc>${pageUrl(date, snapshot.days, lang)}</loc>
${alternates(date)}
    <lastmod>${lastmod}</lastmod>
    <changefreq>hourly</changefreq>
  </url>`,
    ),
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

/** Wide open: every page here is meant to be crawled, so this exists only to point at the sitemap. */
export function renderRobots(): string {
  return `User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`;
}
