# Copilot instructions — Kokice (Serbian cinema aggregator)

**Read [`REQUIREMENTS.md`](../REQUIREMENTS.md) before making any change to this
repository.** It is the baseline specification: every requirement in it is
implemented and verified against the live cinema websites. If a change breaks
one, that is a regression, not a refactor. Reference requirement ids (`R-10.3`)
in commit messages and PR descriptions when a change touches them.

## What this is

A static site, rebuilt hourly by GitHub Actions and served by GitHub Pages, that
scrapes and merges showtimes from **nine cinema venues across Novi Sad and
Beograd** (Arena, Cineplexx, CineStar), enriches them via TMDb, and renders one
Serbian-language HTML page per day. The app is named **Kokice**; the repository
keeps its old name on purpose until the domain move (R-13.8).

## Non-negotiable constraints

- **No runtime server, database, or frontend framework.** The build produces
  plain HTML/CSS/JS. There must be nothing to keep alive.
- **TMDb is enrichment, never a hard dependency.** The build must fully succeed
  with no API key — titles then merge by fuzzy matching and age badges read
  "Uzrast nepoznat".
- **Dubbing is a property of the showtime, not the film.** The same film runs
  dubbed in the afternoon and subtitled in the evening, so the dubbed filter
  hides individual chips and only then empties cards.
- **`CinemaId` is a venue, not a chain.** Beograd has five Cineplexx venues;
  collapsing them would show Delta City and Galerija as one building. Chain-level
  facts such as metadata trust live on `Cinema.chain`.
- **City is a property of the cinema block**, so the city switch is one more
  condition in the existing `apply()` loop, not a second mechanism.
- **Every city but the default renders pre-hidden; JS only reveals.** Unlike the
  other filters, a no-JS superset here would be actively wrong — a Novi Sad
  reader must never see Belgrade showtimes.
- **All dates are Europe/Belgrade.** Off-by-one days are the classic bug here.
- **Never present a guessed age rating as fact.** Heuristic ratings are marked
  `confident: false` and shown as such.

## Data-accuracy rules learned from auditing the live sites

These look like trivia, but each one was a real bug. See §10 of
`REQUIREMENTS.md` for the full list and evidence.

- Premium formats compose with 3D: `4DX/3D/TITL` is `"4DX 3D"`, not `"4DX"`.
- Arena's detail block is positional prose, so a film with no original title
  shows its **director** in that slot. Arena also **rounds** runtimes. Hence the
  metadata trust order **cineplexx → cinestar → arena**.
- Arena's detail rows run together (`RSGodina proizvodnje`), so parse by reading
  the `<strong>` label's own container, not with a regex over the body text.
- `DS` in an Arena title is **not** a dubbing marker.
- CineStar's `.age` field contains **genre**, not an age rating.
- Domestic Serbian films are `audio: 'original'` ("domaći film"), never
  "titlovano" — and the remap happens at merge level so all cinemas agree.
- **The page is Serbian Latin, never Cyrillic.** TMDb's `sr-RS` responses are
  Cyrillic, converted at the TMDb boundary and again inside `escapeHtml`. Use
  `toSerbianLatin()` (keeps diacritics) for display, never `transliterate()`
  (folds them, for matching only). This was not cosmetic: Cyrillic `Хорор` and
  `Трилер` matched nothing in the Latin-only `ADULT_GENRES`, so the age
  heuristic silently produced no estimate at all.
- CineStar is behind a Cloudflare TLS-fingerprint challenge and 403s from CI, so
  it alone uses `tlsFallback: true` (retry via `curl_cffi`); headers and even
  headless Chromium do not help (R-2.7a). A scraper can fail in CI while passing
  locally — read the Actions log, don't re-run locally.
- Trailer language order is **sr → sh/hr/bs → en** and is already correct. TMDb
  held **zero** `sr` trailers across 33 films, so Croatian ones are a legitimate
  fallback — read the build's `Trejleri:` line before touching the ranking.

## Analytics (§16)

- Cloudflare Web Analytics, kept specifically because it is **cookieless** —
  that is what spares the site a consent banner. Don't swap in anything that
  stores an id on the device.
- The beacon must keep `type="module"`, mirroring Cloudflare's own snippet:
  `beacon.min.js` is an ES module, so a classic `defer` script risks failing at
  parse time. Modules defer by default, so rendering is still unblocked.
- `CF_BEACON_TOKEN` is a repository **variable** and is visible in the published
  HTML **by design** — the visitor's browser reports the view. That is not a
  leak, and making it a secret would only hide it from logs, not from the page.
- No token ⇒ no beacon and no footer note, build unaffected. That's the off switch.

## Working in this repo

- `npm test` (102 tests, no network — fixtures only) and `npx tsc --noEmit` must
  both pass before committing.
- `npm run build` scrapes live and writes `dist/`; `npm run serve` serves it on
  localhost:3000.
- Adapters stay isolated with fixture-based tests, so a site's HTML change
  breaks one cinema visibly rather than the whole build.
- Add a regression test for every parsing bug fixed, and make the fixture match
  the **real** markup shape — a simplified fixture once passed while the parser
  was broken on the live page.
- CSS badge modifier rules must stay *after* the base `.badge` rule, or its
  `color` wins.
