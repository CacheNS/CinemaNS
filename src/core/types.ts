/**
 * A cinema *venue*, not a chain. In Novi Sad each chain happens to have exactly
 * one venue, which is why an earlier version could get away with using the
 * chain name as the id. Beograd has five Cineplexx venues, so conflating the
 * two would merge Delta City and Galerija into a single block and present their
 * showtimes as if they were the same building.
 */
export type CinemaId =
  | 'arena-novi-sad'
  | 'cineplexx-novi-sad'
  | 'cinestar-novi-sad'
  | 'cineplexx-delta-city'
  | 'cineplexx-usce'
  | 'cineplexx-big-beograd'
  | 'cineplexx-beo'
  | 'cineplexx-galerija'
  | 'cinestar-beograd-ada'
  | 'tuck-beograd'
  | 'roda-beograd';

/** The operator. Metadata trust is a property of the chain, not the venue. */
export type Chain = 'arena' | 'cineplexx' | 'cinestar' | 'tuck' | 'roda';

export type CityId = 'novi-sad' | 'beograd';

/**
 * How to scrape a venue. Arena and Roda share the `artvista` parser — same
 * operator, same CMS, different city — and carry no parameter because each
 * whole site is one cinema; the adapter resolves its origins from the venue id.
 * The other two are addressed by the identifier their own site uses, and Tuck
 * is likewise a single venue with no location selector.
 */
export type CinemaSource =
  | { kind: 'artvista' }
  | { kind: 'cineplexx'; urlName: string }
  | { kind: 'cinestar'; slug: string }
  | { kind: 'tuck' };

export interface Cinema {
  id: CinemaId;
  chain: Chain;
  city: CityId;
  name: string;
  shortName: string;
  url: string;
  source: CinemaSource;
}

export interface City {
  id: CityId;
  /** Value of the `grad` query parameter. */
  slug: string;
  /** Nominative, for the switcher: "Novi Sad". */
  name: string;
  /** Locative, for prose: "u Novom Sadu". Serbian declines, so this is stored. */
  locative: string;
  cinemaIds: CinemaId[];
}

