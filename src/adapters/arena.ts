import * as cheerio from 'cheerio';
import { fetchText, mapLimit } from '../core/http.js';
import { normalizeTime } from '../core/dates.js';
import { cleanTitle, detectAudio, detectFormat } from '../core/titles.js';
import type { AdapterResult, RawMovie, Showtime } from '../core/types.js';

const BASE = 'http://www.arenacineplex.com';

export interface ArenaListing {
  url: string;
  /** Present only for films in the home-page grid; otherwise read from the film page. */
  title?: string;
  posterUrl?: string;
}

function absolute(url: string): string {
  return url.startsWith('http') ? url : `${BASE}${url}`;
}

/**
 * Arena's home page links every film in the programme, but only the six in the
 * main grid carry a title and poster. The rest are "Saznaj više" / "Rezerviši
 * online" buttons, so their titles are read from the film page itself.
 */
export function parseArenaListings(html: string): ArenaListing[] {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, ArenaListing>();

  $('a[href*="/film/"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!href) return;

    const path = href.split('#')[0]!;
    if (!/\/film\/\d+/.test(path)) return;
    const url = absolute(path);

    const listing = byUrl.get(url) ?? { url };

    const title = anchor.find('h2').first().text().replace(/\s+/g, ' ').trim();
    if (title && !listing.title) listing.title = title;

    const poster =
      anchor.find('img').first().attr('src') ??
      anchor.closest('.box-image').find('a.image-hover img').first().attr('src');
    if (poster && !listing.posterUrl) listing.posterUrl = absolute(poster);

    byUrl.set(url, listing);
  });

  return [...byUrl.values()];
}

/** Falls back to the film page's own heading when the home page had no title. */
export function parseArenaTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (heading) return heading;
  const og = $('meta[property="og:title"]').attr('content')?.trim();
  return og && og.length > 0 ? og : undefined;
}


/**
 * Arena prints the original title next to the Serbian one:
 * "Spider-Man: Brand New Day | Trajanje: 105 min. | Žanr: ...".
 */
export function parseArenaOriginalTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  const line = $('h1')
    .first()
    .parent()
    .find('p')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return undefined;

  const candidate = line.split('|')[0]?.trim();
  if (!candidate || /trajanje|žanr|zanr/i.test(candidate)) return undefined;
  return candidate.length >= 2 && candidate.length <= 120 ? candidate : undefined;
}

/**
 * Arena prints "Trajanje: 105 min" on the film page, sometimes with the number
 * missing entirely, which is why the match is optional.
 */
export function parseArenaRuntime(html: string): number | undefined {
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
  const match = /Trajanje:\s*(\d{2,3})\s*min/i.exec(text);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  return minutes >= 30 && minutes <= 400 ? minutes : undefined;
}


/**
 * Arena's film page pairs a stack of date tabs with numbered tab panes. The
 * tabs carry dates like "19 .08.2026" (note the stray space) and each pane
 * holds one anchor per screening.
 */
export function parseArenaShowtimes(
  html: string,
  listing: ArenaListing,
  days: string[],
): Showtime[] {
  const $ = cheerio.load(html);
  const wanted = new Set(days);
  const showtimes: Showtime[] = [];
  const title = listing.title ?? parseArenaTitle(html) ?? '';

  const tabDates: string[] = [];
  $('li.datumar a').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, '');
    const match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    tabDates.push(
      match
        ? `${match[3]}-${String(Number(match[2])).padStart(2, '0')}-${String(
            Number(match[1]),
          ).padStart(2, '0')}`
        : '',
    );
  });

  // Arena marks dubbed versions explicitly in the title ("(sinhronizovano)")
  // and lists the subtitled version as a separate film entry, so an unmarked
  // entry is the cinema's own way of saying "subtitled".
  const audio = detectAudio(title, listing.url) === 'dubbed' ? 'dubbed' : 'subtitled';
  const format = detectFormat(title, listing.url);

  $('.tab-content .tab-pane').each((index, element) => {
    const date = tabDates[index];
    if (!date || !wanted.has(date)) return;

    $(element)
      .find('a[href]')
      .each((__, anchor) => {
        const node = $(anchor);
        const time = normalizeTime(node.find('h3').first().text());
        if (!time) return;

        const href = node.attr('href') ?? listing.url;
        const hall = node
          .find('span')
          .text()
          .replace(/\s+/g, ' ')
          .match(/Sala:\s*([^\s]+)/i)?.[1];

        const showtime: Showtime = {
          cinemaId: 'arena',
          date,
          time,
          format,
          audio,
          bookingUrl: href.startsWith('http') ? href : `${BASE}${href}`,
        };
        if (hall) showtime.hall = hall;
        if (audio === 'dubbed') showtime.languageTag = 'sinhronizovano';
        showtimes.push(showtime);
      });
  });

  return showtimes;
}

export async function scrapeArena(days: string[]): Promise<AdapterResult> {
  const homeHtml = await fetchText(`${BASE}/`);
  const listings = parseArenaListings(homeHtml);

  const results = await mapLimit(listings, 3, async (listing) => {
    try {
      const html = await fetchText(listing.url);
      return {
        title: listing.title ?? parseArenaTitle(html),
        originalTitle: parseArenaOriginalTitle(html),
        runtimeMinutes: parseArenaRuntime(html),
        showtimes: parseArenaShowtimes(html, listing, days),
      };
    } catch {
      return {
        title: listing.title,
        originalTitle: undefined,
        runtimeMinutes: undefined,
        showtimes: [] as Showtime[],
      };
    }
  });

  const movies: RawMovie[] = [];
  listings.forEach((listing, index) => {
    const result = results[index];
    if (!result || result.showtimes.length === 0) return;
    const rawTitle = result.title ?? listing.title;
    if (!rawTitle) return;

    const movie: RawMovie = {
      cinemaId: 'arena',
      rawTitle,
      cleanTitle: cleanTitle(rawTitle),
      detailUrl: listing.url,
      showtimes: result.showtimes,
    };
    if (listing.posterUrl) movie.posterUrl = listing.posterUrl;
    if (result.originalTitle) movie.originalTitle = result.originalTitle;
    if (result.runtimeMinutes) movie.runtimeMinutes = result.runtimeMinutes;
    movies.push(movie);
  });

  return { cinemaId: 'arena', movies };
}
