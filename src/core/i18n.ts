/**
 * Every user-facing string on the page, in one table per language.
 *
 * Serbian is the default and stays at the site root; English is a parallel
 * `/en/` tree (R-19.1). `Strings` is a real interface rather than a
 * `Record<string, string>` on purpose: a key added to `sr` and forgotten in
 * `en` then fails `tsc --noEmit` instead of silently rendering Serbian to an
 * English reader.
 *
 * Nothing here is escaped. Values reach the page through `escapeHtml` like any
 * other text, except the handful marked as HTML fragments below, which are
 * authored in this file and interpolated raw.
 */

export type Lang = 'sr' | 'en';

export const LANGS: readonly Lang[] = ['sr', 'en'];

/** Serbian is the site's default: it renders at `/`, with no path prefix. */
export const DEFAULT_LANG: Lang = 'sr';

export interface Locale {
  /** `<html lang>`. */
  htmlLang: string;
  /** `og:locale`. */
  ogLocale: string;
  /** `hreflang` on the alternate links, and on the sitemap entries. */
  hreflang: string;
  /** Path segment the tree lives under: '' for Serbian, 'en/' for English. */
  pathPrefix: string;
  /**
   * How a page in this tree reaches the shared assets at the site root.
   * `style.css`, `app.js` and `sw.js` are single-copy (R-19.4), so an English
   * page one directory down must ask for `../assets/…` and `../sw.js`.
   */
  assetPrefix: string;
  /** Text on the language switcher. */
  label: string;
  /** Plural rule the client uses for the live counts. */
  pluralRule: 'sr' | 'en';
}

export const LOCALES: Record<Lang, Locale> = {
  sr: {
    htmlLang: 'sr-Latn',
    ogLocale: 'sr_RS',
    hreflang: 'sr-Latn-RS',
    pathPrefix: '',
    assetPrefix: '',
    label: 'SR',
    pluralRule: 'sr',
  },
  en: {
    htmlLang: 'en',
    ogLocale: 'en_US',
    hreflang: 'en',
    pathPrefix: 'en/',
    assetPrefix: '../',
    label: 'EN',
    pluralRule: 'en',
  },
};

/**
 * Serbian genre names to English, keyed lower-case.
 *
 * Needed because genres are usually **not** TMDb's: with no API key — how the
 * build currently runs (R-5.3) — they come straight off the cinema sites and
 * are Serbian, so `genresEn` is absent and the English page would otherwise
 * print "Akcija, Triler" (R-19.5b). The cinemas also disagree with each other
 * ("Akcija" / "Akcijski" / "Akcioni"), hence the several keys per entry; the
 * rest are TMDb's own `sr-RS` names, for when a key is set but the second
 * request fails.
 */
export const GENRES_EN: Record<string, string> = {
  akcija: 'Action',
  akcijski: 'Action',
  akcioni: 'Action',
  anime: 'Anime',
  animirani: 'Animation',
  avantura: 'Adventure',
  avanturistički: 'Adventure',
  'biografska drama': 'Biographical drama',
  biografski: 'Biography',
  dokumentarni: 'Documentary',
  'dokumentarni film': 'Documentary',
  drama: 'Drama',
  'epski spektakl': 'Epic',
  fantazija: 'Fantasy',
  horor: 'Horror',
  istorija: 'History',
  istorijski: 'Historical',
  komedija: 'Comedy',
  'koncert live': 'Live concert',
  kriminalistički: 'Crime',
  misterija: 'Mystery',
  muzika: 'Music',
  'muzički film': 'Musical',
  'naučna fantastika': 'Science fiction',
  porodični: 'Family',
  'porodični film': 'Family',
  rat: 'War',
  ratni: 'War',
  romansa: 'Romance',
  'romantični/ljubavni': 'Romance',
  sf: 'Sci-fi',
  sportski: 'Sport',
  triler: 'Thriller',
  'tv film': 'TV movie',
  vestern: 'Western',
};

