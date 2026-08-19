import { cleanTitle, normalizeTitle, similarity, tidyDisplayTitle } from './titles.js';
import { isKidFriendly, resolveAgeRating } from './ratings.js';
import type { CinemaId, Diagnostics, Movie, RawMovie, Showtime } from './types.js';
import { TmdbClient, type TmdbMovie } from '../tmdb/client.js';

/** Two cinema titles below this similarity are treated as different films. */
const FUZZY_THRESHOLD = 0.82;

/**
 * How far each cinema's film metadata (original title, running time) can be
 * trusted. Cineplexx serves it from a structured API, CineStar labels the
 * fields explicitly, and Arena is scraped positionally out of prose — where a
 * missing original title leaves the director sitting in its place.
 */
const METADATA_TRUST: Record<CinemaId, number> = {
  cineplexx: 0,
  cinestar: 1,
  arena: 2,
};

function byMetadataTrust(raws: RawMovie[]): RawMovie[] {
  return [...raws].sort((a, b) => METADATA_TRUST[a.cinemaId] - METADATA_TRUST[b.cinemaId]);
}

/** Productions whose original language is Serbian, so they play untranslated. */
const DOMESTIC_COUNTRIES = new Set(['RS', 'SRB', 'SR']);

interface Group {
  key: string;
  tmdb: TmdbMovie | null;
  raws: RawMovie[];
  normalizedKeys: string[];
}

/**
 * Every spelling a cinema gives us. Cineplexx's `cleanTitle` is the English
 * original while its `rawTitle` is Serbian, so both must be comparable — this
 * is what lets "Odiseja" and "The Odyssey" land in the same group when TMDb
 * is unavailable.
 */
function titleKeys(raw: RawMovie): string[] {
  const keys = [raw.rawTitle, raw.cleanTitle]
    .map((title) => normalizeTitle(title ?? ''))
    .filter((key) => key.length > 0);
  return [...new Set(keys)];
}

function matches(a: string[], b: string[]): boolean {
  return a.some((left) => b.some((right) => similarity(left, right) >= FUZZY_THRESHOLD));
}

function sortShowtimes(showtimes: Showtime[]): Showtime[] {
  return [...showtimes].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.cinemaId.localeCompare(b.cinemaId);
  });
}

/**
 * Picks the most human-readable spelling. Arena writes titles in caps with
 * format noise ("MALCI I MONSTRUMI 3D (sinhronizovano)"), so candidates are
 * cleaned first and then scored by how much normal sentence case they use.
 */
function pickDisplayTitle(raws: RawMovie[], tmdb: TmdbMovie | null): string {
  if (tmdb?.title) return tmdb.title;

  const candidates = raws
    .map((raw) => cleanTitle(raw.rawTitle) || raw.rawTitle.trim())
    .filter((title) => title.length > 0);
  if (candidates.length === 0) return 'Nepoznat film';

  const score = (title: string): number => {
    const letters = title.replace(/[^\p{L}]/gu, '');
    if (letters.length === 0) return 0;
    const lower = letters.replace(/[^\p{Ll}]/gu, '').length;
    return lower / letters.length;
  };

  return candidates.reduce((best, title) => {
    const diff = score(title) - score(best);
    if (diff > 0.05) return title;
    if (diff < -0.05) return best;
    return title.length < best.length ? title : best;
  });
}

function pickPoster(raws: RawMovie[], tmdb: TmdbMovie | null): string | undefined {
  return tmdb?.posterUrl ?? raws.find((raw) => raw.posterUrl)?.posterUrl;
}

