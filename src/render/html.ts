import { formatDayLabel, formatDayShort, formatTimestamp } from '../core/dates.js';
import { analyticsSnippet } from './analytics.js';
import { trailerLink } from '../core/trailer.js';
import { toSerbianLatin } from '../core/titles.js';
import { CINEMAS, CINEMA_IDS } from '../core/types.js';
import type { Movie, Showtime, Snapshot } from '../core/types.js';

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

function pageName(date: string, days: string[]): string {
  return date === days[0] ? 'index.html' : `${date}.html`;
}

function audioLabel(audio: Showtime['audio']): string {
  switch (audio) {
    case 'dubbed':
      return 'sinhronizovano';
    case 'subtitled':
      return 'titlovano';
    case 'original':
      return 'domaći film';
    default:
      return 'nije naznačeno';
  }
}

/** Short form used on the compact showtime chips. */
function audioShort(audio: Showtime['audio']): string {
  switch (audio) {
    case 'dubbed':
      return 'sinh.';
    case 'subtitled':
      return 'titl.';
    case 'original':
      return 'dom.';
    default:
      return '?';
  }
}

function renderShowtime(showtime: Showtime): string {
  const cinema = CINEMAS[showtime.cinemaId];
  const details = [showtime.format, audioLabel(showtime.audio)];
  if (showtime.hall) details.push(showtime.hall);

  return `
        <a class="showtime showtime--${showtime.audio}"
           href="${escapeHtml(showtime.bookingUrl)}"
           rel="noopener nofollow"
           target="_blank"
           data-audio="${showtime.audio}"
           title="${escapeHtml(`${cinema.name} · ${details.join(' · ')}`)}">
          <span class="showtime__time">${escapeHtml(showtime.time)}</span>
          <span class="showtime__meta">${escapeHtml(
            `${showtime.format} · ${audioShort(showtime.audio)}`,
          )}</span>
        </a>`;
}

function renderCinemaBlock(cinemaId: Movie['showtimes'][number]['cinemaId'], showtimes: Showtime[]): string {
  const cinema = CINEMAS[cinemaId];
  return `
      <div class="cinema" data-cinema="${cinemaId}">
        <a class="cinema__name" href="${escapeHtml(cinema.url)}" rel="noopener" target="_blank">${escapeHtml(
          cinema.shortName,
        )}</a>
        <div class="showtimes">${showtimes.map(renderShowtime).join('')}
        </div>
      </div>`;
}

function renderAgeBadge(movie: Movie): string {
  const rating = movie.ageRating;
  if (!rating) {
    return `<span class="badge badge--age badge--unknown" title="Nijedan izvor ne objavljuje uzrasnu oznaku za ovaj film">Uzrast nepoznat</span>`;
  }
  const modifier = rating.minAge <= 12 ? 'kid' : rating.minAge >= 16 ? 'adult' : 'teen';
  const suffix = rating.confident ? '' : ' (procena)';
  const explanation = rating.confident
    ? `Zvanična oznaka (${rating.source})`
    : 'Procena na osnovu žanra — nije zvanična oznaka';
  return `<span class="badge badge--age badge--${modifier}${
    rating.confident ? '' : ' badge--estimate'
  }" title="${escapeHtml(explanation)}">${escapeHtml(rating.label)}${suffix}</span>`;
}

function renderScoreBadge(movie: Movie): string {
  const score = movie.score;
  if (!score) return '';
  const value = score.value.toFixed(1).replace('.', ',');
  const title = `Ocena publike na ${score.source} — ${score.votes} glasova`;
  const label = `<span class="badge badge--score" title="${escapeHtml(title)}">★ ${escapeHtml(
    value,
  )}<span class="badge__sub">/10 ${escapeHtml(score.source)}</span></span>`;
  return score.url
    ? `<a class="badge-link" href="${escapeHtml(score.url)}" rel="noopener nofollow" target="_blank">${label}</a>`
    : label;
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

function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${minutes} min`;
}

function renderRuntimeBadge(movie: Movie): string {
  const minutes = movie.runtimeMinutes;
  if (!minutes) return '';
  const bucket = runtimeBucket(minutes);
  const explanation = {
    short: 'Kratak film — kraći od 90 minuta',
    medium: 'Srednje dužine — između 90 minuta i 2 sata',
    long: 'Dug film — 2 sata ili duže',
  }[bucket];
  return `<span class="badge badge--runtime badge--runtime-${bucket}" title="${escapeHtml(
    explanation,
  )}">${escapeHtml(formatRuntime(minutes))}</span>`;
}

