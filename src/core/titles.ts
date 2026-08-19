import type { Audio } from './types.js';

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'c', џ: 'dz', ш: 's',
};

const LATIN_DIACRITICS: Record<string, string> = {
  č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj',
};

/**
 * Format, version and programme markers that cinemas append to titles.
 * Order matters: multi-word markers must be stripped before single words.
 */
const NOISE_PATTERNS: RegExp[] = [
  /\bprodu[zž]ena verzija\b/gi,
  /\bspecijalna projekcija\b/gi,
  /\bs?inhronizovano na srpski\b/gi,
  /\bsinhronizovan[oai]?\b/gi,
  /\btitlovan[oai]?\b/gi,
  /\bsa titlovima\b/gi,
  /\bnasinhronizovano\b/gi,
  /\bscreen ?x\b/gi,
  /\bgold ?class\b/gi,
  /\b4dx\b/gi,
  /\bimax\b/gi,
  /\bdolby ?(atmos|cinema)\b/gi,
  /\breal ?d\b/gi,
  /\b3d\b/gi,
  /\b2d\b/gi,
  /\bhfr\b/gi,
  /\bvip\b/gi,
  /\bov\b/gi,
  /\bomu\b/gi,
  /\bds\b/gi,
  /\bkids\b/gi,
  /\bmatine\b/gi,
  /\bpretpremijera\b/gi,
  /\bpremijera\b/gi,
  /\bmarat[oa]n\b/gi,
];

/** Transliterates Cyrillic and folds diacritics, without touching word order. */
export function transliterate(input: string): string {
  let out = '';
  for (const char of input) {
    const lower = char.toLowerCase();
    const mapped = CYRILLIC_TO_LATIN[lower] ?? LATIN_DIACRITICS[lower];
    if (mapped === undefined) {
      out += char;
      continue;
    }
    out += char === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }
  return out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Serbian Cyrillic → Serbian Latin for text shown to people.
 *
 * Distinct from {@link transliterate}, which deliberately folds diacritics
 * because it feeds title matching. This one keeps them, so the result is real
 * Serbian Latin ("Naučna fantastika") rather than an asciified approximation
 * ("Naucna fantastika").
 *
 * The mapping is 1:1 in this direction, which is why it is safe to apply
 * automatically — Latin → Cyrillic is not, since "nj" may be one letter or two.
 */
const CYRILLIC_TO_LATIN_DISPLAY: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'č', џ: 'dž', ш: 'š',
};

export function toSerbianLatin(input: string): string {
  const chars = [...input];
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string;
    const lower = char.toLowerCase();
    const mapped = CYRILLIC_TO_LATIN_DISPLAY[lower];

    if (mapped === undefined) {
      out += char;
      continue;
    }
    if (char === lower) {
      out += mapped;
      continue;
    }

    // A digraph in an all-caps run must stay all-caps: "ЉУБАВ" is "LJUBAV",
    // not "LjUBAV". Judge by the neighbour, since the digraph's own case
    // cannot distinguish "Njegoš" from "NJEGOŠ".
    const next = chars[i + 1];
    const nextIsUpper = next !== undefined && next !== next.toLowerCase();
    out += nextIsUpper ? mapped.toUpperCase() : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }

  return out;
}

/**
 * Same noise stripping as {@link cleanTitle}, but it keeps hyphens and other
 * punctuation the title genuinely uses ("Spider-Man: Brand New Day"). Used for
 * titles shown to people rather than fed to search.
 */
export function tidyDisplayTitle(raw: string): string {
  let title = raw.replace(/\s+/g, ' ').trim();
  title = title.replace(/\((?:[^)]*(?:3d|2d|imax|4dx|sinhron|titlov|ov|omu)[^)]*)\)/gi, ' ');
  for (const pattern of NOISE_PATTERNS) {
    title = title.replace(pattern, ' ');
  }
  return title
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([:,;])/g, '$1')
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g, '')
    .trim();
}

/**
 * Strips format/version noise from a raw cinema title, keeping the words a
 * human would call the film. Used as the TMDb search term.
 */
