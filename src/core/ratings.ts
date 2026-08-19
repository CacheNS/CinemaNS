import type { AgeRating, RatingSource } from './types.js';
import type { TmdbMovie } from '../tmdb/client.js';

/**
 * Serbia has no cinema certification published by these sites, so we take the
 * nearest market that does. Order matters: closer market first.
 */
const COUNTRY_PREFERENCE: RatingSource[] = ['RS', 'HR', 'SI', 'DE', 'AT', 'GB', 'US'];

/** Maps each country's labels onto a comparable minimum age. */
const LABEL_TO_AGE: Record<string, Record<string, number>> = {
  RS: { '': 0 },
  HR: { N7: 7, N12: 12, N15: 15, N18: 18 },
  SI: { VS: 0, '12': 12, '15': 15, '18': 18 },
  DE: { '0': 0, '6': 6, '12': 12, '16': 16, '18': 18 },
  AT: { '0': 0, '6': 6, '10': 10, '12': 12, '14': 14, '16': 16 },
  GB: { U: 0, PG: 8, '12': 12, '12A': 12, '15': 15, '18': 18, R18: 18 },
  US: {
    G: 0,
    PG: 8,
    'PG-13': 13,
    R: 17,
    'NC-17': 17,
    NR: -1,
  },
};

/** Kid-friendly ceiling: a 12-year-old can watch, younger with a parent. */
export const KID_FRIENDLY_MAX_AGE = 12;

function parseLabel(country: string, label: string): number | null {
  const clean = label.trim().toUpperCase();
  if (!clean) return null;

  const mapped = LABEL_TO_AGE[country]?.[clean];
  if (mapped !== undefined) return mapped < 0 ? null : mapped;

  // Many countries just print the number ("12", "16+", "AL" for all ages).
  if (/^(AL|A|T|U|VS|BEZ)$/.test(clean)) return 0;
  const numeric = clean.match(/^(\d{1,2})\s*\+?$/);
  if (numeric) return Number(numeric[1]);
  return null;
}

export function formatAgeLabel(minAge: number): string {
  return minAge <= 0 ? 'Bez ograničenja' : `${minAge}+`;
}

const KID_GENRES = [
  'animation',
  'family',
  'animirani',
  'animacija',
  'porodični',
  'porodicni',
  'dečji',
  'decji',
  'crtani',
];
const ADULT_GENRES = ['horror', 'horor', 'thriller', 'triler', 'erotski'];

/**
 * Falls back to genre and dubbing when no certification exists anywhere. The
 * result is explicitly marked unconfident so the UI can say "procena", never
 * presenting a guess with the authority of a real rating.
 */
export function heuristicRating(genres: string[], hasDubbed: boolean): AgeRating | undefined {
  const lowered = genres.map((genre) => genre.toLowerCase());
  const looksKid = lowered.some((genre) => KID_GENRES.some((kid) => genre.includes(kid)));
  const looksAdult = lowered.some((genre) => ADULT_GENRES.some((adult) => genre.includes(adult)));

  if (looksKid && !looksAdult) {
    return { label: 'Bez ograničenja', minAge: hasDubbed ? 0 : 6, source: 'heuristic', confident: false };
  }
  if (looksAdult) {
    return { label: '16+', minAge: 16, source: 'heuristic', confident: false };
  }
  return undefined;
}

export function resolveAgeRating(
  tmdb: TmdbMovie | null | undefined,
  genres: string[],
  hasDubbed: boolean,
): AgeRating | undefined {
  if (tmdb?.adult) {
    return { label: '18+', minAge: 18, source: 'US', confident: true };
  }

  if (tmdb) {
    for (const country of COUNTRY_PREFERENCE) {
      const label = tmdb.certifications[country];
      if (!label) continue;
      const minAge = parseLabel(country, label);
      if (minAge === null) continue;
      return {
        label: formatAgeLabel(minAge),
        minAge,
        source: country,
        confident: true,
      };
    }
  }

  return heuristicRating(genres, hasDubbed);
}

export function isKidFriendly(rating: AgeRating | undefined): boolean {
  if (!rating) return false;
  return rating.minAge <= KID_FRIENDLY_MAX_AGE;
}
