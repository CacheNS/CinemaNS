# AGENTS.md

**Read [`REQUIREMENTS.md`](REQUIREMENTS.md) first.** It is the baseline
specification for this repository — every requirement in it is implemented and
verified against the live cinema websites. Breaking one is a regression, not a
refactor. Requirements have stable ids (`R-10.3`); cite them in commits and PRs.

For the condensed version, see
[`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## What this is

A static site, rebuilt by GitHub Actions and served by GitHub Pages, that
scrapes and merges movie showtimes from **ten cinema venues across Novi Sad and
Beograd**, enriches them via TMDb, and renders one Serbian-language page per day
plus a reusable `data.json`. The app is called **Kokice**; the repository keeps
its old name deliberately (R-13.8).

The cron asks for hourly, but GitHub dispatches it **2-6 times a day** (measured
2026-09-02 across 220 runs: mean gap 4.3 h, and only one run fired at the
requested `:07`). The workflow itself is healthy - zero cancelled runs, ~2 min
each - so this is GitHub's scheduler, not the repository. **No page copy may
claim an hourly refresh** (R-2.6a); the footer's build timestamp is the only
exact freshness claim.

## Commands

```
npm test          # 152 tests, fixtures only, no network
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
- Dubbing is a property of the **showtime**, not the film, so the audio filter
  hides individual chips before emptying cards.
- The audio filter is a **single three-state radio group** (`?audio=`), not a
  pair of checkboxes: Svi / Sinhro. / Bez sinhro. (R-7.1a). "Bez sinhro."
  hides only a confirmed `dubbed` chip — `subtitled`, `original` and `unknown`
  all survive it, which is exactly why it is not called "Titlovano" (R-7.1b).
- `CinemaId` identifies a **venue**, not a chain — Beograd has five Cineplexx
  venues, and collapsing them would merge Delta City with Galerija. Chain-level
  facts (metadata trust) live on `Cinema.chain`.
- City is a property of the **cinema block**, so switching city reuses the same
  `apply()` loop as the filters.
- **Today's page keeps a screening for 60 minutes after it starts**, then hides
  it — in the browser, Belgrade time, today only (`GRACE_MINUTES`, R-7c.2). The
  chains disagree about how much of the past they publish, so consistency is our
  rule, not theirs. A chip inside the grace window is muted via `data-started`
  (R-7c.2a) rather than struck through, since it is still a live booking link.
  Late in the evening the page legitimately goes empty.
- Every city but the default renders pre-hidden and JS only ever *reveals*. A
  no-JS reader must get a correct single-city page, never a mix.
- A search box above the listing filters `.movie` cards instantly on keystroke,
  matching Serbian and original title with the same `transliterate()` folding
  used for cross-cinema matching (R-7.9). Like the other filters (R-7.5), the
  typed term round-trips through `?q=` in the URL, so it survives a day-tab
  navigation — which reloads the page — the same way the city switch already
  survives it by never navigating at all.
- All dates are Europe/Belgrade.
- Never present a guessed age rating as fact.

## Data-accuracy rules (each one was a real bug)

- `4DX/3D/TITL` ⇒ `"4DX 3D"`; premium formats compose with 3D.
- Metadata trust order is **cineplexx → cinestar → tuck → arena**: Arena's film
  page is positional prose that yields the *director* when a film has no
  original title, and it rounds runtimes. Tuck labels its fields explicitly
  like Cineplexx/CineStar, so it outranks Arena but stays below the two
  longer-audited sources.
- Parse Arena's detail rows via the `<strong>` label's own container — the rows
  run together (`RSGodina proizvodnje`), so a body-text regex fails.
- `DS` in an Arena title is not a dubbing marker.
- **Booking chips must reach a page that can sell that ticket** (§8.1a).
  Cineplexx's is `/purchase/wizard/<cinemaId>-<sessionId>` — `/movie/<slug>` is
  a 404, the site uses `/film/<slug>`. Arena's ticket host is forced to HTTPS.
- Arena's `00:00` rows whose booking link stops at `/numSale/index/` with no
  screening id are leftover placeholders. Drop them by the **missing id**, never
  by the time — a genuine midnight screening looks identical otherwise.
- CineStar's `.age` field holds genre, not an age rating.
- Tuck's booking link is per **movie**, not per session — the same
  `ulaznice.tuck.rs/rs/site/repertoireDetail/index/<id>` link repeats on every
  day cell for a film, because the listing page has no per-session id. Its
  ticket host is HTTP-only (`https://` on it hangs), unlike Arena's, which
  upgrades cleanly — `tuckUrl()` allow-lists `http://ulaznice.tuck.rs` as-is.
- Domestic Serbian films are `audio: 'original'` ("domaći film"), remapped at
  merge level so all cinemas agree. Only Arena publishes the country and Arena
  is Novi-Sad-only, so TMDb's `original_language == 'sr'` is a second signal
  (R-10.5.1). Serbian only — a Croatian film is not "domaći".
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
- **The beacon is injected by Cloudflare at the edge, not by the build** (§16.3).
  `kokice.org` is proxied, so the repository holds no token, no variable and no
  analytics code. Do not add a beacon tag back: with edge injection already
  running, a tag in the built HTML double-counts every visit (§16.4).
- **Do not remove the `cloudflareinsights.com` entries from the `CSP` const in
  `html.ts`** (§16.5). Nothing in the repository references those hosts any
  more, so they look like dead allowances. Deleting them breaks nothing
  visibly — the build passes and the dashboard still says enabled — while
  `default-src 'none'` silently blocks the injected script and the count stays
  at zero. `html.test.ts` pins both directives.
- A site tag visible in the served HTML is **by design**, not a leak: the
  visitor's browser is what reports the view. It grants no account access; the
  only abuse is faking page views.
- Analytics stops if a record is set to DNS-only — which is also the standard
  remedy for a failed certificate renewal behind the proxy (§13.11).

## Conventions

- Adapters stay isolated with fixture-based tests, so a site's HTML change
  breaks one cinema visibly rather than the whole build.
- Add a regression test for every parsing bug fixed, and make the fixture
  reproduce the *real* markup — a simplified fixture once passed while the
  parser was broken against the live page.
- CSS badge modifier rules must stay after the base `.badge` rule.
- **Showtime chips are never coloured by audio** (R-8.3a). The removed
  `showtime--dubbed` / `showtime--original` border tints read as a status
  signal, not a language one, and nothing on the page explained them; the
  audio is already written on the chip (R-8.3) and filterable (R-7.1a). The
  grace-window muting of R-7c.2a is now the only border variation a chip has,
  which is what makes it legible. `data-audio` stays — the filter reads it.
- A badge's classes go on the single outermost element, never on a `<span>`
  nested inside a wrapping `<a>`. `.badges` is a flex row with the default
  `align-items: stretch`, so only a direct flex child gets stretched to match
  its siblings' height — a nested badge renders visibly shorter (R-15.4a).
- The service worker's cache-key `VERSION` (`sw.js`) is derived from
  `style.css` + `app.js` content by `renderServiceWorker()` in `build.ts`,
  never a hand-bumped literal — a forgotten manual bump once left returning
  users on stale cached assets while the network-first HTML had already
  moved on (R-9.7a).
- `sw.js` is registered as `sw.js?v=<hash>` (same hash as R-9.7a, embedded in
  every page as `<meta name="sw-version">`), because GitHub Pages serves
  `sw.js` itself with a multi-hour `Cache-Control` — a browser can keep
  re-installing the *old* worker straight from its own HTTP cache without
  ever fetching the new bytes. Only "clear site data" fixed it for a real
  visitor. A version-tagged URL was never cached before, so it always reaches
  the network (R-9.7b).

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
- **CineStar's booking/detail links are origin-restricted, same as Arena's**
  (R-17.6a). A scraped `https://` href is no longer trusted just because it
  parses — `cinestarUrl()` rejects anything that doesn't resolve back to
  `cinestarcinemas.rs`.
- **The page has a strict CSP and therefore no inline script or style**
  (R-17.9). Adding either breaks the site; a test asserts their absence.
- **Fetches are size-capped, deadline-bound and redirect-capped** (R-17.3–4),
  and the `curl_cffi` child is killed after 60 s (R-17.5).
- **Arena URLs are origin-allow-listed** (R-17.6) because Arena is fetched over
  plaintext HTTP and cannot be upgraded.
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
