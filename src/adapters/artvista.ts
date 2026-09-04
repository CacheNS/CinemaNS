import * as cheerio from 'cheerio';
import { fetchText, mapLimit } from '../core/http.js';
import { normalizeTime } from '../core/dates.js';
import { cleanTitle, detectAudio, detectFormat } from '../core/titles.js';
import type { AdapterResult, CinemaId, RawMovie, Showtime } from '../core/types.js';

/**
 * Arena Cineplex and Roda Cineplex are separate venues in separate cities run
 * by the same operator on the same CMS: identical selectors, the same stray
 * space in the date tabs, the same run-on detail rows and the same
 * `numSale/index/<id>` shape on their respective `ulaznice.` ticket hosts.
 * One parser serves both; only the origins and the venue id differ.
 */
export interface ArtVistaVenue {
  cinemaId: CinemaId;
  /** Programme origin. Both sites are plaintext HTTP and have no working HTTPS. */
  base: string;
  ticketOrigin: string;
}

export const ARENA: ArtVistaVenue = {
  cinemaId: 'arena-novi-sad',
  base: 'http://www.arenacineplex.com',
  ticketOrigin: 'https://ulaznice.arenacineplex.com',
};

export const RODA: ArtVistaVenue = {
  cinemaId: 'roda-beograd',
  base: 'http://www.rodacineplex.com',
  ticketOrigin: 'https://ulaznice.rodacineplex.com',
};

const VENUES: Partial<Record<CinemaId, ArtVistaVenue>> = {
  [ARENA.cinemaId]: ARENA,
  [RODA.cinemaId]: RODA,
};

export interface ArtVistaListing {
  url: string;
  /** Present only for films in the home-page grid; otherwise read from the film page. */
  title?: string;
  posterUrl?: string;
}

/**
 * Resolves a scraped href against the venue's own site and returns it only if
 * it lands on one of the origins we expect. Anything else — an absolute link to
 * another host, a `javascript:` URL, a malformed value — becomes null and is
 * dropped by the caller.
 *
 * The ticket host is silently upgraded to HTTPS on the way through: a booking
 * link is the one place the scheme matters, since the reader is about to hand
 * over card details from a page we serve over HTTPS. Both chains' ticket hosts
 * answer on 443; only their programme sites are HTTP-only.
 */
function artVistaUrl(
  venue: ArtVistaVenue,
  href: string,
  allowed: readonly string[],
): string | null {
  let url: URL;
  try {
    url = new URL(href, `${venue.base}/`);
  } catch {
    return null;
  }
  const ticketHost = new URL(venue.ticketOrigin).host;
  if (url.protocol === 'http:' && url.host === ticketHost) {
    url.protocol = 'https:';
  }
  return allowed.includes(url.origin) ? url.toString() : null;
}

/** A link into the venue's own programme, or null if it points anywhere else. */
export function artVistaProgrammeUrl(venue: ArtVistaVenue, href: string): string | null {
  return artVistaUrl(venue, href, [venue.base]);
}

/** A booking link, which may live on either the site or the ticket host. */
export function artVistaBookingUrl(venue: ArtVistaVenue, href: string): string | null {
  return artVistaUrl(venue, href, [venue.ticketOrigin, venue.base]);
}

/**
 * The home page links every film in the programme, but only the six in the
 * main grid carry a title and poster. The rest are "Saznaj više" / "Rezerviši
 * online" buttons, so their titles are read from the film page itself.
 */
export function parseArtVistaListings(venue: ArtVistaVenue, html: string): ArtVistaListing[] {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, ArtVistaListing>();

  $('a[href*="/film/"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!href) return;

    const path = href.split('#')[0]!;
    if (!/\/film\/\d+/.test(path)) return;
    const url = artVistaProgrammeUrl(venue, path);
    if (!url) return;

    const listing = byUrl.get(url) ?? { url };

    const title = anchor.find('h2').first().text().replace(/\s+/g, ' ').trim();
    if (title && !listing.title) listing.title = title;

    const poster =
      anchor.find('img').first().attr('src') ??
      anchor.closest('.box-image').find('a.image-hover img').first().attr('src');
    if (poster && !listing.posterUrl) {
      const posterUrl = artVistaProgrammeUrl(venue, poster);
      if (posterUrl) listing.posterUrl = posterUrl;
    }

    byUrl.set(url, listing);
  });

  return [...byUrl.values()];
}

/** Falls back to the film page's own heading when the home page had no title. */
export function parseArtVistaTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (heading) return heading;
  const og = $('meta[property="og:title"]').attr('content')?.trim();
  return og && og.length > 0 ? og : undefined;
}


/**
 * The film page prints the original title next to the Serbian one:
 * "Spider-Man: Brand New Day | Trajanje: 105 min. | Žanr: ...".
 */