function renderMovie(movie: Movie, date: string): string {
  const showtimes = movie.showtimes.filter((showtime) => showtime.date === date);
  if (showtimes.length === 0) return '';

  const byCinema = CINEMA_IDS.map((cinemaId) => ({
    cinemaId,
    showtimes: showtimes.filter((showtime) => showtime.cinemaId === cinemaId),
  })).filter((entry) => entry.showtimes.length > 0);

  // Format and audio belong together: the same film runs 2D dubbed in the
  // afternoon and 3D subtitled at night, and that pairing is what people pick by.
  const variants = [
    ...new Map(
      showtimes.map((showtime) => [
        `${showtime.format}|${showtime.audio}`,
        { format: showtime.format, audio: showtime.audio },
      ]),
    ).values(),
  ].sort((a, b) => a.format.localeCompare(b.format) || a.audio.localeCompare(b.audio));

  const hasDubbed = showtimes.some((showtime) => showtime.audio === 'dubbed');
  const minAge = movie.ageRating?.minAge ?? -1;

  const trailer = trailerLink(movie);
  const posterImage = movie.posterUrl
    ? `<img class="poster" src="${escapeHtml(movie.posterUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="poster poster--empty" aria-hidden="true"></div>`;
  // Wrapped rather than replaced, so a film with no poster is still clickable.
  const poster = `<a class="poster-link" href="${escapeHtml(trailer.url)}"
       target="_blank" rel="noopener noreferrer"
       title="${trailer.exact ? 'Pogledaj trailer' : 'Potraži trailer na YouTube-u'}"
       aria-label="${escapeHtml(`Trailer za ${movie.title}`)}"
    >${posterImage}<span class="poster-play" aria-hidden="true"></span></a>`;

  const meta: string[] = [];
  if (movie.genres.length) meta.push(movie.genres.slice(0, 3).join(', '));

  return `
    <article class="movie"
             data-kid-friendly="${movie.kidFriendly ? '1' : '0'}"
             data-min-age="${minAge}"
             data-has-dubbed="${hasDubbed ? '1' : '0'}"
             data-rating-confident="${movie.ageRating?.confident ? '1' : '0'}">
      <div class="movie__poster">${poster}</div>
      <div class="movie__body">
        <h2 class="movie__title">${escapeHtml(movie.title)}${
          movie.originalTitle
            ? ` <span class="movie__original">(${escapeHtml(movie.originalTitle)})</span>`
            : ''
        }</h2>
        <div class="badges">
          ${renderAgeBadge(movie)}
          ${renderRuntimeBadge(movie)}
          ${renderScoreBadge(movie)}
          ${variants
            .map(
              (variant) =>
                `<span class="badge badge--variant badge--${variant.audio}">${escapeHtml(
                  variant.format,
                )} · ${escapeHtml(audioLabel(variant.audio))}</span>`,
            )
            .join('\n          ')}
        </div>
        ${meta.length ? `<p class="movie__meta">${escapeHtml(meta.join(' · '))}</p>` : ''}
        <div class="cinemas">${byCinema
          .map((entry) => renderCinemaBlock(entry.cinemaId, entry.showtimes))
          .join('')}
        </div>
      </div>
    </article>`;
}

function renderDayNav(days: string[], active: string): string {
  return days
    .map((date) => {
      const current = date === active;
      return `<a class="daytab${current ? ' daytab--active' : ''}" href="${pageName(
        date,
        days,
      )}"${current ? ' aria-current="page"' : ''}>${escapeHtml(
        formatDayShort(date, days[0]),
      )}</a>`;
    })
    .join('\n        ');
}

function renderSourceNotices(snapshot: Snapshot): string {
  const problems = CINEMA_IDS.map((id) => ({ id, status: snapshot.sources[id] })).filter(
    (entry) => !entry.status.ok || entry.status.stale,
  );
  if (problems.length === 0) return '';

  const items = problems
    .map((entry) => {
      const cinema = CINEMAS[entry.id];
      const when = formatTimestamp(entry.status.fetchedAt);
      const reason = entry.status.ok
        ? `podaci su preuzeti iz ranijeg osvežavanja (${when})`
        : `poslednje uspešno osvežavanje: ${when}`;
      return `<li><strong>${escapeHtml(cinema.name)}</strong> — ${escapeHtml(reason)}</li>`;
    })
    .join('\n          ');

  return `
      <div class="notice notice--stale">
        <p>Podaci za neke bioskope možda nisu ažurni:</p>
        <ul>
          ${items}
        </ul>
      </div>`;
}