export async function mergeMovies(
  results: RawMovie[],
  tmdbClient: TmdbClient,
): Promise<{ movies: Movie[]; diagnostics: Diagnostics }> {
  const groups: Group[] = [];
  const byTmdbId = new Map<number, Group>();
  const unresolvedTitles = new Set<string>();
  let resolved = 0;

  for (const raw of results) {
    const keys = titleKeys(raw);
    const lookup: { cleanTitle: string; rawTitles: string[]; year?: number } = {
      cleanTitle: raw.cleanTitle || raw.rawTitle,
      rawTitles: [raw.rawTitle],
    };
    if (raw.year !== undefined) lookup.year = raw.year;

    const tmdb = await tmdbClient.resolve(lookup);

    if (tmdb) {
      resolved += 1;
      const existing = byTmdbId.get(tmdb.id);
      if (existing) {
        existing.raws.push(raw);
        existing.normalizedKeys.push(...keys);
        continue;
      }
      // A title that resolves now may already have arrived unresolved from
      // another cinema, so adopt that group rather than starting a second one.
      const orphan = groups.find(
        (group) => group.tmdb === null && matches(group.normalizedKeys, keys),
      );
      if (orphan) {
        orphan.key = `tmdb:${tmdb.id}`;
        orphan.tmdb = tmdb;
        orphan.raws.push(raw);
        orphan.normalizedKeys.push(...keys);
        byTmdbId.set(tmdb.id, orphan);
        continue;
      }

      const group: Group = {
        key: `tmdb:${tmdb.id}`,
        tmdb,
        raws: [raw],
        normalizedKeys: keys,
      };
      byTmdbId.set(tmdb.id, group);
      groups.push(group);
      continue;
    }

    unresolvedTitles.add(raw.rawTitle);

    // No TMDb id: fall back to fuzzy title matching so the app still merges
    // sensibly when the key is missing or a local title is unknown to TMDb.
    // This deliberately considers TMDb-backed groups too. Resolution is
    // per-listing, so one cinema's spelling can resolve while another's does
    // not; matching only unresolved groups would then split one film across two
    // cards — which is how enabling TMDb briefly *increased* the film count.
    const match = groups.find((group) => matches(group.normalizedKeys, keys));
    if (match) {
      match.raws.push(raw);
      match.normalizedKeys.push(...keys);
      continue;
    }

    groups.push({
      key: keys[0] ?? raw.rawTitle,
      tmdb: null,
      raws: [raw],
      normalizedKeys: keys,
    });
  }

  let unknownAudioShowtimes = 0;

  const movies: Movie[] = groups.map((group) => {
    // A domestic film plays in Serbian, so "titlovano" would be wrong for it
    // no matter which cinema reported the screening.
    const domestic = group.raws.some((raw) => DOMESTIC_COUNTRIES.has(raw.originCountry ?? ''));
    const showtimes = sortShowtimes(group.raws.flatMap((raw) => raw.showtimes)).map((showtime) =>
      domestic && showtime.audio === 'subtitled'
        ? { ...showtime, audio: 'original' as const }
        : showtime,
    );
    unknownAudioShowtimes += showtimes.filter((s) => s.audio === 'unknown').length;

    const hasDubbed = showtimes.some((showtime) => showtime.audio === 'dubbed');
    const cinemaGenres = [...new Set(group.raws.flatMap((raw) => raw.genres ?? []))];
    const genres = group.tmdb?.genres?.length ? group.tmdb.genres : cinemaGenres;
    // Cinema genres still help the heuristic even when TMDb supplied its own.
    const ageRating = resolveAgeRating(
      group.tmdb,
      [...new Set([...genres, ...cinemaGenres])],
      hasDubbed,
    );

    const movie: Movie = {
      key: group.key,
      title: pickDisplayTitle(group.raws, group.tmdb),
      genres,
      kidFriendly: isKidFriendly(ageRating),
      hasDubbed,
      aliases: [...new Set(group.raws.map((raw) => raw.rawTitle))],
      showtimes,
    };

    if (group.tmdb) {
      movie.tmdbId = group.tmdb.id;
      if (group.tmdb.originalTitle && group.tmdb.originalTitle !== movie.title) {
        movie.originalTitle = group.tmdb.originalTitle;
      }
      if (group.tmdb.voteAverage !== undefined) {
        movie.score = {
          value: group.tmdb.voteAverage,
          votes: group.tmdb.voteCount ?? 0,
          source: 'TMDb',
          url: `https://www.themoviedb.org/movie/${group.tmdb.id}`,
        };
      }
    }
    if (ageRating) movie.ageRating = ageRating;

    const poster = pickPoster(group.raws, group.tmdb);
    if (poster) movie.posterUrl = poster;

    if (!movie.originalTitle) {
      // Cineplexx and CineStar publish the original title in a labelled field,
      // so they are trusted first. Arena only prints it positionally before the
      // running time and sometimes puts the director there instead, which is
      // why it is the last resort rather than whichever cinema comes first.
      const displayKey = normalizeTitle(movie.title);
      const candidates = [
        ...byMetadataTrust(group.raws).map((raw) => raw.originalTitle?.trim()),
        ...byMetadataTrust(group.raws).map((raw) => raw.cleanTitle?.trim()),
      ];
      const original = candidates
        .filter((candidate): candidate is string => Boolean(candidate))
        .map(tidyDisplayTitle)
        .find((candidate) => candidate && normalizeTitle(candidate) !== displayKey);
      if (original) movie.originalTitle = original;
    }

    const synopsis =
      group.tmdb?.overview || group.raws.find((raw) => raw.synopsis)?.synopsis;
    if (synopsis) movie.synopsis = synopsis;

    // Arena rounds its running times (150 for a 145 minute film), so a cinema
    // that reports an exact figure wins.
    const runtime =
      group.tmdb?.runtimeMinutes ??
      byMetadataTrust(group.raws).find((raw) => raw.runtimeMinutes)?.runtimeMinutes;
    if (runtime) movie.runtimeMinutes = runtime;

    return movie;
  });

  movies.sort((a, b) => {
    if (b.showtimes.length !== a.showtimes.length) {
      return b.showtimes.length - a.showtimes.length;
    }
    return a.title.localeCompare(b.title, 'sr');
  });

  return {
    movies,
    diagnostics: {
      tmdbResolved: resolved,
      tmdbUnresolved: results.length - resolved,
      unresolvedTitles: [...unresolvedTitles],
      unknownAudioShowtimes,
    },
  };
}
