import * as cheerio from 'cheerio';
import { fetchText, mapLimit } from '../core/http.js';
import { normalizeTime } from '../core/dates.js';
import { cleanTitle, detectAudio, detectFormat } from '../core/titles.js';
import type { AdapterResult, Audio, CinemaId, RawMovie, Showtime } from '../core/types.js';

const ORIGIN = 'https://cinestarcinemas.rs';

/**
 * Resolves a scraped href against CineStar's own origin and returns it only if
 * it lands there — unlike Arena's ticket host, CineStar sells through its own
 * domain, so anything else (a compromised or malicious href pointing off-site)
 * is refused rather than handed to a reader as a "Kupi kartu" link. Sold-out
 * screenings link to `javascript:;`, which parses but resolves to an opaque
 * origin and is rejected the same way.
 */
function cinestarUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href, `${ORIGIN}/`);
  } catch {
    return undefined;
  }
  return url.origin === ORIGIN ? url.toString() : undefined;
}

/**
 * CineStar prints a day as "petak 21.08." or "DANAS, 19.08." with no year, so
 * the year is inferred from the build window rather than assumed to be current
 * (a December build listing January dates would otherwise land a year early).
 */
export function resolveDate(label: string, days: string[]): string | null {
  const match = label.match(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\./);
  if (!match) return null;
  const day = String(Number(match[1])).padStart(2, '0');
  const month = String(Number(match[2])).padStart(2, '0');
  const suffix = `-${month}-${day}`;
  return days.find((date) => date.endsWith(suffix)) ?? null;
}

/** CineStar encodes version in the format string: TITL, SINH, KIDS/SINH, 3D/OV. */
export function audioFromFormatCode(code: string): Audio {
  const parts = code.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (parts.includes('SINH') || parts.includes('SINK')) return 'dubbed';
  if (parts.includes('TITL') || parts.includes('OV') || parts.includes('OMU')) {
    return 'subtitled';
  }
  return 'unknown';
}

export function formatFromCode(code: string): string {
  const parts = code.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

  // A screening can be both a premium format and 3D ("4DX/3D/TITL"), and the
  // glasses are the part people care about, so neither may be dropped.
  const premium = parts.includes('4DX')
    ? '4DX'
    : parts.includes('SCREENX')
      ? 'ScreenX'
      : parts.includes('IMAX')
        ? 'IMAX'
        : parts.includes('GOLD')
          ? 'Gold'
          : undefined;

  const dimension = parts.includes('3D') ? '3D' : undefined;
  if (premium && dimension) return `${premium} 3D`;
  return premium ?? dimension ?? '2D';
}

export function parseCinestar(
  html: string,
  days: string[],
  cinemaId: CinemaId,
  pageUrl: string,
): RawMovie[] {
  const $ = cheerio.load(html);
  const movies: RawMovie[] = [];
  const wanted = new Set(days);

  $('.movie-item').each((_, element) => {
    const item = $(element);

    const heading = item.find('.movie-desc h2').first().clone();
    heading.find('span').remove();
    const rawTitle = heading.text().replace(/\s+/g, ' ').trim();
    if (!rawTitle) return;

    const detailHref = item.find('.movie-desc a[href]').first().attr('href');
    const detailUrl = cinestarUrl(detailHref);
    const posterUrl = item.find('.poster-wrapper img').first().attr('src');
    const synopsis = item.find('.movie-desc > p').first().text().replace(/\s+/g, ' ').trim();

    const showtimes: Showtime[] = [];

    item.find('.day-wrapper').each((__, dayElement) => {
      const dayNode = $(dayElement);
      const dayLabel = dayNode.find('.day').first().text().trim();
      const date = resolveDate(dayLabel, days);
      if (!date || !wanted.has(date)) return;

      dayNode.find('a.perf').each((___, perfElement) => {
        const perf = $(perfElement);
        const time = normalizeTime(perf.find('.time').first().text());
        if (!time) return;

        const code = perf.attr('data-format') ?? perf.find('.format').first().text().trim();
        const hall = perf.find('.venue').first().text().trim();
        // Sold-out screenings link to "javascript:;" instead of the shop.
        const href = perf.attr('href') ?? '';
        const bookingUrl = cinestarUrl(href) ?? pageUrl;

        // The title itself can carry the marker even when the code does not.
        const audioFromCode = audioFromFormatCode(code);
        const audio: Audio =
          audioFromCode !== 'unknown' ? audioFromCode : detectAudio(rawTitle);

        const showtime: Showtime = {
          cinemaId,
          date,
          time,
          format: formatFromCode(code) || detectFormat(rawTitle),
          audio,
          bookingUrl,
        };
        if (code) showtime.languageTag = code;
        if (hall) showtime.hall = hall;
        showtimes.push(showtime);
      });
    });

    if (showtimes.length === 0) return;

    const movie: RawMovie = {
      cinemaId,
      rawTitle,
      cleanTitle: cleanTitle(rawTitle),
      showtimes,
    };
    if (posterUrl) movie.posterUrl = posterUrl;
    if (synopsis) movie.synopsis = synopsis;
    if (detailUrl) movie.detailUrl = detailUrl;

    const genres = (item.attr('data-genre') ?? '')
      .split(/[,;/|]/)
      .map((genre) => genre.trim())
      .filter((genre) => genre.length > 0);
    if (genres.length) movie.genres = genres;

    movies.push(movie);
  });

  return movies;
}

/**
 * CineStar's film pages carry the one thing the listing lacks: the original
 * title ("Izvorni naslov: Practical Magic 2"), which is what lets a film that
 * only plays here be shown with its English name.
 */
export function parseCinestarOriginalTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  let original: string | undefined;
  $('.movie-detail-item').each((_, element) => {
    if (original) return;
    const item = $(element);
    const label = item.find('span').first().text().replace(/\s+/g, ' ').trim();
    if (!/izvorni naslov/i.test(label)) return;
    const value = item.find('span').eq(1).text().replace(/\s+/g, ' ').trim();
    if (value) original = value;
  });
  return original;
}

/** Scrapes one CineStar venue, addressed by the slug its own site uses. */
export async function scrapeCinestar(
  days: string[],
  cinemaId: CinemaId,
  slug: string,
): Promise<AdapterResult> {
  const pageUrl = `${ORIGIN}/${slug}`;
  // CineStar sits behind Cloudflare, which rejects plain scraper requests from
  // datacenter IPs such as the CI runner's.
  const html = await fetchText(pageUrl, { browserLike: true, tlsFallback: true });
  const movies = parseCinestar(html, days, cinemaId, pageUrl);

  // One extra request per film, once an hour, is a fair price for showing the
  // original title. A failure here must never lose the showtimes.
  await mapLimit(movies, 3, async (movie) => {
    if (!movie.detailUrl) return;
    try {
      const original = parseCinestarOriginalTitle(
        await fetchText(movie.detailUrl, { browserLike: true, tlsFallback: true }),
      );
      if (original) movie.originalTitle = original;
    } catch {
      /* the listing data is enough on its own */
    }
  });

  return { cinemaId, movies };
}