export function cleanTitle(raw: string): string {
  let title = raw
    .replace(/\s+/g, ' ')
    .replace(/[_]+/g, ' ')
    .trim();

  // Cinemas glue markers onto the title with hyphens: "PRICA-O-IGRACKAMA-5-3D".
  title = title.replace(/-/g, ' ');

  // Drop a trailing parenthetical that only carries format/version info.
  title = title.replace(/\((?:[^)]*(?:3d|2d|imax|4dx|sinhron|titlov|ov|omu)[^)]*)\)/gi, ' ');

  for (const pattern of NOISE_PATTERNS) {
    title = title.replace(pattern, ' ');
  }

  return title
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g, '')
    .trim();
}

/**
 * Aggressive key used for fuzzy comparison: transliterated, lowercased,
 * punctuation-free, noise-free.
 */
export function normalizeTitle(raw: string): string {
  return transliterate(cleanTitle(raw))
    .toLowerCase()
    .replace(/&/g, ' i ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  const compact = value.replace(/\s+/g, '');
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice coefficient over character bigrams, in [0, 1]. */
export function similarity(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.replace(/\s/g, '') === right.replace(/\s/g, '')) return 1;

  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let intersection = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const count of leftGrams.values()) leftTotal += count;
  for (const [gram, count] of rightGrams) {
    rightTotal += count;
    const other = leftGrams.get(gram);
    if (other !== undefined) intersection += Math.min(other, count);
  }
  if (leftTotal + rightTotal === 0) return 0;
  return (2 * intersection) / (leftTotal + rightTotal);
}

const DUBBED_MARKERS = [
  'sinhronizovano',
  'sinhronizovan',
  'sinhronizovana',
  'sinhronizovani',
  'sinkronizirano',
  'sinhro',
  // CineStar prints the bare code "SINH" (also as "KIDS/SINH").
  'sinh',
  'sync',
  'sink',
  'nasinhronizovano',
  'srpska sinhronizacija',
  'na srpskom',
];

const SUBTITLED_MARKERS = [
  'titlovano',
  'titlovan',
  'titlovana',
  'sa titlovima',
  'titl',
  'subtitle',
  'ov',
  'omu',
];

/**
 * Reads dubbing from whatever labels a cinema attaches to a screening.
 * Anything unrecognized stays `unknown` — never assumed subtitled, because a
 * wrong "subtitled" is exactly what would ruin a family's evening.
 */
export function detectAudio(...labels: (string | undefined | null)[]): Audio {
  const haystack = transliterate(labels.filter(Boolean).join(' ')).toLowerCase();
  if (!haystack.trim()) return 'unknown';

  for (const marker of DUBBED_MARKERS) {
    if (haystack.includes(marker)) return 'dubbed';
  }
  for (const marker of SUBTITLED_MARKERS) {
    if (new RegExp(`\\b${marker}\\b`).test(haystack)) return 'subtitled';
  }
  return 'unknown';
}

/** Pulls format markers (3D, IMAX, 4DX, …) out of arbitrary labels. */
export function detectFormat(...labels: (string | undefined | null)[]): string {
  const haystack = transliterate(labels.filter(Boolean).join(' ')).toLowerCase();
  if (/\b4dx\b/.test(haystack)) return '4DX';
  if (/\bimax\b/.test(haystack)) return 'IMAX';
  if (/screen ?x/.test(haystack)) return 'ScreenX';
  if (/gold ?class/.test(haystack)) return 'Gold';
  if (/\bvip\b/.test(haystack)) return 'VIP';
  if (/\b3d\b/.test(haystack)) return '3D';
  return '2D';
}

/** Extracts a 4-digit release year if the title or label carries one. */
export function extractYear(...labels: (string | undefined | null)[]): number | undefined {
  const haystack = labels.filter(Boolean).join(' ');
  const match = haystack.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const current = new Date().getUTCFullYear();
  return year >= 1900 && year <= current + 3 ? year : undefined;
}
