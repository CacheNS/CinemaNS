import type { Movie } from './types.js';

/**
 * Where clicking a poster should take the viewer.
 *
 * `exact` means TMDb gave us an actual video for this film, so the link opens
 * that trailer. Otherwise the link is a YouTube search, which is deliberate
 * rather than lazy: Serbian trailers are published by local distributors
 * (Blitz, MegaCom, Taramount) and are often absent from TMDb, so guessing a
 * video id would be worse than handing over a query that reliably finds one.
 * The distinction is exposed so the UI can word the tooltip honestly.
 */
export interface TrailerLink {
  url: string;
  exact: boolean;
}

const WATCH = 'https://www.youtube.com/watch?v=';
const SEARCH = 'https://www.youtube.com/results?search_query=';
/**
 * Builds the search a person would type themselves. The Serbian title comes
 * first because that is what a domestic distributor titles its upload with; the
 * original title is appended when it differs, which rescues cases where the
 * Serbian title is a loose localisation.
 */
export function trailerSearchUrl(movie: Pick<Movie, 'title' | 'originalTitle'>): string {
  const parts = [movie.title];
  if (movie.originalTitle && movie.originalTitle !== movie.title) {
    parts.push(movie.originalTitle);
  }
  parts.push('trailer', 'srpski');
  return SEARCH + encodeURIComponent(parts.join(' '));
}

export function trailerLink(
  movie: Pick<Movie, 'title' | 'originalTitle' | 'trailerKey'>,
): TrailerLink {
  if (movie.trailerKey) {
    return { url: WATCH + encodeURIComponent(movie.trailerKey), exact: true };
  }
  return { url: trailerSearchUrl(movie), exact: false };
}
