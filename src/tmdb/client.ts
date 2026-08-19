import { fetchJson, HttpError } from '../core/http.js';
import { normalizeTitle, similarity, toSerbianLatin } from '../core/titles.js';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

/** Below this similarity we would rather have no match than a wrong one. */
const MATCH_THRESHOLD = 0.62;
/** Below this many votes a TMDb score is noise, so it is not shown. */
const MIN_VOTES = 20;

export interface TmdbMovie {
  id: number;
  title: string;
  originalTitle: string;
  posterUrl?: string;
  overview?: string;
  runtimeMinutes?: number;
  genres: string[];
  adult: boolean;
  releaseYear?: number;
  /** TMDb user score, 0–10, plus how many votes it rests on. */
  voteAverage?: number;
  voteCount?: number;
  imdbId?: string;
  /** Certification label per country, e.g. { US: 'PG-13', DE: '12' }. */
  certifications: Record<string, string>;
  /** YouTube id of the best available trailer, preferring Serbian. */
  trailerKey?: string;
  /** ISO-639-1 language of `trailerKey`, so the build can report coverage. */
  trailerLanguage?: string;
  /**
   * ISO-639-1 language the film was shot in. Used to recognise domestic films
   * in cities where no cinema publishes a country of production.
   */
  originalLanguage?: string;
}

interface SearchResponse {
  results?: {
    id: number;
    title?: string;
    original_title?: string;
    release_date?: string;
    popularity?: number;
  }[];
}

interface DetailsResponse {
  id: number;
  title?: string;
  original_title?: string;
  original_language?: string;
  overview?: string;
  poster_path?: string | null;
  runtime?: number | null;
  adult?: boolean;
  release_date?: string;
  vote_average?: number;
  vote_count?: number;
  imdb_id?: string | null;
  genres?: { name: string }[];
  release_dates?: {
    results?: {
      iso_3166_1: string;
      release_dates?: { certification?: string; type?: number }[];
    }[];
  };
  alternative_titles?: {
    titles?: { iso_3166_1: string; title: string }[];
  };
  videos?: {
    results?: {
      key: string;
      site?: string;
      type?: string;
      official?: boolean;
      iso_639_1?: string;
      iso_3166_1?: string;
    }[];
  };
}

export interface TmdbLookup {
  cleanTitle: string;
  rawTitles: string[];
  year?: number;
}

/**
 * Picks a YouTube trailer, preferring one a Serbian speaker gets most from.
 *
 * Order: Serbian, then the mutually intelligible neighbours, then English. An
 * English trailer is a genuine fallback rather than a failure — it is still the
 * right film — but it ranks below any regional upload, and a real video always
 * beats the YouTube-search fallback the poster link uses when TMDb has nothing.
 */
const LANGUAGE_RANK: Record<string, number> = {
  sr: 4,
  sh: 3,
  hr: 3,
  bs: 3,
  en: 1,
};

export interface PickedTrailer {
  key: string;
  /** ISO-639-1 code of the chosen video, kept so the build can report what it
   *  actually found rather than what it hoped to find. */
  language: string;
}

export function pickTrailer(videos: DetailsResponse['videos']): PickedTrailer | undefined {
  const candidates = (videos?.results ?? []).filter(
    (video) =>
      video.key &&
      (video.site ?? 'YouTube') === 'YouTube' &&
      LANGUAGE_RANK[video.iso_639_1 ?? ''] !== undefined,
  );
  if (!candidates.length) return undefined;

  const rank = (video: {
    type?: string;
    official?: boolean;
    iso_639_1?: string;
    iso_3166_1?: string;
  }): number => {
    // Language dominates: a Serbian teaser is worth more to this audience than
    // an official English trailer, so it is weighted above type and officiality
    // combined.
    let score = (LANGUAGE_RANK[video.iso_639_1 ?? ''] ?? 0) * 100;
    // Distributors sometimes tag a Serbian upload with the regional language
    // code but the Serbian country code, so country breaks ties within a
    // language band without ever overriding the language order itself.
    if (video.iso_3166_1 === 'RS') score += 10;
    if (video.type === 'Trailer') score += 4;
    else if (video.type === 'Teaser') score += 2;
    if (video.official) score += 1;
    return score;
  };

  const best = [...candidates].sort((a, b) => rank(b) - rank(a))[0];
  if (!best) return undefined;
  return { key: best.key, language: best.iso_639_1 ?? 'unknown' };
}

export function pickTrailerKey(videos: DetailsResponse['videos']): string | undefined {
  return pickTrailer(videos)?.key;
}

export class TmdbClient {
  private readonly cache = new Map<string, TmdbMovie | null>();
  private readonly overrides: Map<string, number>;
  private failures = 0;
  private warnedAboutAuth = false;

  constructor(
    private readonly apiKey: string | undefined,
    overrides: Record<string, number> = {},
  ) {
    this.overrides = new Map(
      Object.entries(overrides).map(([title, id]) => [normalizeTitle(title), id]),
    );
  }