export const CINEMAS: Record<CinemaId, Cinema> = {
  'arena-novi-sad': {
    id: 'arena-novi-sad',
    chain: 'arena',
    city: 'novi-sad',
    name: 'Arena Cineplex Centar',
    shortName: 'Arena Centar',
    url: 'http://www.arenacineplex.com/',
    source: { kind: 'artvista' },
  },
  'cineplexx-novi-sad': {
    id: 'cineplexx-novi-sad',
    chain: 'cineplexx',
    city: 'novi-sad',
    name: 'Cineplexx Promenada',
    shortName: 'Cineplexx Promenada',
    url: 'https://www.cineplexx.rs/cinemas/CINEPLEXX-NOVI-SAD',
    source: { kind: 'cineplexx', urlName: 'CINEPLEXX-NOVI-SAD' },
  },
  'cinestar-novi-sad': {
    id: 'cinestar-novi-sad',
    chain: 'cinestar',
    city: 'novi-sad',
    name: 'CineStar BIG',
    shortName: 'CineStar BIG',
    url: 'https://cinestarcinemas.rs/novi-sad-big',
    source: { kind: 'cinestar', slug: 'novi-sad-big' },
  },
  'cineplexx-delta-city': {
    id: 'cineplexx-delta-city',
    chain: 'cineplexx',
    city: 'beograd',
    name: 'Cineplexx Delta City',
    shortName: 'Cineplexx Delta City',
    url: 'https://www.cineplexx.rs/cinemas/CINEPLEXX-4D-DELTA-CITY',
    source: { kind: 'cineplexx', urlName: 'CINEPLEXX-4D-DELTA-CITY' },
  },
  'cineplexx-usce': {
    id: 'cineplexx-usce',
    chain: 'cineplexx',
    city: 'beograd',
    name: 'Cineplexx Ušće',
    shortName: 'Cineplexx Ušće',
    url: 'https://www.cineplexx.rs/cinemas/CINEPLEXX-USCE-SHOPPING-CENTER',
    source: { kind: 'cineplexx', urlName: 'CINEPLEXX-USCE-SHOPPING-CENTER' },
  },
  'cineplexx-big-beograd': {
    id: 'cineplexx-big-beograd',
    chain: 'cineplexx',
    city: 'beograd',
    name: 'Cineplexx BIG Beograd',
    shortName: 'Cineplexx BIG',
    url: 'https://www.cineplexx.rs/cinemas/CINEPLEXX-BIG-BEOGRAD',
    source: { kind: 'cineplexx', urlName: 'CINEPLEXX-BIG-BEOGRAD' },
  },
  'cineplexx-beo': {
    id: 'cineplexx-beo',
    chain: 'cineplexx',
    city: 'beograd',
    name: 'Cineplexx BEO Shopping Center',
    shortName: 'Cineplexx BEO',
    url: 'https://www.cineplexx.rs/cinemas/CINEPLEXX-BEO-SHOPPING-CENTER',
    source: { kind: 'cineplexx', urlName: 'CINEPLEXX-BEO-SHOPPING-CENTER' },
  },
  'cineplexx-galerija': {
    id: 'cineplexx-galerija',
    chain: 'cineplexx',
    city: 'beograd',
    name: 'Cineplexx Galerija',
    shortName: 'Cineplexx Galerija',
    url: 'https://www.cineplexx.rs/cinemas/CINEPLEXX-GALERIJA',
    source: { kind: 'cineplexx', urlName: 'CINEPLEXX-GALERIJA' },
  },
  'cinestar-beograd-ada': {
    id: 'cinestar-beograd-ada',
    chain: 'cinestar',
    city: 'beograd',
    name: 'CineStar Ada Mall',
    shortName: 'CineStar Ada Mall',
    url: 'https://cinestarcinemas.rs/beograd-concept-cinema-ada-mall',
    source: { kind: 'cinestar', slug: 'beograd-concept-cinema-ada-mall' },
  },
  'tuck-beograd': {
    id: 'tuck-beograd',
    chain: 'tuck',
    city: 'beograd',
    name: 'Tuckwood Cineplex',
    shortName: 'Tuckwood',
    url: 'https://www.tuck.rs/',
    source: { kind: 'tuck' },
  },
  'roda-beograd': {
    id: 'roda-beograd',
    chain: 'roda',
    city: 'beograd',
    name: 'Roda Cineplex',
    shortName: 'Roda Cineplex',
    url: 'http://www.rodacineplex.com/',
    source: { kind: 'artvista' },
  },
};

export const CITIES: City[] = [
  {
    id: 'novi-sad',
    slug: 'novi-sad',
    name: 'Novi Sad',
    locative: 'u Novom Sadu',
    cinemaIds: ['arena-novi-sad', 'cineplexx-novi-sad', 'cinestar-novi-sad'],
  },
  {
    id: 'beograd',
    slug: 'beograd',
    name: 'Beograd',
    locative: 'u Beogradu',
    cinemaIds: [
      'cineplexx-delta-city',
      'cineplexx-usce',
      'cineplexx-galerija',
      'cineplexx-big-beograd',
      'cineplexx-beo',
      'cinestar-beograd-ada',
      'tuck-beograd',
      'roda-beograd',
    ],
  },
];

/** The city shown before the reader chooses, and to no-JS readers. */
export const DEFAULT_CITY: CityId = 'novi-sad';

export const CINEMA_IDS: CinemaId[] = CITIES.flatMap((city) => city.cinemaIds);

export function cityById(id: CityId): City {
  const city = CITIES.find((candidate) => candidate.id === id);
  if (!city) throw new Error(`Nepoznat grad: ${id}`);
  return city;
}

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
  /**
   * English title and genres for the `/en/` tree (R-19.5). Absent whenever
   * TMDb could not supply them — including when the build runs with no API key
   * at all — in which case the English page falls back to the same scraped
   * title the Serbian page shows.
   */
  titleEn?: string;
  genresEn?: string[];
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
  /** How many builds in a row this source has failed; absent when it didn't fail. */
  consecutiveFailures?: number;
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
  /** Included so `data.json` is self-describing: which venues sit in which city. */
  cities: City[];
}

export interface AdapterResult {
  cinemaId: CinemaId;
  movies: RawMovie[];
}
