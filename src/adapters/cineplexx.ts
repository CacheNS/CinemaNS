import { fetchJson, mapLimit } from '../core/http.js';
import { cleanTitle, detectAudio, detectFormat } from '../core/titles.js';
import type { AdapterResult, RawMovie, Showtime } from '../core/types.js';

const API_BASE = 'https://app.cineplexx.rs/api/v1';
const SITE_BASE = 'https://www.cineplexx.rs';
const CLIENT_KEY =
  process.env['CINEPLEXX_CLIENT_KEY'] ?? '308330b1-52a5-4883-aee3-304240c22ea1';
const NOVI_SAD_URL_NAME = 'CINEPLEXX-NOVI-SAD';

const HEADERS = {
  'CINEPLEXX-Platform': 'WEB',
  'client-key': CLIENT_KEY,
};

interface ApiCinema {
  id: string;
  name: string;
  cinemaUrlName: string;
}

interface ApiSession {
  id: string;
  cinemaId: string;
  movieId: string;
  sessionId: string;
  screenName?: string;
  /** [[formats], [versions]] — e.g. [["2D","SINH"], []]. */
  technologies?: string[][];
  showtime: string;
}

interface ApiSessionDay {
  date: string;
  sessions: ApiSession[];
}

interface ApiMovie {
  id: string;
  title?: string;
  titleCalculated?: string;
  titleOriginalCalculated?: string;
  posterImage?: string;
  runTime?: number;
  shortSynopsis?: string;
  synopsis?: string;
  startDate?: string;
  shortURL?: string;
  genres?: Array<string | { name?: string; title?: string }>;
}

/**
 * Cineplexx marks a dubbed screening with the "SINH" technology flag rather
 * than a word in the title, so dubbing is read from the session, not the movie.
 */
const DUBBED_FLAG = 'SINH';

function splitTechnologies(session: ApiSession): { formats: string[]; flags: string[] } {
  const groups = session.technologies ?? [];
  const flat = groups.flat().filter((value): value is string => typeof value === 'string');
  const flags = flat.filter((value) => value.toUpperCase() === DUBBED_FLAG);
  const formats = flat.filter((value) => value.toUpperCase() !== DUBBED_FLAG);
  return { formats, flags };
}

function toLocalParts(isoWithOffset: string): { date: string; time: string } | null {
  // The API returns Belgrade-local timestamps with an explicit offset, so the
  // literal date/time in the string is already what the cinema prints.
  const match = isoWithOffset.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return { date: match[1]!, time: `${match[2]}:${match[3]}` };
}

export async function scrapeCineplexx(days: string[]): Promise<AdapterResult> {
  const cinemas = await fetchJson<ApiCinema[]>(`${API_BASE}/cinemas`, { headers: HEADERS });
  const cinema = cinemas.find((c) => c.cinemaUrlName === NOVI_SAD_URL_NAME);
  if (!cinema) {
    throw new Error(`Cineplexx: cinema ${NOVI_SAD_URL_NAME} not found in /cinemas`);
  }

  const sessionDays = await fetchJson<ApiSessionDay[]>(
    `${API_BASE}/cinemas/${cinema.id}/sessions`,
    { headers: HEADERS },
  );

  const wanted = new Set(days);
  const sessions: ApiSession[] = [];
  for (const day of sessionDays) {
    for (const session of day.sessions ?? []) {
      const parts = toLocalParts(session.showtime);
      if (parts && wanted.has(parts.date)) sessions.push(session);
    }
  }

  const movieIds = [...new Set(sessions.map((s) => s.movieId))];
  const movies = await mapLimit(movieIds, 4, async (id) => {
    try {
      const result = await fetchJson<ApiMovie | ApiMovie[]>(`${API_BASE}/movies/${id}`, {
        headers: HEADERS,
      });
      return Array.isArray(result) ? result[0] : result;
    } catch {
      return undefined;
    }
  });

  const moviesById = new Map<string, ApiMovie>();
  movieIds.forEach((id, index) => {
    const movie = movies[index];
    if (movie) moviesById.set(id, movie);
  });

  const byMovie = new Map<string, RawMovie>();

  for (const session of sessions) {
    const parts = toLocalParts(session.showtime);
    if (!parts) continue;

    const movie = moviesById.get(session.movieId);
    const rawTitle =
      movie?.titleCalculated ?? movie?.title ?? movie?.titleOriginalCalculated;
    if (!rawTitle) continue;

    const { formats, flags } = splitTechnologies(session);
    // Cineplexx flags every dubbed screening with SINH, so the absence of the
    // flag is itself the cinema's own signal that the screening is subtitled.
    const audio = flags.length > 0 ? 'dubbed' : detectAudio(rawTitle) === 'dubbed' ? 'dubbed' : 'subtitled';

    const showtime: Showtime = {
      cinemaId: 'cineplexx',
      date: parts.date,
      time: parts.time,
      format: detectFormat(formats.join(' ')),
      audio,
      hall: session.screenName,
      bookingUrl: movie?.shortURL
        ? `${SITE_BASE}/movie/${movie.shortURL}`
        : `${SITE_BASE}/cinemas/${NOVI_SAD_URL_NAME}?date=all`,
    };
    if (flags.length) showtime.languageTag = 'sinhronizovano';

    let entry = byMovie.get(session.movieId);
    if (!entry) {
      entry = {
        cinemaId: 'cineplexx',
        rawTitle,
        cleanTitle: cleanTitle(movie?.titleOriginalCalculated || rawTitle),
        showtimes: [],
      };
      if (movie?.posterImage) entry.posterUrl = movie.posterImage;
      if (movie?.titleOriginalCalculated) {
        entry.originalTitle = movie.titleOriginalCalculated.trim();
      }
      if (movie?.runTime) entry.runtimeMinutes = movie.runTime;
      const genres = (movie?.genres ?? [])
        .map((genre) => (typeof genre === 'string' ? genre : genre.name ?? genre.title ?? ''))
        .filter((genre) => genre.length > 0);
      if (genres.length) entry.genres = genres;
      const synopsis = movie?.shortSynopsis || movie?.synopsis;
      if (synopsis) entry.synopsis = synopsis;
      if (movie?.startDate) {
        const year = Number(movie.startDate.slice(0, 4));
        if (Number.isFinite(year)) entry.year = year;
      }
      if (movie?.shortURL) entry.detailUrl = `${SITE_BASE}/movie/${movie.shortURL}`;
      byMovie.set(session.movieId, entry);
    }
    entry.showtimes.push(showtime);
  }

  return { cinemaId: 'cineplexx', movies: [...byMovie.values()] };
}
