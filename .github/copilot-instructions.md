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
- **Today's page hides screenings that have already started**, strictly and in
  the browser (Belgrade time, today only). The chains disagree about how much of
  the past they publish, so this consistency is our rule, not theirs — and late
  in the evening today's page legitimately goes empty.
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
- **Booking chips must reach a page that can sell that ticket.** Cineplexx's is
  `/purchase/wizard/<cinemaId>-<sessionId>`; `/movie/<slug>` is a 404 (the site
  uses `/film/<slug>`). Arena's ticket host is forced to HTTPS.
- Arena's `00:00` rows whose booking link stops at `/numSale/index/` with no
  screening id are leftover placeholders. Drop them by the **missing id**, never
  by the time — a genuine midnight screening looks identical otherwise.
- CineStar's `.age` field contains **genre**, not an age rating.
- Domestic Serbian films are `audio: 'original'` ("domaći film"), never
  "titlovano" — and the remap happens at merge level so all cinemas agree.
  Only Arena publishes the country of production and Arena is Novi-Sad-only, so
  TMDb's `original_language == 'sr'` backs it up in Beograd (R-10.5.1). Serbian
  only: a Croatian film plays untranslated but is not "domaći".
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
- **The beacon is injected by Cloudflare at the edge, not by the build.** The
  domain is proxied, so there is no token, no variable and no analytics code in
  this repository. Don't add a beacon tag back — it would double-count.
- **Don't remove `cloudflareinsights.com` from the `CSP` const in `html.ts`.**
  Nothing here references those hosts any more, so the two allowances look
  dead. They aren't: deleting them leaves analytics enabled in the dashboard and
  silently counting nothing, because `default-src 'none'` blocks the injected
  script. A test in `html.test.ts` pins both directives.
- A site tag visible in the served HTML is **by design**, not a leak — the
  visitor's browser is what reports the view.
- Analytics dies if a DNS record is set to DNS-only, which is also the standard
  remedy for a failed certificate renewal behind the proxy (§13).

## Working in this repo

- `npm test` (119 tests, no network — fixtures only) and `npx tsc --noEmit` must
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

## Security (§17)

A three-agent review found 0 critical and 0 high issues. What it hardened, and
what a well-meaning change could undo:

- **The realistic attacker is an upstream cinema site, not a visitor** (R-17.1).
  No login, no database, no server. Do not import fixes for threats this design
  does not have.
- **`safeUrl()` guards every `href`/`src`** (R-17.8). `escapeHtml` does not stop
  `javascript:` — it contains nothing to escape. A rejected booking URL falls
  back to the venue programme, never to nothing.
- **The page has a strict CSP and therefore no inline script or style**
  (R-17.9). Adding either breaks the site; a test asserts their absence.
- **Fetches are size-capped, deadline-bound and redirect-capped** (R-17.3–4),
  and the `curl_cffi` child is killed after 60 s (R-17.5).
- **Arena URLs are origin-allow-listed** (R-17.6) because Arena is fetched over
  plaintext HTTP and cannot be upgraded.
- **Titles are capped at 300 chars** before the quadratic regexes (R-17.7).
- **Workflow permissions are per job** (R-17.12): `build` runs the scraper with
  no write access; `persist` and `deploy` hold one permission each. `deploy`
  must never depend on `persist` (R-17.13).
- **The `data/raw.json` commit is load bearing** (R-17.14) — it is also what
  stops GitHub disabling the hourly schedule. Do not replace it with a cache.
- **Actions are SHA-pinned and `npm ci` runs `--ignore-scripts`** (R-17.15–16).
- **TLS verification is intact** (R-17.18). The impersonation replays a Chrome
  handshake fingerprint and nothing more — do not "fix" it away.