export function parseArtVistaOriginalTitle(html: string): string | undefined {
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
 * The film details print "Zemlja porekla: RS". A domestic film is shown in
 * Serbian, so it is neither dubbed nor subtitled.
 */
export function parseArtVistaOriginCountry(html: string): string | undefined {
  const value = labelledValue(html, 'Zemlja porekla');
  const match = value ? /^[A-Za-z]{2,3}/.exec(value) : null;
  return match ? match[0].toUpperCase() : undefined;
}

/**
 * The detail block is a list of `<strong>Label:</strong>value` rows. The rows
 * carry no whitespace between them, so reading the label's own container is
 * the only way to know where a value ends.
 */
function labelledValue(html: string, label: string): string | undefined {
  const $ = cheerio.load(html);
  let value: string | undefined;
  $('strong').each((_, element) => {
    if (value !== undefined) return;
    const strong = $(element);
    if (!strong.text().replace(/\s+/g, ' ').trim().startsWith(label)) return;
    const row = strong.parent().clone();
    row.find('strong').remove();
    const text = row.text().replace(/\s+/g, ' ').trim();
    if (text) value = text;
  });
  return value;
}

/**
 * The film page prints "Trajanje: 105 min", sometimes with the number missing
 * entirely, which is why the match is optional.
 */
export function parseArtVistaRuntime(html: string): number | undefined {
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
  const match = /Trajanje:\s*(\d{2,3})\s*min/i.exec(text);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  return minutes >= 30 && minutes <= 400 ? minutes : undefined;
}


/**
 * The film page pairs a stack of date tabs with numbered tab panes. The tabs
 * carry dates like "19 .08.2026" (note the stray space) and each pane holds one
 * anchor per screening.
 */
export function parseArtVistaShowtimes(
  venue: ArtVistaVenue,
  html: string,
  listing: ArtVistaListing,
  days: string[],
): Showtime[] {
  const $ = cheerio.load(html);
  const wanted = new Set(days);
  const showtimes: Showtime[] = [];
  const title = listing.title ?? parseArtVistaTitle(html) ?? '';

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

  // Both chains mark dubbed versions explicitly in the title ("(sinhronizovano)")
  // and list the subtitled version as a separate film entry, so an unmarked
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

        // A placeholder row is left behind for a screening that has already
        // happened: time "00:00" and a booking link that stops at /index/ with no
        // screening id. Every real screening carries one (…/index/197750), so the
        // id is the signal — dropping "00:00" instead would also drop a genuine
        // midnight show, and these rows are indistinguishable by time alone.
        if (/\/numSale\/index\/?$/i.test(href)) return;

        const bookingUrl =
          artVistaBookingUrl(venue, href) ?? artVistaProgrammeUrl(venue, listing.url);
        if (!bookingUrl) return;

        const hall = node
          .find('span')
          .text()
          .replace(/\s+/g, ' ')
          .match(/Sala:\s*([^\s]+)/i)?.[1];

        const showtime: Showtime = {
          cinemaId: venue.cinemaId,
          date,
          time,
          format,
          audio,
          bookingUrl,
        };
        if (hall) showtime.hall = hall;
        if (audio === 'dubbed') showtime.languageTag = 'sinhronizovano';
        showtimes.push(showtime);
      });
  });

  return showtimes;
}

export async function scrapeArtVista(days: string[], cinemaId: CinemaId): Promise<AdapterResult> {
  const venue = VENUES[cinemaId];
  if (!venue) throw new Error(`nepoznat Art Vista bioskop: ${cinemaId}`);

  const homeHtml = await fetchText(`${venue.base}/`);
  const listings = parseArtVistaListings(venue, homeHtml);

  const results = await mapLimit(listings, 3, async (listing) => {
    try {
      const html = await fetchText(listing.url);
      return {
        title: listing.title ?? parseArtVistaTitle(html),
        originalTitle: parseArtVistaOriginalTitle(html),
        originCountry: parseArtVistaOriginCountry(html),
        runtimeMinutes: parseArtVistaRuntime(html),
        showtimes: parseArtVistaShowtimes(venue, html, listing, days),
      };
    } catch {
      return {
        title: listing.title,
        originalTitle: undefined,
        originCountry: undefined,
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
      cinemaId: venue.cinemaId,
      rawTitle,
      cleanTitle: cleanTitle(rawTitle),
      detailUrl: listing.url,
      showtimes: result.showtimes,
    };
    if (listing.posterUrl) movie.posterUrl = listing.posterUrl;
    if (result.originalTitle) movie.originalTitle = result.originalTitle;
    if (result.originCountry) movie.originCountry = result.originCountry;
    if (result.runtimeMinutes) movie.runtimeMinutes = result.runtimeMinutes;
    movies.push(movie);
  });

  return { cinemaId: venue.cinemaId, movies };
}
