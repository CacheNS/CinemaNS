# AGENTS.md

**Read [`REQUIREMENTS.md`](REQUIREMENTS.md) first.** It is the baseline
specification for this repository — every requirement in it is implemented and
verified against the live cinema websites. Breaking one is a regression, not a
refactor. Requirements have stable ids (`R-10.3`); cite them in commits and PRs.

For the condensed version, see
[`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## What this is

A static site, rebuilt hourly by GitHub Actions and served by GitHub Pages, that
scrapes and merges movie showtimes from **nine cinema venues across Novi Sad and
Beograd**, enriches them via TMDb, and renders one Serbian-language page per day
plus a reusable `data.json`. The app is called **Kokice**; the repository keeps
its old name deliberately (R-13.8).

## Commands

```
npm test          # 102 tests, fixtures only, no network
npx tsc --noEmit  # must be clean
npm run build     # scrapes live, writes dist/
npm run serve     # serves dist/ on http://localhost:3000
npm run report    # scrape + diagnostics, no render
```

Both `npm test` and `npx tsc --noEmit` must pass before committing.

## Hard constraints

- No runtime server, database or frontend framework — the design exists
  specifically to have nothing to keep alive.
- TMDb is enrichment, never a hard dependency: the build must fully succeed with
  no API key (it currently runs without one).
- Dubbing is a property of the **showtime**, not the film, so the dubbed filter
  hides individual chips before emptying cards.
- `CinemaId` identifies a **venue**, not a chain — Beograd has five Cineplexx
  venues, and collapsing them would merge Delta City with Galerija. Chain-level
  facts (metadata trust) live on `Cinema.chain`.
- City is a property of the **cinema block**, so switching city reuses the same
  `apply()` loop as the filters.
- Every city but the default renders pre-hidden and JS only ever *reveals*. A
  no-JS reader must get a correct single-city page, never a mix.
- All dates are Europe/Belgrade.
- Never present a guessed age rating as fact.

## Data-accuracy rules (each one was a real bug)

- `4DX/3D/TITL` ⇒ `"4DX 3D"`; premium formats compose with 3D.
- Metadata trust order is **cineplexx → cinestar → arena**: Arena's film page is
  positional prose that yields the *director* when a film has no original title,
  and it rounds runtimes.
- Parse Arena's detail rows via the `<strong>` label's own container — the rows
  run together (`RSGodina proizvodnje`), so a body-text regex fails.
- `DS` in an Arena title is not a dubbing marker.
- CineStar's `.age` field holds genre, not an age rating.
- Domestic Serbian films are `audio: 'original'` ("domaći film"), remapped at
  merge level so all cinemas agree.
- The page is Serbian **Latin**, never Cyrillic (R-8.12). TMDb's `sr-RS` text is
  Cyrillic; it is converted at the TMDb boundary and again in `escapeHtml`. Use
  `toSerbianLatin()` for display — `transliterate()` folds diacritics and is for
  matching only. Cyrillic genres had silently broken the age heuristic, since
  `ADULT_GENRES` is Latin-only (R-10.12).
- CineStar is behind a Cloudflare TLS-fingerprint challenge and 403s from CI, so
  it alone uses `tlsFallback: true` (retry via `curl_cffi`); browser headers and
  even headless Chromium do not clear it (R-2.7a). 403 is retryable.
  A scraper can fail in CI while passing locally — read the Actions log.
- Trailer language order is **sr → sh/hr/bs → en**, and it is already correct.
  Measured across 33 films, TMDb held **zero** `sr` trailers, so posters legitimately
  open Croatian ones. Check the build's `Trejleri:` line before "fixing" the
  ranking (R-8.10).
- Cineplexx venue numbers are resolved from `/api/v1/cinemas` by `cinemaUrlName`
  at scrape time. Never hardcode them: the live ids are non-contiguous (`1114`
  and `1117` do not exist), so an assumed id silently scrapes the wrong cinema.
- Arena exists only in Novi Sad — its site has no location selector at all. Do
  not try to parameterize it by city.

## Analytics (§16)

- Cloudflare Web Analytics, chosen because it is **cookieless** — that is what
  keeps the site free of a consent banner. Do not replace it with anything that
  stores an id on the device.
- The beacon tag must mirror Cloudflare's issued snippet, including
  `type="module"`. `beacon.min.js` is an ES module; a classic `defer` script
  risks a parse-time failure. Modules are deferred by default, so nothing blocks.
- `CF_BEACON_TOKEN` is a repository **variable**, not a secret, and appears in
  the published HTML by design — the visitor's browser is what reports the view.
  **That is not a leak.** Moving it to a secret would hide it in logs while
  leaving it just as visible on the site. It grants no account access; the only
  abuse is faking page views.
- No token ⇒ no beacon, no footer note, build unaffected. That is the off switch.

## Conventions

- Adapters stay isolated with fixture-based tests, so a site's HTML change
  breaks one cinema visibly rather than the whole build.
- Add a regression test for every parsing bug fixed, and make the fixture
  reproduce the *real* markup — a simplified fixture once passed while the
  parser was broken against the live page.
- CSS badge modifier rules must stay after the base `.badge` rule.
