import * as cheerio from 'cheerio';
import { fetchText } from '../core/http.js';
import { MONTHS, normalizeTime } from '../core/dates.js';
import { cleanTitle, detectAudio, detectFormat, extractYear } from '../core/titles.js';
import type { AdapterResult, RawMovie, Showtime } from '../core/types.js';

const CINEMA_ID = 'tuck-beograd';
const ORIGIN = 'https://www.tuck.rs';
const PROGRAMME_URL = `${ORIGIN}/repertoar/`;

/**
 * Tuck sells tickets through `ulaznice.tuck.rs`, a separate host from its own
 * WordPress site — and unlike Arena's ticket host, this one has nothing
 * listening on 443 at all (verified: `https://ulaznice.tuck.rs` times out,
 * `http://` answers). So it cannot be upgraded the way Arena's is; it is
 * allow-listed as plain HTTP instead. Anything that resolves to neither this
 * origin nor Tuck's own site is rejected, the same defense Arena and CineStar
 * use against a compromised or malicious href.
 */
const TICKET_ORIGIN = 'http://ulaznice.tuck.rs';

function tuckUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href, `${ORIGIN}/`);
  } catch {
    return undefined;
  }
  return url.origin === ORIGIN || url.origin === TICKET_ORIGIN ? url.toString() : undefined;
}

/**
 * Tuck prints "01 sata 28 minuta" (hours and minutes each in their own
 * declined Serbian noun form, which varies by count), so the numbers are
 * pulled out by what precedes them rather than by matching the noun.
 */
export function parseTuckRuntime(text: string): number | undefined {
  const hours = /(\d{1,2})\s*sat/i.exec(text);
  const minutes = /(\d{1,3})\s*minut/i.exec(text);
  if (!hours && !minutes) return undefined;
  const total = (hours ? Number(hours[1]) : 0) * 60 + (minutes ? Number(minutes[1]) : 0);
  return total > 0 ? total : undefined;
}

/**
 * Tuck's day header spells the month out in Serbian ("23. avgust 2026."),
 * unlike CineStar's numeric-only day label, so it needs its own lookup rather
 * than {@link resolveDate}-style number matching.
 */
export function parseTuckDate(label: string): string | null {
  const match = /(\d{1,2})\s*\.\s*([a-zčćžšđ]+)\s*(\d{4})/i.exec(label);
  if (!match) return null;
  const day = Number(match[1]);
  const monthIndex = MONTHS.indexOf(match[2]!.toLowerCase());
  const year = Number(match[3]);
  if (monthIndex < 0) return null;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseTuck(html: string, days: string[]): RawMovie[] {
  const $ = cheerio.load(html);
  const wanted = new Set(days);
  const movies: RawMovie[] = [];

  $('.amy-movie-item').each((_, element) => {
    const item = $(element);

    const titleAnchor = item.find('.amy-movie-field-title a').first();
    const rawFull = titleAnchor.text().replace(/\s+/g, ' ').trim();
    if (!rawFull) return;

    // Tuck prints the local title and the original one on either side of a
    // slash: "Ukus Straha / Ice Cream Man". A film with no separate original
    // (rare, but not observed to date) just has no slash.
    const slash = rawFull.indexOf(' / ');
    const rawTitle = slash >= 0 ? rawFull.slice(0, slash).trim() : rawFull;
    const originalTitle = slash >= 0 ? rawFull.slice(slash + 3).trim() : undefined;

    const detailUrl = tuckUrl(titleAnchor.attr('href'));
    const posterUrl = tuckUrl(item.find('.amy-movie-item-poster img').first().attr('src'));
    const synopsis = item.find('.amy-movie-field-desc').first().text().replace(/\s+/g, ' ').trim();
    const runtimeMinutes = parseTuckRuntime(
      item.find('.amy-movie-field-duration').first().text(),
    );

    const language = item
      .find('.amy-movie-field-language .amy-movie-custom-field-content')
      .first()
      .text()
      .trim();
    // Tuck marks every dubbed screening, in the title suffix and again in the
    // language field, so an unmarked film is the cinema's own way of saying
    // "subtitled" (the same convention Cineplexx and Arena use).
    const audio = detectAudio(rawFull, language) === 'dubbed' ? 'dubbed' : 'subtitled';
    const format = detectFormat(rawFull);

    const releaseDate = item
      .find('.amy-movie-field-release_date .amy-movie-custom-field-content')
      .first()
      .text()
      .trim();
    const year = extractYear(releaseDate);

    const genres = item
      .find('.amy-movie-field-amy_genre .amy-movie-custom-field-content a')
      .map((__, a) => $(a).text().trim())
      .get()
      .filter((genre) => genre.length > 0);

    const showtimes: Showtime[] = [];

    item.find('.amy-movie-item-showtimes .amy-cell').each((__, cellElement) => {
      const cell = $(cellElement);
      const dateLabel = cell.find('.amy-head').first().text();
      const date = parseTuckDate(dateLabel);
      if (!date || !wanted.has(date)) return;

      const bookingUrl =
        tuckUrl(cell.find('.amy-intro-times a.button').first().attr('href')) ?? PROGRAMME_URL;

      cell.find('.amy-intro-times > div').each((___, lineElement) => {
        const line = $(lineElement).text().replace(/\s+/g, ' ').trim();
        const match = /^(.*?)\s+(\d{1,2}:\d{2})$/.exec(line);
        if (!match) return;
        const time = normalizeTime(match[2]!);
        if (!time) return;
        const hall = match[1]!.trim();

        const showtime: Showtime = {
          cinemaId: CINEMA_ID,
          date,
          time,
          format,
          audio,
          bookingUrl,
        };
        if (hall) showtime.hall = hall;
        if (audio === 'dubbed') showtime.languageTag = language || 'sinhronizovano';
        showtimes.push(showtime);
      });
    });

    if (showtimes.length === 0) return;

    const movie: RawMovie = {
      cinemaId: CINEMA_ID,
      rawTitle,
      cleanTitle: cleanTitle(rawTitle),
      showtimes,
    };
    if (originalTitle) movie.originalTitle = originalTitle;
    if (year) movie.year = year;
    if (posterUrl) movie.posterUrl = posterUrl;
    if (synopsis) movie.synopsis = synopsis;
    if (runtimeMinutes) movie.runtimeMinutes = runtimeMinutes;
    if (genres.length) movie.genres = genres;
    if (detailUrl) movie.detailUrl = detailUrl;
    movies.push(movie);
  });

  return movies;
}

/** Scrapes Tuckwood Cineplex, the one Tuck venue (Beograd only). */
export async function scrapeTuck(days: string[]): Promise<AdapterResult> {
  const html = await fetchText(PROGRAMME_URL);
  const movies = parseTuck(html, days);
  return { cinemaId: CINEMA_ID, movies };
}