/**
 * Falls back to the original when a genre is not in the table: an untranslated
 * label is a smaller failure than a missing one, and it shows up in the page
 * rather than being silently swallowed.
 */
export function translateGenre(genre: string, lang: Lang): string {
  if (lang === DEFAULT_LANG) return genre;
  return GENRES_EN[genre.trim().toLowerCase()] ?? genre;
}

export interface Strings {
  siteTitle: string;
  metaDescription: (dayLabel: string, movies: number, showtimes: number) => string;

  dayNavLabel: string;
  cityNavLabel: string;
  cityNoScript: (city: string) => string;
  langNavLabel: string;

  audioGroupLabel: string;
  audioAll: string;
  audioDubbedOption: string;
  audioSubtitledOption: string;
  audioSubtitledOptionTitle: string;
  kids: string;
  searchLabel: string;

  counts: (movies: number, showtimes: number) => string;
  empty: string;
  emptyPast: string;
  tomorrowLink: string;
  startedLabel: string;

  staleIntro: string;
  staleFromCache: (when: string) => string;
  staleLastOk: (when: string) => string;

  installButton: string;
  /** HTML fragment: authored here, interpolated raw. */
  installHintHtml: string;
  lastUpdate: (when: string) => string;
  disclaimerSource: string;
  disclaimerAccuracy: string;
  privacy: string;
  scrollTop: string;

  posterAlt: (title: string) => string;
  trailerExact: string;
  trailerSearch: string;
  trailerAria: (title: string) => string;

  ageUnknown: string;
  ageUnknownTitle: string;
  ageOfficial: (source: string) => string;
  ageEstimate: string;
  ageEstimateSuffix: string;

  runtimeShort: string;
  runtimeMedium: string;
  runtimeLong: string;
  runtimeHours: (hours: number, minutes: number) => string;
  runtimeMinutes: (minutes: number) => string;

  scoreTitle: (source: string, votes: number) => string;

  audioLabelDubbed: string;
  audioLabelSubtitled: string;
  audioLabelOriginal: string;
  audioLabelUnknown: string;
  audioShortDubbed: string;
  audioShortSubtitled: string;
  audioShortOriginal: string;
  audioShortUnknown: string;

  /**
   * Plural templates for the client-side live count, `{n}` for the number and
   * `|` between the forms the language's rule selects from — three for
   * Serbian, two for English. They travel to `app.js` as `data-` attributes on
   * `#counts` so the script itself carries no display copy (R-19.3).
   */
  pluralMovies: string;
  pluralShowtimes: string;
  pluralUnknownAudio: string;
}