export function renderDayPage(snapshot: Snapshot, date: string): string {
  const days = snapshot.days;
  const moviesForDay = snapshot.movies.filter((movie) =>
    movie.showtimes.some((showtime) => showtime.date === date),
  );
  const showtimeCount = snapshot.movies
    .flatMap((movie) => movie.showtimes)
    .filter((showtime) => showtime.date === date).length;
  const unknownAudio = snapshot.movies
    .flatMap((movie) => movie.showtimes)
    .filter((showtime) => showtime.date === date && showtime.audio === 'unknown').length;

  const cards = moviesForDay.map((movie) => renderMovie(movie, date)).join('');

  const emptyState =
    moviesForDay.length === 0
      ? `<p class="empty">Za ovaj dan nema pronađenih projekcija.</p>`
      : '';

  return `<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bioskopi u Novom Sadu — ${escapeHtml(formatDayLabel(date, days[0]))}</title>
  <meta name="description" content="Objedinjen repertoar bioskopa u Novom Sadu: Arena Cineplex Centar, Cineplexx Promenada i CineStar BIG.">
  <link rel="stylesheet" href="assets/style.css">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#0f1115">
  <link rel="icon" href="assets/icon-192.png" sizes="192x192" type="image/png">
  <link rel="apple-touch-icon" href="assets/icon-180.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Bioskopi NS">
</head>
<body>
  <header class="header">
    <h1>Bioskopi u Novom Sadu</h1>
    <p class="subtitle">Arena Cineplex Centar · Cineplexx Promenada · CineStar BIG</p>
  </header>

  <nav class="days" aria-label="Izbor dana">
        ${renderDayNav(days, date)}
  </nav>

  <main>
    <div class="toolbar">
      <h2 class="toolbar__day">${escapeHtml(formatDayLabel(date, days[0]))}</h2>
      <form class="filters" id="filters">
        <label class="filter">
          <input type="checkbox" id="filter-dubbed" name="dubbed" value="1">
          <span>Samo sinhronizovano</span>
        </label>
        <label class="filter">
          <input type="checkbox" id="filter-kids" name="kids" value="1">
          <span>Za decu</span>
        </label>
      </form>
    </div>

    <p class="counts" id="counts" data-total-movies="${moviesForDay.length}" data-total-showtimes="${showtimeCount}" data-unknown-audio="${unknownAudio}">
      ${moviesForDay.length} filmova · ${showtimeCount} projekcija
    </p>

    ${renderSourceNotices(snapshot)}
    ${emptyState}

    <div class="movies" id="movies">${cards}
    </div>
  </main>

  <footer class="footer">
    <div class="install" id="install">
      <button type="button" class="install__button" id="install-button">
        📲 Instaliraj aplikaciju
      </button>
      <div class="install__hint" id="install-hint" hidden>
        <p><strong>Android (Chrome):</strong> meni ⋮ → „Instaliraj aplikaciju“
           odnosno „Dodaj na početni ekran“.</p>
        <p><strong>iPhone / iPad (Safari):</strong> dugme <strong>Podeli</strong>
           ↑ → <strong>„Dodaj na početni ekran“</strong>. Safari nema automatsku
           instalaciju, pa je ovo jedini način na iOS-u.</p>
        <p><strong>Računar (Chrome / Edge):</strong> ikonica za instalaciju
           u adresnoj traci.</p>
      </div>
    </div>
    <p>Poslednje osvežavanje: ${escapeHtml(formatTimestamp(snapshot.generatedAt))}.
       Podaci se osvežavaju na svakih sat vremena.</p>
    <p>Podaci se preuzimaju sa sajtova bioskopa. Uzrasne oznake i ocene su
       informativne i preuzete iz TMDb baze — proverite zvaničnu oznaku na sajtu
       bioskopa.</p>
    <p><a href="data.json">Svi podaci u JSON formatu</a></p>
    ${
      process.env['CF_BEACON_TOKEN']?.trim()
        ? `<p class="footer__privacy">Broj poseta se meri anonimno (Cloudflare Web
       Analytics). Ne koriste se kolačići i ne prikupljaju se lični podaci.</p>`
        : ''
    }
  </footer>

  <script src="assets/app.js" defer></script>
  ${analyticsSnippet(process.env['CF_BEACON_TOKEN'])}
</body>
</html>
`;
}

export function renderPages(snapshot: Snapshot): Map<string, string> {
  const pages = new Map<string, string>();
  for (const date of snapshot.days) {
    pages.set(pageName(date, snapshot.days), renderDayPage(snapshot, date));
  }
  return pages;
}