  get enabled(): boolean {
    // Give up after repeated failures rather than stalling every title.
    return Boolean(this.apiKey) && this.failures < 5;
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set('api_key', this.apiKey!);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async resolve(lookup: TmdbLookup): Promise<TmdbMovie | null> {
    const key = normalizeTitle(lookup.cleanTitle);
    if (!key) return null;

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    let result: TmdbMovie | null = null;
    try {
      result = await this.lookup(key, lookup);
    } catch (error) {
      this.noteFailure(error);
      result = null;
    }

    this.cache.set(key, result);
    return result;
  }

  /**
   * A rejected key is worth saying out loud once. Pasting the v4 "API Read
   * Access Token" where the v3 key belongs is an easy mistake, and otherwise it
   * looks identical to having no key at all: the build succeeds and quietly
   * reports zero matches.
   */
  private noteFailure(error: unknown): void {
    this.failures += 1;
    const status = error instanceof HttpError ? error.status : undefined;
    if ((status === 401 || status === 403) && !this.warnedAboutAuth) {
      this.warnedAboutAuth = true;
      console.warn(
        `TMDb je odbio ključ (HTTP ${status}). Očekuje se "API Key (v3 auth)", ` +
          'a ne "API Read Access Token". Nastavljam bez TMDb-a.',
      );
    }
  }

  private async lookup(key: string, lookup: TmdbLookup): Promise<TmdbMovie | null> {
    const override = this.overrides.get(key);
    if (override !== undefined) return this.details(override);
    if (!this.enabled) return null;

    const candidates = new Map<number, { score: number }>();
    const queries = [lookup.cleanTitle, ...lookup.rawTitles].filter(Boolean);
    const seenQueries = new Set<string>();

    for (const query of queries) {
      const normalized = normalizeTitle(query);
      if (!normalized || seenQueries.has(normalized)) continue;
      seenQueries.add(normalized);

      for (const language of ['sr-RS', 'en-US']) {
        const response = await fetchJson<SearchResponse>(
          this.url('/search/movie', {
            query,
            language,
            region: 'RS',
            include_adult: 'true',
          }),
        );
        for (const candidate of response.results ?? []) {
          const score = Math.max(
            similarity(lookup.cleanTitle, candidate.title ?? ''),
            similarity(lookup.cleanTitle, candidate.original_title ?? ''),
            ...lookup.rawTitles.flatMap((raw) => [
              similarity(raw, candidate.title ?? ''),
              similarity(raw, candidate.original_title ?? ''),
            ]),
          );
          const year = candidate.release_date
            ? Number(candidate.release_date.slice(0, 4))
            : undefined;
          const yearPenalty =
            lookup.year && year && Math.abs(lookup.year - year) > 1 ? 0.25 : 0;
          const existing = candidates.get(candidate.id);
          const adjusted = score - yearPenalty;
          if (!existing || existing.score < adjusted) {
            candidates.set(candidate.id, { score: adjusted });
          }
        }
        if ([...candidates.values()].some((c) => c.score >= 0.9)) break;
      }
      if ([...candidates.values()].some((c) => c.score >= 0.9)) break;
    }

    const ranked = [...candidates.entries()].sort((a, b) => b[1].score - a[1].score);
    const best = ranked[0];
    if (!best) return null;

    if (best[1].score >= MATCH_THRESHOLD) return this.details(best[0]);

    // Weak title match: alternative titles are the last chance, since local
    // distributors often invent a title TMDb only knows as an alias.
    for (const [id] of ranked.slice(0, 3)) {
      const details = await this.details(id);
      if (!details) continue;
      const aliasScore = Math.max(
        ...[details.title, details.originalTitle].map((t) =>
          similarity(lookup.cleanTitle, t),
        ),
      );
      if (aliasScore >= MATCH_THRESHOLD) return details;
    }
    return null;
  }

  private async details(id: number): Promise<TmdbMovie | null> {
    if (!this.enabled) return null;
    const data = await fetchJson<DetailsResponse>(
      this.url(`/movie/${id}`, {
        language: 'sr-RS',
        append_to_response: 'release_dates,alternative_titles,videos',
        // TMDb filters videos by language, and dropping the filter entirely
        // returns only en-US. `null` keeps videos uploaded without a language.
        include_video_language: 'sr,hr,bs,en,null',
      }),
    );

    const certifications: Record<string, string> = {};
    for (const entry of data.release_dates?.results ?? []) {
      const certification = entry.release_dates
        ?.map((release) => release.certification?.trim())
        .find((value) => value);
      if (certification) certifications[entry.iso_3166_1] = certification;
    }

    // TMDb returns sr-RS localised text in Cyrillic. Convert at the boundary so
    // everything downstream sees Latin: not only the rendered page, but also the
    // genre keywords the age heuristic matches on, which are Latin-only and were
    // therefore never matching TMDb's genres.
    const movie: TmdbMovie = {
      id: data.id,
      title: toSerbianLatin(data.title ?? ''),
      // Not transliterated: this is the film's own original-language title, and
      // forcing a Serbian mapping onto, say, Russian would be wrong.
      originalTitle: data.original_title ?? toSerbianLatin(data.title ?? ''),
      genres: (data.genres ?? []).map((genre) => toSerbianLatin(genre.name)),
      adult: Boolean(data.adult),
      certifications,
    };
    if (data.poster_path) movie.posterUrl = `${IMAGE_BASE}${data.poster_path}`;
    if (data.original_language) movie.originalLanguage = data.original_language;
    if (data.overview) movie.overview = toSerbianLatin(data.overview);
    if (data.runtime) movie.runtimeMinutes = data.runtime;
    if (data.release_date) {
      const year = Number(data.release_date.slice(0, 4));
      if (Number.isFinite(year)) movie.releaseYear = year;
    }
    // A score backed by a handful of votes says nothing, so it is dropped.
    if (typeof data.vote_average === 'number' && (data.vote_count ?? 0) >= MIN_VOTES) {
      movie.voteAverage = data.vote_average;
      movie.voteCount = data.vote_count ?? 0;
    }
    if (data.imdb_id) movie.imdbId = data.imdb_id;
    const trailer = pickTrailer(data.videos);
    if (trailer) {
      movie.trailerKey = trailer.key;
      movie.trailerLanguage = trailer.language;
    }
    return movie;
  }
}
