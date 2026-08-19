import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scrapeArena } from './adapters/arena.js';
import { scrapeCineplexx } from './adapters/cineplexx.js';
import { scrapeCinestar } from './adapters/cinestar.js';
import { windowDays } from './core/dates.js';
import { mergeMovies } from './core/merge.js';
import { CINEMAS, CINEMA_IDS, CITIES } from './core/types.js';
import type { CinemaId, Movie, RawMovie, Snapshot, SourceStatus } from './core/types.js';
import { TmdbClient } from './tmdb/client.js';
import { renderPages } from './render/html.js';
import { MANIFEST, renderIcon } from './render/icon.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `lib/` at runtime, so the repo root is one level up. */
export const ROOT = path.resolve(HERE, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DIST_DIR = path.join(ROOT, 'dist');
const RAW_CACHE = path.join(DATA_DIR, 'raw.json');

interface RawCacheEntry {
  fetchedAt: string;
  movies: RawMovie[];
}

type RawCache = Partial<Record<CinemaId, RawCacheEntry>>;

const SCRAPERS: Record<CinemaId, (days: string[]) => Promise<{ movies: RawMovie[] }>> =
  Object.fromEntries(
    CINEMA_IDS.map((id) => {
      const { source } = CINEMAS[id];
      const scrape = (days: string[]): Promise<{ movies: RawMovie[] }> => {
        switch (source.kind) {
          case 'arena':
            return scrapeArena(days);
          case 'cineplexx':
            return scrapeCineplexx(days, id, source.urlName);
          case 'cinestar':
            return scrapeCinestar(days, id, source.slug);
        }
      };
      return [id, scrape];
    }),
  ) as Record<CinemaId, (days: string[]) => Promise<{ movies: RawMovie[] }>>;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function countShowtimes(movies: RawMovie[]): number {
  return movies.reduce((total, movie) => total + movie.showtimes.length, 0);
}

/**
 * Reports which language each poster's trailer actually came from.
 *
 * The picker prefers Serbian, then the neighbouring languages, then English —
 * but that preference is only worth as much as TMDb's catalogue, which often
 * has a Croatian upload and no Serbian one. Printing the real distribution
 * keeps that gap visible instead of letting it look like a ranking bug.
 */
function summarizeTrailers(movies: Movie[]): string {
  const counts = new Map<string, number>();
  for (const movie of movies) {
    const bucket = movie.trailerKey ? (movie.trailerLanguage ?? 'nepoznat') : 'pretraga';
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const order = ['sr', 'sh', 'hr', 'bs', 'en'];
  const rank = (lang: string): number => {
    const index = order.indexOf(lang);
    return index === -1 ? order.length : index;
  };
  return (
    [...counts.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([lang, count]) => `${lang} ${count}`)
      .join(' · ') || 'nema'
  );
}

/** Drops showtimes that fell out of the current window (relevant for stale data). */
function withinWindow(movies: RawMovie[], days: string[]): RawMovie[] {
  const allowed = new Set(days);
  return movies
    .map((movie) => ({
      ...movie,
      showtimes: movie.showtimes.filter((showtime) => allowed.has(showtime.date)),
    }))
    .filter((movie) => movie.showtimes.length > 0);
}

export async function build(): Promise<Snapshot> {
  const days = windowDays(8);
  const previous = await readJson<RawCache>(RAW_CACHE, {});
  const now = new Date().toISOString();

  const settled = await Promise.all(
    CINEMA_IDS.map(async (cinemaId) => {
      try {
        const result = await SCRAPERS[cinemaId](days);
        if (result.movies.length === 0) throw new Error('nema pronađenih projekcija');
        return { cinemaId, movies: result.movies, error: undefined as string | undefined };
      } catch (error) {
        return {
          cinemaId,
          movies: [] as RawMovie[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const rawCache: RawCache = {};
  const sources = {} as Record<CinemaId, SourceStatus>;
  const allMovies: RawMovie[] = [];
  let liveSources = 0;

  for (const entry of settled) {
    const cinema = CINEMAS[entry.cinemaId];
    if (!entry.error) {
      liveSources += 1;
      const movies = withinWindow(entry.movies, days);
      rawCache[entry.cinemaId] = { fetchedAt: now, movies };
      allMovies.push(...movies);
      sources[entry.cinemaId] = {
        ok: true,
        fetchedAt: now,
        movieCount: movies.length,
        showtimeCount: countShowtimes(movies),
        stale: false,
      };
      console.log(
        `[${entry.cinemaId}] ${cinema.name}: ${movies.length} filmova, ${countShowtimes(movies)} projekcija`,
      );
      continue;
    }

    console.error(`[${entry.cinemaId}] neuspeh: ${entry.error}`);
    const fallback = previous[entry.cinemaId];
    const movies = fallback ? withinWindow(fallback.movies, days) : [];
    if (fallback) rawCache[entry.cinemaId] = fallback;
    allMovies.push(...movies);
    sources[entry.cinemaId] = {
      ok: movies.length > 0,
      fetchedAt: fallback?.fetchedAt ?? now,
      movieCount: movies.length,
      showtimeCount: countShowtimes(movies),
      stale: true,
      error: entry.error,
    };
  }

  if (liveSources === 0 && allMovies.length === 0) {
    throw new Error('Nijedan izvor nije uspeo i nema prethodnih podataka.');
  }

  const overrides = await readJson<Record<string, number>>(
    path.join(DATA_DIR, 'title-overrides.json'),
    {},
  );
  const tmdb = new TmdbClient(process.env['TMDB_API_KEY'], overrides);
  if (!tmdb.enabled) {
    console.warn('TMDB_API_KEY nije postavljen — spajanje po naslovu, bez uzrasnih oznaka.');
  }

  const { movies, diagnostics } = await mergeMovies(allMovies, tmdb);

  const snapshot: Snapshot = {
    generatedAt: now,
    days,
    movies,
    sources,
    diagnostics,
    cities: CITIES,
  };

  console.log(
    `Spojeno: ${movies.length} filmova · TMDb ${diagnostics.tmdbResolved}/${
      diagnostics.tmdbResolved + diagnostics.tmdbUnresolved
    } · nepoznat jezik: ${diagnostics.unknownAudioShowtimes} projekcija`,
  );
  console.log(`Trejleri: ${summarizeTrailers(movies)}`);

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RAW_CACHE, JSON.stringify(rawCache), 'utf8');

  return snapshot;
}

async function writeSite(snapshot: Snapshot): Promise<void> {
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(path.join(DIST_DIR, 'assets'), { recursive: true });

  for (const [name, html] of renderPages(snapshot)) {
    await writeFile(path.join(DIST_DIR, name), html, 'utf8');
  }
  await writeFile(
    path.join(DIST_DIR, 'data.json'),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
  await writeFile(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');

  // Assets are plain files, not compiled, so they are copied from src.
  const assets = path.join(ROOT, 'src', 'render', 'assets');
  if (existsSync(assets)) {
    await cp(assets, path.join(DIST_DIR, 'assets'), { recursive: true });
  }

  // Installable web app: the service worker must sit at the site root so its
  // scope covers every day page.
  await writeFile(
    path.join(DIST_DIR, 'manifest.webmanifest'),
    JSON.stringify(MANIFEST, null, 2),
    'utf8',
  );
  await cp(path.join(ROOT, 'src', 'render', 'sw.js'), path.join(DIST_DIR, 'sw.js'));

  const icons: [string, number, boolean][] = [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
    ['icon-180.png', 180, true],
  ];
  for (const [name, size, fullBleed] of icons) {
    await writeFile(path.join(DIST_DIR, 'assets', name), renderIcon(size, fullBleed));
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  const snapshot = await build();
  await writeSite(snapshot);
  console.log(`Sajt je generisan u dist/ za ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// Only run when invoked directly — `report.ts` imports `build()` from here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