export const STRINGS: Record<Lang, Strings> = {
  sr: {
    siteTitle: 'Kokice.org — Repertoar bioskopa za Novi Sad i Beograd',
    metaDescription: (dayLabel, movies, showtimes) =>
      `Repertoar bioskopa u Novom Sadu i Beogradu za ${dayLabel}: ${movies} filmova, ${showtimes} projekcija. Osvežava se više puta dnevno.`,

    dayNavLabel: 'Odabir dana',
    cityNavLabel: 'Izbor grada',
    cityNoScript: (city) =>
      `Za promenu grada potreban je JavaScript; prikazan je ${city}.`,
    langNavLabel: 'Jezik stranice',

    audioGroupLabel: 'Jezik projekcije',
    audioAll: 'Svi',
    audioDubbedOption: 'Sinhro.',
    audioSubtitledOption: 'Bez sinhro.',
    audioSubtitledOptionTitle: 'Titlovano, domaći filmovi i projekcije bez naznačenog jezika',
    kids: 'Za decu',
    searchLabel: 'Pretraga filmova…',

    counts: (movies, showtimes) => `${movies} filmova · ${showtimes} projekcija`,
    empty: 'Za ovaj dan nema pronađenih projekcija.',
    emptyPast: 'Za danas više nema projekcija.',
    tomorrowLink: 'Pogledajte sutrašnji repertoar.',
    startedLabel: 'već počelo',

    staleIntro: 'Podaci za neke bioskope možda nisu ažurni:',
    staleFromCache: (when) => `podaci su preuzeti iz ranijeg osvežavanja (${when})`,
    staleLastOk: (when) => `poslednje uspešno osvežavanje: ${when}`,

    installButton: '📲 Instaliraj aplikaciju',
    installHintHtml: `<p><strong>Android (Chrome):</strong> meni ⋮ → „Instaliraj aplikaciju“
           odnosno „Dodaj na početni ekran“.</p>
        <p><strong>iPhone / iPad (Safari):</strong> dugme <strong>Podeli</strong>
           ↑ → <strong>„Dodaj na početni ekran“</strong>. Safari nema automatsku
           instalaciju, pa je ovo jedini način na iOS-u.</p>
        <p><strong>Računar (Chrome / Edge):</strong> ikonica za instalaciju
           u adresnoj traci.</p>`,
    lastUpdate: (when) => `Poslednje osvežavanje: ${when}.`,
    disclaimerSource:
      'Podaci se preuzimaju sa sajtova bioskopa. Oznake uzrasta gledalaca i ocene su informativne i preuzete iz TMDb baze — proverite zvaničnu oznaku na sajtu bioskopa.',
    disclaimerAccuracy: 'Postoji mogućnost da podaci nisu ispravni. Proverite pre odlaska u bioskop.',
    privacy:
      'Broj poseta se meri anonimno (Cloudflare Web Analytics). Ne koriste se kolačići i ne prikupljaju se lični podaci.',
    scrollTop: 'Nazad na vrh',

    posterAlt: (title) => `${title} — plakat`,
    trailerExact: 'Pogledaj trailer',
    trailerSearch: 'Potraži trailer na YouTube-u',
    trailerAria: (title) => `Trailer za ${title}`,

    ageUnknown: 'Uzrast nepoznat',
    ageUnknownTitle: 'Nijedan izvor ne objavljuje uzrasnu oznaku za ovaj film',
    ageOfficial: (source) => `Zvanična oznaka (${source})`,
    ageEstimate: 'Procena na osnovu žanra — nije zvanična oznaka',
    ageEstimateSuffix: ' (procena)',

    runtimeShort: 'Kratak film — kraći od 90 minuta',
    runtimeMedium: 'Srednje dužine — između 90 minuta i 2 sata',
    runtimeLong: 'Dug film — 2 sata ili duže',
    runtimeHours: (hours, minutes) => `${hours} h ${minutes} min`,
    runtimeMinutes: (minutes) => `${minutes} min`,

    scoreTitle: (source, votes) => `Ocena publike na ${source} — ${votes} glasova`,

    audioLabelDubbed: 'sinhronizovano',
    audioLabelSubtitled: 'titlovano',
    audioLabelOriginal: 'domaći film',
    audioLabelUnknown: 'nije naznačeno',
    audioShortDubbed: 'sinh.',
    audioShortSubtitled: 'titl.',
    audioShortOriginal: 'dom.',
    audioShortUnknown: '?',

    pluralMovies: '{n} film|{n} filma|{n} filmova',
    pluralShowtimes: '{n} projekcija|{n} projekcije|{n} projekcija',
    pluralUnknownAudio:
      '{n} projekcija nema naznačen jezik i nisu prikazane|{n} projekcije nemaju naznačen jezik i nisu prikazane|{n} projekcija nema naznačen jezik i nisu prikazane',
  },

  en: {
    siteTitle: 'Kokice.org — Cinema listings for Novi Sad and Belgrade',
    metaDescription: (dayLabel, movies, showtimes) =>
      `Cinema listings for Novi Sad and Belgrade for ${dayLabel}: ${movies} films, ${showtimes} showtimes. Refreshed several times a day.`,

    dayNavLabel: 'Choose a day',
    cityNavLabel: 'Choose a city',
    cityNoScript: (city) => `Changing city needs JavaScript; showing ${city}.`,
    langNavLabel: 'Page language',

    audioGroupLabel: 'Screening language',
    audioAll: 'All',
    audioDubbedOption: 'Dubbed',
    audioSubtitledOption: 'Not dubbed',
    audioSubtitledOptionTitle:
      'Subtitled films, domestic Serbian films, and showtimes with no stated language',
    kids: 'For kids',
    searchLabel: 'Search films…',

    counts: (movies, showtimes) =>
      `${movies} ${movies === 1 ? 'film' : 'films'} · ${showtimes} ${
        showtimes === 1 ? 'showtime' : 'showtimes'
      }`,
    empty: 'No showtimes found for this day.',
    emptyPast: 'No more showtimes today.',
    tomorrowLink: "See tomorrow's listings.",
    startedLabel: 'already started',

    staleIntro: 'Data for some cinemas may be out of date:',
    staleFromCache: (when) => `data comes from an earlier refresh (${when})`,
    staleLastOk: (when) => `last successful refresh: ${when}`,

    installButton: '📲 Install the app',
    installHintHtml: `<p><strong>Android (Chrome):</strong> the ⋮ menu → “Install app”
           or “Add to Home screen”.</p>
        <p><strong>iPhone / iPad (Safari):</strong> the <strong>Share</strong>
           button ↑ → <strong>“Add to Home Screen”</strong>. Safari has no
           automatic install, so this is the only way on iOS.</p>
        <p><strong>Desktop (Chrome / Edge):</strong> the install icon in the
           address bar.</p>`,
    lastUpdate: (when) => `Last refreshed: ${when}.`,
    disclaimerSource:
      'Data is scraped from the cinemas’ own websites. Age ratings and scores are informational and come from TMDb — check the official rating on the cinema’s site.',
    disclaimerAccuracy: 'The data may be wrong. Please check before setting off for the cinema.',
    privacy:
      'Visits are counted anonymously (Cloudflare Web Analytics). No cookies are used and no personal data is collected.',
    scrollTop: 'Back to top',

    posterAlt: (title) => `${title} — poster`,
    trailerExact: 'Watch the trailer',
    trailerSearch: 'Search YouTube for the trailer',
    trailerAria: (title) => `Trailer for ${title}`,

    ageUnknown: 'Age rating unknown',
    ageUnknownTitle: 'No source publishes an age rating for this film',
    ageOfficial: (source) => `Official rating (${source})`,
    ageEstimate: 'Estimated from genre — not an official rating',
    ageEstimateSuffix: ' (estimate)',

    runtimeShort: 'Short — under 90 minutes',
    runtimeMedium: 'Medium — between 90 minutes and 2 hours',
    runtimeLong: 'Long — 2 hours or more',
    runtimeHours: (hours, minutes) => `${hours} h ${minutes} min`,
    runtimeMinutes: (minutes) => `${minutes} min`,

    scoreTitle: (source, votes) => `Audience score on ${source} — ${votes} votes`,

    audioLabelDubbed: 'dubbed',
    audioLabelSubtitled: 'subtitled',
    audioLabelOriginal: 'domestic film',
    audioLabelUnknown: 'not stated',
    audioShortDubbed: 'dub.',
    audioShortSubtitled: 'sub.',
    audioShortOriginal: 'dom.',
    audioShortUnknown: '?',

    pluralMovies: '{n} film|{n} films',
    pluralShowtimes: '{n} showtime|{n} showtimes',
    pluralUnknownAudio:
      '{n} showtime has no stated language and is hidden|{n} showtimes have no stated language and are hidden',
  },
};

/** The other language — there are only two, and the switcher needs the opposite. */
export function otherLang(lang: Lang): Lang {
  return lang === 'sr' ? 'en' : 'sr';
}
