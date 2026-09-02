# Copilot instructions — Kokice (Serbian cinema aggregator)

**Read [`REQUIREMENTS.md`](../REQUIREMENTS.md) before making any change to this
repository.** It is the baseline specification: every requirement in it is
implemented and verified against the live cinema websites. If a change breaks
one, that is a regression, not a refactor. Reference requirement ids (`R-10.3`)
in commit messages and PR descriptions when a change touches them.

## What this is

A static site, rebuilt by GitHub Actions and served by GitHub Pages, that
scrapes and merges showtimes from **ten cinema venues across Novi Sad and
Beograd** (Arena, Cineplexx, CineStar, Tuck), enriches them via TMDb, and
renders one Serbian-language HTML page per day. The app is named **Kokice**;
the repository keeps its old name on purpose until the domain move (R-13.8).

The cron asks for hourly but GitHub dispatches it **2-6 times a day** (measured:
mean gap 4.3 h, zero cancelled runs, ~2 min each - it is GitHub's scheduler, not
this repo). **No page copy may claim an hourly refresh** (R-2.6a); the footer's
build timestamp is the only exact freshness claim.

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
- **The search box's term lives in the URL (`?q=`), like the other filters.**
  It filters instantly on keystroke and survives a day-tab switch (a real page
  navigation) the same way the dubbed/kids checkboxes already do, and the same
  way the city switch survives by never navigating at all (R-7.9).
- **All dates are Europe/Belgrade.** Off-by-one days are the classic bug here.
- **Never present a guessed age rating as fact.** Heuristic ratings are marked
  `confident: false` and shown as such.

## Data-accuracy rules learned from auditing the live sites

These look like trivia, but each one was a real bug. See §10 of
`REQUIREMENTS.md` for the full list and evidence.

- Premium formats compose with 3D: `4DX/3D/TITL` is `"4DX 3D"`, not `"4DX"`.
- Arena's detail block is positional prose, so a film with no original title
  shows its **director** in that slot. Arena also **rounds** runtimes. Hence the
  metadata trust order **cineplexx → cinestar → tuck → arena**: Tuck labels its
  fields explicitly like Cineplexx/CineStar, so it outranks Arena but stays
  below the two longer-audited sources.
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
- Tuck's booking link is per **movie**, not per session — the same
  `ulaznice.tuck.rs/.../repertoireDetail/index/<id>` link repeats on every day
  cell for a film, since the listing has no per-session id. Its ticket host is
  **HTTP-only** (`https://` hangs), unlike Arena's, which upgrades cleanly —
  `tuckUrl()` allow-lists `http://ulaznice.tuck.rs` as-is, with no upgrade.
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

- `npm test` (152 tests, no network — fixtures only) and `npx tsc --noEmit` must
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
- A badge's classes belong on the single outermost element, never on a `<span>`
  nested inside a wrapping `<a>`. `.badges` is a flex row with the default
  `align-items: stretch`, so only a direct flex child stretches to match its
  siblings' height — nest one and it renders visibly shorter (R-15.4a).
- The service worker's cache-key `VERSION` (`sw.js`) is derived from
  `style.css` + `app.js` content by `renderServiceWorker()` in `build.ts`,
  never a hand-bumped literal — a forgotten manual bump once left returning
  users on stale cached assets while the network-first HTML had already
  moved on (R-9.7a).
- `sw.js` is registered as `sw.js?v=<hash>` (the same hash, embedded in every
  page as `<meta name="sw-version">`), because GitHub Pages serves `sw.js`
  itself with a multi-hour `Cache-Control` — a browser can keep re-installing
  the *old* worker straight from its own HTTP cache without ever fetching the
  new bytes, and only "clear site data" fixed it for a real visitor. A
  version-tagged URL was never cached before, so it always reaches the
  network (R-9.7b).

## Security (§17)

A three-agent review found 0 critical and 0 high issues. What it hardened, and
what a well-meaning change could undo:

- **The realistic attacker is an upstream cinema site, not a visitor** (R-17.1).
  No login, no database, no server. Do not import fixes for threats this design
  does not have.
- **`safeUrl()` guards every `href`/`src`** (R-17.8). `escapeHtml` does not stop
  `javascript:` — it contains nothing to escape. A rejected booking URL falls
  back to the venue programme, never to nothing. Tab/newline/CR are stripped
  before the scheme and `//`-prefix checks, matching what a URL parser strips
  before reading the scheme — otherwise `"jav\tascript:alert(1)"` bypasses a
  naive scheme regex entirely.
- **The page has a strict CSP and therefore no inline script or style**
  (R-17.9). Adding either breaks the site; a test asserts their absence.
- **Fetches are size-capped, deadline-bound and redirect-capped** (R-17.3–4),
  and the `curl_cffi` child is killed after 60 s (R-17.5).
- **Arena URLs are origin-allow-listed** (R-17.6) because Arena is fetched over
  plaintext HTTP and cannot be upgraded.
- **CineStar's booking/detail links are origin-restricted, same as Arena's**
  (R-17.6a). A scraped `https://` href is no longer trusted just because it
  parses — `cinestarUrl()` rejects anything that doesn't resolve back to
  `cinestarcinemas.rs`.
- **Tuck's ticket host is allow-listed too, but never upgraded to HTTPS**
  (R-17.6b) — `https://ulaznice.tuck.rs` hangs (nothing listens on 443), so
  `tuckUrl()` keeps `http://ulaznice.tuck.rs` as-is instead of producing a
  dead `https://` chip.
- **Titles are capped at 300 chars** before the quadratic regexes (R-17.7).
- **Workflow permissions are per job** (R-17.12): `build` runs the scraper with
  no write access; `persist`, `deploy` and `alert` each hold one permission.
  `deploy` must never depend on `persist` (R-17.13).
- **The `data/raw.json` commit is load bearing** (R-17.14) — it is also what
  stops GitHub disabling the hourly schedule. Do not replace it with a cache.
  `data/health.json` rides in the same commit: it is the consecutive-failure
  counter behind R-11.9's alerting, and a cache write would silently reset it.
- **A degraded source only alerts after two consecutive failures** (R-11.9),
  via a `source-down`-labelled GitHub issue that `alert` opens/edits/closes —
  not a Slack/webhook or any new secret. Don't lower the threshold to one
  build; that is the single-blip noise it exists to avoid (R-11.8).
- **Actions are SHA-pinned and `npm ci` runs `--ignore-scripts`** (R-17.15–16).
- **TLS verification is intact** (R-17.18). The impersonation replays a Chrome
  handshake fingerprint and nothing more — do not "fix" it away.
