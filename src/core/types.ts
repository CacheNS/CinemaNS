export type CinemaId = 'arena' | 'cineplexx' | 'cinestar';

export interface Cinema {
  id: CinemaId;
  name: string;
  shortName: string;
  url: string;
}

export const CINEMAS: Record<CinemaId, Cinema> = {
  arena: {
    id: 'arena',
    name: 'Arena Cineplex Centar',
    shortName: 'Arena Centar',
    url: 'http://www.arenacineplex.com/',
  },
  cineplexx: {
    id: 'cineplexx',
    name: 'Cineplexx Promenada',
    shortName: 'Cineplexx Promenada',
    url: 'https://www.cineplexx.rs/cinemas/CINEPLEXX-NOVI-SAD',
  },
  cinestar: {
    id: 'cinestar',
    name: 'CineStar BIG',
    shortName: 'CineStar BIG',
    url: 'https://cinestarcinemas.rs/novi-sad-big',
  },
};

export const CINEMA_IDS: CinemaId[] = ['arena', 'cineplexx', 'cinestar'];

/**
 * `original` is a domestic film playing in Serbian: neither dubbed nor
 * subtitled, which is what a "titlovano" label would wrongly imply.
 */
export type Audio = 'dubbed' | 'subtitled' | 'original' | 'unknown';

export interface Showtime {
  cinemaId: CinemaId;
  /** Local date in Europe/Belgrade, YYYY-MM-DD. */
  date: string;
  /** Local start time in Europe/Belgrade, HH:mm. */
  time: string;
  format: string;
  audio: Audio;
  /** Raw label as printed by the cinema, kept for debugging and display. */
  languageTag?: string;
  hall?: string;
  bookingUrl: string;
}

/** What an adapter produces before cross-cinema merging. */
export interface RawMovie {
  cinemaId: CinemaId;
  rawTitle: string;
  /** Title with format/version noise stripped, used for TMDb lookup. */
  cleanTitle: string;
  /** Original-language (usually English) title, when the cinema publishes one. */
  originalTitle?: string;
  year?: number;
  posterUrl?: string;
  synopsis?: string;
  runtimeMinutes?: number;
  /** Genres as published by the cinema; used when TMDb is unavailable. */
  genres?: string[];
  /** ISO country code of production, when the cinema publishes one. */
  originCountry?: string;
  detailUrl?: string;
  showtimes: Showtime[];
}

export type RatingSource = 'RS' | 'HR' | 'SI' | 'DE' | 'AT' | 'GB' | 'US' | 'heuristic';

export interface AgeRating {  /** Display label, e.g. "12+", "Bez ograničenja". */
  label: string;
  minAge: number;
  source: RatingSource;
  /** False when derived from a fallback heuristic rather than a certification. */
  confident: boolean;
}

export interface Movie {
  /** TMDb id when resolved, otherwise the normalized title key. */
  key: string;
  tmdbId?: number;
  title: string;
  originalTitle?: string;
  posterUrl?: string;
  synopsis?: string;
  runtimeMinutes?: number;
  genres: string[];
  ageRating?: AgeRating;
  /** Audience score, currently TMDb's. */
  score?: {
    value: number;
    votes: number;
    source: 'TMDb';
    url?: string;
  };
  kidFriendly: boolean;
  hasDubbed: boolean;
  /** YouTube id of a regional-language trailer, when one is known. */
  trailerKey?: string;
  /** ISO-639-1 language of `trailerKey` ('sr', 'hr', 'en', …). */
  trailerLanguage?: string;
  /** Every raw title seen at any cinema, for debugging merges. */
  aliases: string[];
  showtimes: Showtime[];
}

export interface SourceStatus {
  ok: boolean;
  fetchedAt: string;
  movieCount: number;
  showtimeCount: number;
  /** True when this cinema's data was carried over from an earlier build. */
  stale: boolean;
  error?: string;
}

export interface Diagnostics {
  tmdbResolved: number;
  tmdbUnresolved: number;
  unresolvedTitles: string[];
  unknownAudioShowtimes: number;
}

export interface Snapshot {
  generatedAt: string;
  days: string[];
  movies: Movie[];
  sources: Record<CinemaId, SourceStatus>;
  diagnostics: Diagnostics;
}

export interface AdapterResult {
  cinemaId: CinemaId;
  movies: RawMovie[];
}
