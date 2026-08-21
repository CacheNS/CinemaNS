# Requirements — Kokice

The baseline specification for this project. Every requirement below is
currently implemented unless explicitly marked **OPEN**. Treat this as the
contract for future changes: if a change breaks one of these, it is a
regression, not a refactor.

Each requirement has a stable id (`R-*`) so changes can reference it.

---

## 1. Purpose and scope

**R-1.1** One page that shows what is playing in a chosen city's cinemas, merged
across all of that city's cinemas and grouped by movie.

**R-1.2** Covers exactly nine venues across two cities. Venue coverage was
verified against the live sites and APIs; it is not a guess.

**Novi Sad**

| Venue id | Display name | Source |
|---|---|---|
| `arena-novi-sad` | **Arena Centar** | `arenacineplex.com` (server-rendered HTML) |
| `cineplexx-novi-sad` | **Cineplexx Promenada** | `app.cineplexx.rs/api/v1` (JSON API) |
| `cinestar-novi-sad` | **CineStar BIG** | `cinestarcinemas.rs/novi-sad-big` (HTML) |

**Beograd**

| Venue id | Display name | Source |
|---|---|---|
| `cineplexx-delta-city` | **Cineplexx Delta City** | Cineplexx API |
| `cineplexx-usce` | **Cineplexx Ušće** | Cineplexx API |
| `cineplexx-big-beograd` | **Cineplexx BIG** | Cineplexx API |
| `cineplexx-beo` | **Cineplexx BEO** | Cineplexx API |
| `cineplexx-galerija` | **Cineplexx Galerija** | Cineplexx API |
| `cinestar-beograd-ada` | **CineStar Ada Mall** | `cinestarcinemas.rs/beograd-concept-cinema-ada-mall` |

**R-1.2.1** Arena Cineplex exists **only in Novi Sad** — `arenacineplex.com` has
no location selector at all, the whole site is one cinema. The cinema set is
genuinely per-city, not a chain list filtered by city.

**R-1.2.2** Niš and Subotica have none of these three chains and cannot be added
without an entirely new adapter.

**R-1.3** The cinema's location must always be part of its displayed name
(BIG / Centar / Promenada / Ada Mall / Delta City). Never show a bare brand
name — with five Cineplexx venues in Beograd, "Cineplexx" alone is meaningless.

**R-1.4** Covers today plus the next 7 days (8 days total).

**R-1.5** The UI is in Serbian (Latin script).

---

## 2. Non-functional requirements

**R-2.1 Freshness.** Data is refreshed on a **1-hour interval**.

**R-2.2 Speed.** Pages must be fast. No scraping on the request path, no cold
starts. This is why the site is static.

**R-2.3 Capacity.** Must serve at least 100 requests/day. (A CDN makes this
trivially satisfied; do not add infrastructure for it.)

**R-2.4 Cost.** Zero hosting cost.

**R-2.5 No server process.** There must be nothing to keep alive, restart or
monitor. The worst failure mode is a *stale* site, never a *down* site.

**R-2.6 Honest freshness.** The footer shows the actual build time, so "hourly"
is stated as fact rather than implied. GitHub's cron can be delayed; the site
must not pretend otherwise.

**R-2.7 Politeness.** One refresh per hour, sequential per host, small delay,
descriptive User-Agent. Arena requires N+1 requests (one page per film).

**R-2.7a CineStar needs a browser TLS fingerprint, not just browser headers.**
`cinestarcinemas.rs` sits behind a Cloudflare **managed challenge** that
fingerprints the TLS handshake. It scrapes fine from a home connection with any
User-Agent, including none, but returns **HTTP 403 with a "Just a moment…"
body** from a GitHub Actions runner. Measured on the runner (`52.234.41.68`):

| Method | Result |
|---|---|
| Node `fetch`, plain | 403 challenge |
| `curl` with full browser headers | 403 challenge |
| Same, forced HTTP/1.1 | 403 challenge |
| `www.` hostname | 403 challenge |
| **Headless Chromium (Playwright)** | **403 challenge** |
| `robots.txt` (any client) | 200 — the rule is path-scoped |
| **`curl_cffi`, `impersonate="chrome"`** | **200, full 265 KB page** |

Headers cannot fix this, and neither can a real headless browser. CineStar is
therefore fetched with `tlsFallback: true`: an ordinary Node fetch first, and on
403 only, a retry through `curl_cffi`, which replays a Chrome handshake. Arena
and Cineplexx keep the honest `Kokice` User-Agent. Do not enable `tlsFallback`
elsewhere without the same evidence.

**R-2.7a-i The fallback is optional, never required.** It shells out to Python +
`curl_cffi`, installed by a `continue-on-error` CI step. When absent,
`fetchText` re-throws the original 403, so the failure reads as "CineStar
refused us" rather than "Python is missing", and the build degrades to
CineStar's last good data (R-11.2). `KOKICE_DISABLE_IMPERSONATE=1` forces it
off, which is how the tests stay offline.

**R-2.7a-ii Confirmed in CI for both CineStar venues.** The first production
build after Beograd was added scraped `cinestar-novi-sad` (276 showtimes) and
`cinestar-beograd-ada` (211) from a GitHub Actions runner. The challenge is
per-host, not per-venue, so one `tlsFallback` covers every CineStar location.

**R-2.7b A 403 is retryable.** Unlike other 4xx codes, a 403 from bot
protection is a scoring decision about the caller rather than a statement about
the resource, so it gets the same backoff retry as 429 and 5xx.

---

## 3. Architecture (fixed decisions)

**R-3.1** Static site, built hourly by **GitHub Actions**, served by **GitHub
Pages**. No runtime, no database.

**R-3.2** Node.js + TypeScript build. No frontend framework. Hand-written CSS.
Client-side JS is limited to filters, install UX and service-worker
registration.

**R-3.3** Local and production run the **same build script**, so what is
verified locally is what Pages serves.

**R-3.4** Output shape:

```
dist/
  index.html                 # today
  YYYY-MM-DD.html            # one page per remaining day
  data.json                  # full merged snapshot
  manifest.webmanifest
  sw.js
  icon-{192,512,maskable-512,180}.png
  assets/style.css
  assets/app.js
```

**R-3.5** One static page per day means day tabs are ordinary links and work
with JavaScript disabled.

**R-3.6** Commands: `npm run build`, `npm run serve` (localhost:3000),
`npm run report` (diagnostics), `npm run build -- --offline` (fixtures).

---

## 4. Data model

**R-4.1** `Showtime` carries: `cinemaId`, `date`, `time`, `format`, `audio`,
optional `hall`, and a `bookingUrl` deep-linking into that cinema's booking
flow.

**R-4.2** `audio` is one of `dubbed | subtitled | original | unknown`.
`original` means a domestic (Serbian-language) film that is neither dubbed nor
subtitled.

**R-4.3** `Movie` carries: merge `key`, optional `tmdbId`, display `title`,
`originalTitle`, `posterUrl`, `runtimeMinutes`, `genres`, `ageRating`,
`kidFriendly`, `hasDubbed`, `aliases` (every raw title seen anywhere, for
debugging) and showtimes grouped by date.

**R-4.4** `Snapshot` carries `generatedAt`, the 8 `days`, `movies`, a
per-venue `sources` record with `ok` / `fetchedAt` / `error`, and the `cities`
registry so `data.json` is self-describing about which venue sits where.

**R-4.5** `data.json` is a public, reusable artifact — it must stay a complete
representation of the snapshot, not a UI-shaped subset. It is still published at
`dist/data.json`, but is **not linked from the page footer**: it is a developer
artifact, and the footer is read by cinema-goers.

**R-4.6** All date/time parsing is pinned to **Europe/Belgrade** to avoid
off-by-one days.

**R-4.7** `CinemaId` identifies a **venue**, not a chain. Beograd has five
Cineplexx venues; if `cinemaId` meant the chain they would all merge into one
block and show Delta City and Galerija showtimes as though they were the same
building. Chain-level facts live on `Cinema.chain`.

**R-4.8** Metadata trust order is a property of the **chain**
(`cineplexx → cinestar → arena`, R-10.5), so `METADATA_TRUST` keys on `Chain`.
All five Beograd Cineplexx venues must be trusted identically.

**R-4.9** Every venue belongs to exactly one city, and each city's `cinemaIds`
lists only its own venues. The registry is hand-written in two places, so this
is asserted by test rather than assumed.

**R-4.10** Cineplexx venue numbers are resolved at scrape time from
`/api/v1/cinemas` by `cinemaUrlName`, never hardcoded — the live ids are
non-contiguous (`1114` and `1117` do not exist), which is exactly the shape that
makes guessing dangerous.

---

## 5. Cross-cinema movie matching

The core problem: the same film is spelled differently at each cinema and
switches between Serbian and English (`SPAJDERMEN:NOVI-DAN` vs
`Spajdermen: Novi dan 3D` vs `Spider-Man: Brand New Day`).

**R-5.1 Title cleaning.** Lowercase; transliterate Cyrillic → Latin; fold
diacritics (č/ć→c, š→s, ž→z, đ→dj); strip format/version noise (3D, 4DX, IMAX,
ScreenX, GOLD, DS, VIP, OV, sinhronizovano, titlovano, "produžena verzija",
kids, matine); collapse punctuation and whitespace.

**R-5.2 TMDb id is the merge key** when it resolves. Search `sr-RS` first, then
English; score against `title`, `original_title` and alternative titles for
RS/HR/US using Dice similarity (`FUZZY_THRESHOLD = 0.82`); require release year
within ±1 where a year is known.

**R-5.3 Fallback.** Unresolved movies fall back to fuzzy matching on the
normalized title between cinemas. **The app must remain fully usable with no
TMDb key at all.**

**R-5.4 Manual override.** A checked-in `title-overrides.json`
(`rawTitle → tmdbId`) fixes mismatches without a code change.

**R-5.5 Cache.** TMDb resolutions are cached and reused across refreshes, so a
steady-state refresh makes almost no TMDb calls.

**R-5.6 Display title vs. matching title.** `tidyDisplayTitle()` is used for
what the user sees — it strips format noise but **keeps hyphens**
("Spider-Man" must not become "Spider Man"). The aggressive `cleanTitle` is for
matching only.

---

## 6. Age restrictions

**R-6.1** Sourced from TMDb `/movie/{id}/release_dates`, preferring
**RS → HR → SI → DE/AT → GB → US**. The source country is recorded and shown.

**R-6.2** Certifications from different systems are mapped to a numeric
`minAge` so they are comparable and filterable (US `PG-13` → 13, `FSK 16` → 16,
`G`/`U`/`0` → 0).

**R-6.3** TMDb's `adult` flag forces `minAge = 18`.

**R-6.4 Heuristic fallback** (`confident: false`): Animation/Family + dubbed ⇒
kid-friendly; Horror ⇒ 16+; otherwise show **"Uzrast nepoznat"**.

**R-6.5 Never present a guess as fact.** Non-confident ratings are visually
marked, and are marked especially when the "Za decu" filter is active.

**R-6.6** None of the three chains publish a usable age rating — verified.
Cineplexx returns `rating: "o.A."` for every film; Arena and CineStar have no
certification markup. Do not attempt to source age from the cinemas.

---

## 7. Filtering

**R-7.1** Two independent filters, usable simultaneously:
**"Sinhronizovano"** and **"Za decu"**.

**R-7.2 Dubbing is per-showtime, not per-film.** The same film runs dubbed in
the afternoon and subtitled in the evening.

**R-7.3** Therefore the dubbed filter hides **individual showtime chips**, then
hides cinema blocks and movie cards left with nothing visible. Filtering only at
the card level is a defect — it would show a card whose listed times are
actually subtitled.

**R-7.4** "Za decu" is a movie-level property and hides whole cards.

**R-7.5** Filter state lives in the URL query string (`?dubbed=1&kids=1`) so a
filtered view is linkable and survives day-tab navigation.

**R-7.6** A live count ("N filmova / M projekcija") updates with the filters.

**R-7.7 No-JS fallback.** With JavaScript disabled everything is shown
unfiltered. Nothing is broken or empty.

**R-7.8** `audio: 'unknown'` showtimes are excluded by the dubbed filter, but
the UI reports how many were excluded for that reason — a parsing gap must look
like a parsing gap, not an empty schedule.

---

## 7b. City switching

**R-7b.1** The reader picks a city; the whole page is scoped to it. Novi Sad is
the default.

**R-7b.2** One page carries **both cities**, switched client-side with no
reload. Measured, not assumed: a day page is ~50–81 KB raw but compresses
**11–14×**, and GitHub Pages does serve gzip (verified with
`curl -H "Accept-Encoding: gzip"` — `Content-Encoding: gzip`,
`Content-Length: 7020`). Confirmed on production once both cities shipped: a
full day page is **157 KB raw → 10.0 KB over the wire** (15.7×), less than one
poster image.

**R-7b.3 City is a property of the cinema block**, so the switch is one extra
condition inside the existing `apply()` loop rather than a second mechanism.
Card-hiding then falls out for free, exactly as it does for the dubbed filter
(R-7.3).

**R-7b.4 The non-default city is rendered with `hidden` already set, and JS
only ever reveals.** This differs deliberately from R-7.7: with no JS a broader
result is harmless for the dubbed and kids filters, but a Novi Sad reader seeing
Belgrade showtimes mixed in is simply *wrong*. Pre-hiding makes the no-JS page a
correct single-city page.

**R-7b.5** Counts, the empty-state message, the venue subtitle and the
stale-source notices are all **per city**. A Novi Sad reader must never be
warned about a Belgrade outage.

**R-7b.6** City lives in the URL as `?grad=<slug>` and is remembered in
`localStorage`. An explicit URL param **wins over** the stored preference, so a
shared link always shows the recipient what the sender saw. The param rides the
same `syncUrl` path as the filters and propagates across day tabs.

**R-7b.7** The city tabs are real `<a href="?grad=…">` links — shareable and
crawlable — intercepted by JS. Because a static page cannot honour them without
JS, a `<noscript>` note says so rather than leaving a dead control.

**R-7b.8 Merging is global, not per city.** A film playing in both cities is one
`Movie` carrying showtimes from both; the split happens at render. This roughly
halves TMDb lookups, which matters because TMDb is rate-limited and the build
runs hourly.

**R-7b.9 Accepted trade-off:** a single combined page cannot have a
city-specific `<title>`/`<h1>`, so it will not rank for "bioskopi u beogradu".
This is the known price of instant switching. If search traffic later outweighs
switch latency, the fix is to *additionally* emit per-city entry pages that
deep-link into the combined page — not to abandon the combined page.

---

## 7c. Past showtimes

**R-7c.1 Today's page hides screenings that have already started**, so all
venues read consistently. This is our rule, not the sites' — measured at 23:17
Belgrade, Cineplexx had pruned to the next screening, CineStar was still listing
16:00, and Arena had dropped the day entirely. The inconsistency is upstream
policy, so it cannot be fixed in an adapter.

**R-7c.2 A strict cutoff, no grace period.** A screening is hidden the minute
it starts. The page answers "what can I still go to", so a listing you can no
longer buy a ticket for is noise.

**R-7c.3 Today only.** Past days are left intact, so a shared or cached link to
an earlier day still reads as a record of that day rather than an empty page.
The page states its own date (`data-date` on `#movies`) and the client compares
it with the current Belgrade date; they differ, no filtering happens.

**R-7c.4 Client-side, not build-time.** Builds run hourly and the service worker
caches HTML, so a build-time cutoff would bake in a timestamp and leave up to an
hour of started screenings on a fresh page — and far more on a cached one.
Filtering in the browser is correct to the minute even on a stale page.

**R-7c.5 Europe/Belgrade, never the visitor's zone** (R-2.6). A reader in London
at 21:00 must still see Belgrade's 22:00. If `Intl` has no time-zone support the
filter disables itself: showing a screening that has passed is a smaller failure
than hiding one that has not.

**R-7c.6 It reuses the existing chip → cinema → card cascade** (R-7.3) rather
than adding a second mechanism, and past chips are excluded from the
unknown-audio count (R-7.8) so the notice describes only what the reader could
otherwise have seen.

**R-7c.7 When the whole day has aged out**, the page says so and links to
tomorrow, rather than showing the generic "nothing found" message. That message
is only used when the time filter is genuinely the cause — if the reader's own
dubbed/kids filters emptied the page, the generic message still applies. Late in
the evening today's page legitimately goes empty; that is the correct answer,
not a bug.

**R-7c.8 A page left open re-filters itself.** The cutoff is re-evaluated every
minute and `apply()` runs only when it actually moves.

**R-7c.9 No-JS shows the superset** (R-7.7). Unlike the city filter (R-7b.4),
an unfiltered superset here is merely broader, not wrong, so nothing is
pre-hidden.

---

## 8. UI requirements

**R-8.1** Movie cards grouped by film, each with poster, title, badges and
per-cinema showtime chips linking to that cinema's booking page.

**R-8.1a Every chip must reach a page that can actually sell that ticket** — the
specific screening where the site allows it, and never a dead URL. Verified
against the live sites:

- **Arena** → `ulaznice.arenacineplex.com/rs/site/numSale/index/<id>`, which
  redirects into seat selection for that screening. Forced to **HTTPS**: the
  main Arena site has no working TLS but the ticket host does, and that is where
  card details are typed.
- **Cineplexx** → `/purchase/wizard/<cinemaId>-<sessionId>`, taken from the
  API's `session.id`, which opens the ticket wizard for that one screening.
  **`/movie/<slug>` is a 404** — the site serves film pages from `/film/<slug>`
  — so the earlier film-page link was dead on every Cineplexx chip, and it could
  not have named the venue anyway.
- **CineStar** → `/Shop/<venue>/<slug>/<sessionKey>`. CineStar drops the
  purchase key from screenings that have already started, and those fall back to
  the venue programme; R-7c then hides them, so the fallback is not normally
  reachable.

**R-8.1b** A missing deep link degrades to the **venue's own programme page**,
never to a film page that does not identify the cinema.

**R-8.2 Original title in brackets** next to the Serbian title, e.g.
*Spajdermen: Novi dan (Spider-Man: Brand New Day)*. Absent only for domestic
films, which have no foreign original title.

**R-8.3 Audio next to format.** Every format badge and chip states dubbed /
subtitled / domestic — e.g. `4DX 3D · titlovano`, `2D · domaći film`.

**R-8.4 Runtime traffic light**, as its own badge:

| Runtime | Colour |
|---|---|
| `< 90 min` | green |
| `90–119 min` | yellow / amber |
| `>= 120 min` | red |

Formatted as e.g. "1 h 47 min".

**R-8.5 Age badge** on each card (`12+`, `Bez ograničenja`, `Uzrast nepoznat`)
naming the source country.

**R-8.6 Ratings/scores** from TMDb shown as an audience score badge.

**R-8.7** Posters are referenced by remote URL. No image hosting.

**R-8.8** Footer shows last build time and any stale-source warnings.

**R-8.9** Cards and chips carry `data-audio`, `data-min-age`,
`data-kid-friendly`, `data-rating-confident` for the filters.

**R-8.10 The poster links to a trailer.** Clicking a poster opens a trailer in a
new tab (`target="_blank" rel="noopener noreferrer"`). The link is built by
`src/core/trailer.ts` and has two forms:

- **Exact** — TMDb returned a YouTube video for the film, so the link opens it.
  Preference is strictly **Serbian → `sh`/`hr`/`bs` → English**; language outranks
  both video type and officiality, because a Serbian teaser serves this audience
  better than an official English trailer. Non-YouTube and unknown-language
  videos are ignored. Within one language band a video tagged with country `RS`
  wins — distributors sometimes label a Serbian upload `hr` — but country can
  never lift a video above a higher language band.

  The build logs the resulting distribution (`Trejleri: hr 10 · en 13 ·
  pretraga 10`). This exists because the ranking is only worth as much as TMDb's
  catalogue: when a poster opens a Croatian trailer it is almost always because
  TMDb has no Serbian-tagged video for that film, and without the log that looks
  indistinguishable from a ranking bug. Measured 2026-08-19 across 33 films:
  **`sr` was zero** — every regional trailer TMDb held was tagged `hr`. So the
  Croatian wording users see ("uskoro u kinima" rather than "uskoro u
  bioskopima") is a gap in TMDb, not a defect in the ordering.
- **Search** — otherwise the link is a YouTube search for
  `"<title> <original title> trailer srpski"`. This is deliberate: Serbian
  trailers are uploaded by local distributors (Blitz, MegaCom, Taramount) and
  are often missing from TMDb, so a query that finds one beats guessing a video
  id. The tooltip is worded accordingly ("Pogledaj trailer" vs "Potraži trailer
  na YouTube-u"), so the link never overstates what it knows.

**R-8.12 The page is Serbian Latin only — never Cyrillic.** TMDb returns
`sr-RS` text in Cyrillic (titles, genres, overviews), so it is converted at the
TMDb boundary in `tmdb/client.ts`, and `escapeHtml` converts again as a safety
net. `escapeHtml` is the single choke point every rendered string passes
through, which makes the guarantee structural instead of a rule each call site
has to remember; the conversion is a no-op on Latin input.

Use `toSerbianLatin()` for anything shown to a person — it keeps diacritics
("Naučna fantastika"). Do **not** use `transliterate()`, which deliberately
folds them for title matching and would yield "Naucna fantastika". The
Cyrillic → Latin direction is 1:1 and therefore safe to automate; the reverse is
not, since "nj" may be one letter or two.

`original_title` is deliberately **not** converted: it is the film's own
original-language title, and forcing a Serbian mapping onto, say, Russian would
corrupt it.

**R-8.11** The trailer link must work without a TMDb key, and must exist even
for a film with no poster — the anchor wraps the placeholder too. The play badge
appears on hover, and is permanently visible under `@media (hover: none)` so
touch users get the affordance.

---

## 9. Installable app (PWA)

**R-9.1** The site is installable as an app on Android (and desktop Chrome).

**R-9.2** iOS has no install prompt API — Safari's *Share → "Dodaj na početni
ekran"* is the equivalent, and must be explained in the UI.

**R-9.3** The install block in the footer is **always visible**. It must not be
gated behind `beforeinstallprompt`, which never fires in many contexts — that
was a real bug.

**R-9.4** The button uses the native prompt when available; otherwise it toggles
per-platform instructions (Android Chrome menu, iOS Safari share sheet, desktop
address-bar icon).

**R-9.5** A web manifest and 4 icons (192, 512, maskable 512, 180) are emitted.

**R-9.6** Icons are generated **in-process** by a dependency-free PNG encoder
(`node:zlib`). Do not add `sharp`/`resvg` for this.

**R-9.7** A service worker provides an offline shell: network-first for
documents, cache-first for assets. Its scope is the site root, so `sw.js` must
be emitted at the root, not under `assets/`.

**R-9.8** `setupInstall()` and `registerServiceWorker()` must run **before** any
filter early-return in `app.js`.

---

## 10. Data accuracy

Verified against the live sites by audit. These are the standing rules.

**R-10.1 Showtimes must be exact** — no missing, phantom, mis-dated or
timezone-shifted entries. Audited baseline: Arena 134/134, CineStar 276/276,
Cineplexx 215/215.

**R-10.2 Format must not be lost.** Premium formats compose with 3D:
`4DX/3D/TITL` ⇒ `"4DX 3D"`, not `"4DX"`.

**R-10.3 Metadata source ranking.** When cinemas disagree about metadata,
prefer the more trustworthy source: **cineplexx → cinestar → arena**. Applies to
`originalTitle` and `runtimeMinutes`.

Rationale, both confirmed on live pages:
- Arena's detail block is *positional prose*, so a film with no original title
  shows the **director** in that slot (`ASTRALNA PODMUKLOST` → "Jacob Chase").
  CineStar's labelled `Izvorni naslov` has the correct value.
- Arena **rounds** runtimes (150 vs the true 145; 100 vs 128).

**R-10.4 Domestic films are labelled `original` ("domaći film")**, never
"titlovano". The signal is Arena's `Zemlja porekla: RS`.

**R-10.5** The domestic remap is applied at **merge level**, not adapter level,
so every venue shows the same label for the same film even when only one
cinema published the country.

**R-10.5.1 The country signal is Novi-Sad-only, so TMDb backs it up.** Only
Arena publishes `Zemlja porekla`, and Arena has no Beograd venue, so a domestic
film playing exclusively in Beograd has no country signal at all and would be
labelled "titlovano". TMDb's `original_language == 'sr'` is therefore accepted
as a second domestic signal. It is deliberately a *second* signal: with no TMDb
key the build behaves exactly as before (R-8.1). Serbian only — Croatian and
Bosnian films also play untranslated, but "domaći film" would be a false claim
about them.

**R-10.6** `DS` in an Arena title is **not** a dubbing marker. It appears on
both a dubbed cartoon and a domestic Serbian film. Do not infer audio from it.

**R-10.7** CineStar's `.age` field contains **genre**, not age. Do not use it
for age ratings.

**R-10.7a Arena leaves a placeholder row behind for a screening that has already
happened.** It reads `00:00` and its booking link stops at
`/rezervacija/numSale/index/` with **no screening id**, while every real
screening carries one (`…/index/197750`). Live-verified: 138 rows had an id, the
3 without one were all `00:00`. **Discard by the missing id, never by the time** —
dropping `00:00` would also drop a genuine midnight screening, and it would leave
a booking chip pointing at a page that cannot sell a ticket (R-8.1).

**R-10.8** Arena's detail rows have no whitespace between them, so the value
runs into the next label (`RSGodina proizvodnje`). Parse by reading the
`<strong>` label's own container — a `\b`-anchored regex on the flattened body
text does not work.

**R-10.9** Cineplexx sessions must be filtered to `cinemaId 1116`. Movie ids
missing from `/movies` are fetched individually via `/movies/{id}`.

**R-10.10** Cineplexx timestamps carry `+02:00` and are parsed as literal wall
clock — confirmed correct.

**R-10.11** Cineplexx's `runTime` is the exact runtime and is preferred.

**R-10.12 Cyrillic genres silently broke the age heuristic.** `KID_GENRES` and
`ADULT_GENRES` in `ratings.ts` are written in Latin, so TMDb's Cyrillic
`Хорор` / `Трилер` / `Цртани` matched **nothing**. Horror and thriller films
therefore received no heuristic age estimate at all, and the page looked
correct while quietly giving out less information than it should have.

This is the reason the Latin conversion happens at the TMDb boundary rather
than in the renderer: converting once, at the point the Cyrillic enters the
system, fixes the display, the age heuristic and title matching together.
Converting only at render time would have left the heuristic broken.

---

## 11. Failure handling

**R-11.1** Each adapter is independent; one cinema failing must not affect the
others.

**R-11.2** The previous build's data is committed to the repo, so a failed
scrape reuses that cinema's last good data.

**R-11.3** Reused data is marked stale in the UI ("Podaci možda nisu ažurni —
poslednje osvežavanje: …").

**R-11.4** A build only deploys if **at least one source succeeded**. A bad run
can never replace a good site with an empty one.

**R-11.5** A source that has never succeeded is shown as unavailable.

**R-11.6** The workflow fails loudly if every scrape breaks, so a broken
parser surfaces as a red build rather than a silently empty site.

**R-11.7** The build reports TMDb resolution coverage so degradation is visible.

**R-11.8 A scraper can fail in CI while passing locally.** Bot protection keys
off the caller's IP, so "it works on my machine" proves nothing about the
runner. When a source is stale on the live site, read the Actions log for the
adapter's `neuspeh:` line rather than re-running the build locally.

---

## 12. Testing

**R-12.1** Unit tests for: title normalizer, TMDb matcher, age-rating mapper,
per-adapter dubbing detection, and each adapter's parser using saved
fixtures. **No network in tests.**

**R-12.2** Regression tests exist for every audit finding in §10 and must stay:
`formatFromCode('4DX/3D/TITL') === '4DX 3D'`; `parseArenaOriginCountry` against
run-on markup; merge prefers Cineplexx runtime and CineStar original title over
Arena's; a domestic film's showtimes all become `original`.

**R-12.3** Tests must reproduce the *real* markup shape. The first
`parseArenaOriginCountry` test passed against simplified HTML while the parser
was broken on the live page — a test that cannot fail is worse than no test.

**R-12.4** Baseline: **119 tests passing**, `tsc --noEmit` clean.

**R-12.5** The city model is covered by tests that would fail if the registry
drifted: every venue belongs to exactly one city (R-4.9), venues of the same
chain stay distinct after merging (R-4.7), a film in two cities merges into one
entry (R-7b.8), and the rendered page has the non-default city pre-hidden
(R-7b.4) with counts scoped to the visible city (R-7b.5).

---

## 13. Deployment

**R-13.1** `.github/workflows/build.yml` runs on `schedule: cron '7 * * * *'`,
on push, and on `workflow_dispatch`.

**R-13.2** Steps: checkout → setup-node → `npm ci` → `npm test` →
`npm run build` → upload artifact → `actions/deploy-pages`.

**R-13.3** The build commits refreshed raw data back to the repo, which both
provides last-good fallback and counts as repository activity — scheduled
workflows are auto-disabled after 60 days of inactivity.

**R-13.4** `TMDB_API_KEY` is a repository **secret** (never a variable, which is
readable by anyone who can see the repo and is exposed in logs);
`CINEPLEXX_CLIENT_KEY` is a variable with a known default (it is a public value
from their web bundle, so it must be overridable without a rebuild).

**R-13.4a** `TMDB_API_KEY` must be TMDb's **API Key (v3 auth)** — the 32-char
hex string. The client authenticates with `?api_key=`, so the v4 "API Read
Access Token" (a JWT) is rejected. Because a rejected key otherwise looks
exactly like having no key, the client logs an explicit one-time warning naming
the likely cause on HTTP 401/403.

**R-13.5** Pages source must be set to **GitHub Actions** in repository
settings.

**R-13.6** The repository must be **public**. GitHub Pages on a private
repository requires a paid plan, which would break R-2.4 (zero cost).

**R-13.7** The project must live in a **real repository, not a fork**. GitHub
disables `schedule` workflows in forked repositories, which would silently kill
the hourly refresh (R-2.1). To move the project between accounts, use
*Settings → Transfer ownership*, which keeps history and redirects the old URL.

**R-13.8 The app is named "Kokice"; the repository is deliberately NOT
renamed.** Once `kokice.org` is the address bar, `CacheNS/CinemaNS` is internal
plumbing that no visitor ever sees, so renaming it would rewrite every remote,
badge and cross-reference for no user-facing gain — while breaking existing
links, orphaning installed PWA copies (the service-worker scope and `start_url`
are origin-relative, so installs are abandoned rather than updated) and
resetting the analytics hostname. This was previously framed as a rename
*deferred until the domain move*; the domain move happened and the decision is
now simply to keep the name. Internal identifiers (`kokice`,
`KOKICE_DISABLE_IMPERSONATE`) are renamed because they are invisible to users
and cost nothing.

**R-13.9** Renaming the app requires bumping the service-worker cache key
(`kokice-v2`). `sw.js` caches `index.html`, so without a bump installed users
keep seeing the old name; the `activate` handler already evicts any key that is
not current. The same applies to an origin change: moving to `kokice.org` is a
new origin, and the cache key was bumped again for it.

**R-13.10 The canonical host is the bare apex `kokice.org`**, with
`www.kokice.org` redirecting to it. The redirect is GitHub's — `www` is a
`CNAME` to `cachens.github.io`, and GitHub issues the 301 — rather than a
Cloudflare redirect rule, which would be one more thing to own for a marginal
gain. `cachens.github.io/CinemaNS/` keeps working; GitHub redirects it to the
custom domain automatically.

**R-13.11 The domain is proxied through Cloudflare, and the ordering of that
setup is not optional.** DNS is Cloudflare's (nameservers moved from GoDaddy,
which remains only the registrar), and the records are orange-clouded, which is
what makes edge-injected analytics possible (R-16.3). Proxying is the target
state; see R-14.4 for where the cutover currently stands.

Three rules follow, each of which has a silent failure mode:

- **Cut over DNS-only, then go proxied.** GitHub provisions the Let's Encrypt
  certificate itself and the proxy can interfere with the HTTP-01 validation
  that issues it. Records stay grey until the certificate exists and *Enforce
  HTTPS* is ticked, and only then go orange.
- **SSL/TLS mode must be Full (strict), never Flexible.** Flexible terminates
  TLS at Cloudflare and speaks plain HTTP to the origin; GitHub Pages redirects
  that back to HTTPS, giving an infinite redirect loop.
- **Leave Bot Fight Mode, Under Attack mode, Cache Everything, APO and Always
  Online off.** The first two can block the ACME challenge — and on the free
  plan Bot Fight Mode cannot be excepted for a path — which breaks certificate
  *renewal* roughly every 90 days, long after any deploy. The rest cache HTML
  harder than the hourly rebuild allows; GitHub Pages already sends
  `Cache-Control: max-age=600`, which Cloudflare honours. If renewal ever does
  fail, the remedy is to set the records to DNS-only for an hour and flip back.

**R-13.12 No `CNAME` file, ever.** Deployment is artifact-based
(`upload-pages-artifact` → `deploy-pages`), and for that path the custom domain
is stored in repository settings and survives every deploy. Adding a `CNAME`
file is the branch-based-Pages instruction, and it is the thing a well-meaning
reader of GitHub's docs will try to add.

---

## 14. Open items

**R-14.1 TMDb API key — configured.** A `TMDB_API_KEY` repository secret is set,
so §6 age ratings, scores and TMDb-id-based cross-language matching are active
in CI. Local builds still need the key in `.env` or they run in the degraded
title-matching mode. See R-13.4a for which key type to use.

**R-14.2 OPEN — Arena-only films** can still show a director as the original
title, because there is no second source to outrank Arena. Accepted; no reliable
heuristic was found.

**R-14.3 DONE — published.** Live at <https://kokice.org>, built and deployed by
GitHub Actions from `main`. Pages source is set to GitHub Actions, all nine
scrapers report `ok`, and the hourly workflow's data-refresh commit is confirmed
working. The repository keeps its old name by design — see R-13.8.

**R-14.4 PENDING — analytics is between modes.** The token beacon has been
removed from the build (§16.3), and Cloudflare's automatic injection replaces it
only once two console steps are done: set the DNS records to **proxied** with
SSL/TLS on **Full (strict)** (R-13.11), then add `kokice.org` in Cloudflare Web
Analytics using automatic setup. Verified 2026-08-21: the domain is live and
correct but still **DNS-only** — `kokice.org` answers with `server: GitHub.com`
and no `cf-ray` — so nothing is being counted in the meantime. This is the
expected order; enabling injection before the beacon was removed would have
double-counted every visit (§16.4).

**R-14.5 OPEN — no Serbian trailers exist on TMDb.** Measured 2026-08-19 across
33 films: `sr` count was zero, so posters open Croatian or English trailers
(R-8.10). Nothing to fix on this side; revisit only if TMDb's catalogue
improves. The `Trejleri:` build line is the check.

---

## 15. Constraints for future work

**R-15.1** Do not introduce a runtime server, database or frontend framework —
these defeat R-2.2, R-2.4 and R-2.5.

**R-15.2** Do not make TMDb a hard dependency (R-5.3).

**R-15.3** Adapters stay isolated with fixture-based tests, so HTML changes
break one cinema visibly rather than the whole site.

**R-15.4** CSS badge modifier rules must stay **after** the base `.badge` rule.
Placing them before it lets `.badge`'s `color` win — this has already caused one
bug.

**R-15.5** Age ratings are advisory. Serbia exposes no statutory cinema
certification, so badges reflect the best available foreign certification, and
the UI must keep stating the source country and marking guesses.

**R-15.6** Analytics must stay cookieless (R-16.2). Anything that stores an id
on the device drags in a consent banner and defeats R-2.1.

**R-15.7** Adding a city means adding venues to the registry, never adding a
`if (city === …)` branch to an adapter. An adapter takes its venue's identity as
a parameter; if a new city cannot be expressed that way, it needs a new adapter
(R-1.2.2).

**R-15.8** Anything rendered per city must be pre-hidden for every city but the
default, and JS must only ever reveal (R-7b.4). A new per-city element that
defaults to visible is a no-JS correctness bug, not a cosmetic one.

---

## 16. Analytics

**R-16.1 Visit counting requires a client-side beacon.** GitHub Pages exposes
no access logs and no analytics API, and the repository traffic API counts views
of the *repo page on github.com*, not of the published site. So the only
possible source of visit data is the visitor's own browser.

**R-16.2 Cloudflare Web Analytics, chosen for being cookieless.** It sets no
cookies, stores nothing on the device and does not fingerprint, so under GDPR
and Serbia's ZZPL the site needs **no consent banner**. That was the deciding
factor: a consent dialog on a page whose whole purpose is to answer a question
in two seconds would cost more than the numbers are worth. Google Analytics was
rejected for exactly this reason.

**R-16.3 The beacon is injected by Cloudflare at the edge, not by the build.**
`kokice.org` is proxied through Cloudflare (R-13.9), which lets Web Analytics
run in *automatic* mode: Cloudflare adds the `beacon.min.js` tag to the HTML on
the way out. The build emits no beacon, holds no site token and has no
analytics code — the whole of `src/render/analytics.ts` and its tests were
deleted when this moved to the edge.

**R-16.4 The build must never also emit a beacon.** Automatic injection plus a
tag in the built HTML means both fire and every visit is counted twice. A test
in `html.test.ts` asserts the rendered page contains no `beacon.min.js` and no
`data-cf-beacon`.

**R-16.5 The CSP allowances for `cloudflareinsights.com` are load bearing and
must not be removed** — this is the sharp edge of edge injection. Nothing in
the repository references those hosts any more, so
`script-src https://static.cloudflareinsights.com` and
`connect-src https://cloudflareinsights.com` read like dead configuration.
Deleting them breaks nothing visible: the build succeeds, no other test fails,
and the dashboard still says analytics is enabled. It simply records nothing,
because `default-src 'none'` blocks the injected script. `html.test.ts` pins
both directives with an explanatory failure message.

**R-16.6 Analytics depends on the hostname staying proxied.** Automatic
injection is only available for a proxied (orange-cloud) record, since
Cloudflare has to be in the response path to modify the HTML. Setting the
record to DNS-only silently stops measurement. This matters because
grey-clouding for an hour is the standard remedy for a failed Let's Encrypt
renewal behind the proxy (R-13.11) — so the fix for a certificate problem also
pauses analytics until the record goes orange again.

**R-16.7 An origin `Cache-Control` containing `no-transform` disables
injection.** Cloudflare will not rewrite a response that forbids
transformation. GitHub Pages does not send it today; if the beacon ever
vanishes from the served page while the dashboard shows the site as enabled,
check the response headers before anything else.

**R-16.8 The footer states that counting happens**, in Serbian, and
unconditionally — the beacon is now a property of the live origin rather than
of the build, so the build cannot know whether it is present and a conditional
note would be guessing.

**R-16.9 Figures are a floor, not a census.** Ad blockers, privacy browsers and
corporate DNS filtering suppress the beacon — `static.cloudflareinsights.com`
does not even resolve on some networks. The hourly CI build never executes it,
so automation cannot inflate the count.

**R-16.10 A site tag in the HTML is not a leak, whoever put it there.** The tag
is delivered in the page because the *visitor's browser* is what reports the
page view; there is no configuration in which it stays private and analytics
still works. It now arrives from Cloudflare rather than from the build, but the
principle is unchanged: do not treat a sighting of it as a leak, and do not try
to hide it. What it does *not* permit is access to the Cloudflare account or to
the analytics data; the only abuse available is submitting fake page views.

**R-16.11 Turning it off stays a one-step operation.** Disable or delete the
site in Cloudflare Web Analytics. No code change, no redeploy. There is no
longer a repository variable to remove — `CF_BEACON_TOKEN` was deleted from the
workflow when injection moved to the edge, and the corresponding repository
variable can be deleted in settings.

---

## 17. Security posture

A three-agent security review (untrusted input, browser output, CI/CD) audited
the whole solution and found **0 critical and 0 high** issues. The requirements
below record what was hardened as a result, and — just as importantly — what
was examined and deliberately left alone.

### The threat model this design assumes

**R-17.1 The realistic attacker is an upstream cinema site, not a visitor.**
There is no login, no database, no user input and no server: the only writable
surface is the data three cinema sites and TMDb hand us every hour. Every
control below follows from that. Findings that assume a conventional web app
(session fixation, SQL injection, CSRF) do not apply and should not be
"fixed" into existence.

**R-17.2 Arena is the least-trusted source.** It is fetched over plaintext HTTP
because `https://www.arenacineplex.com` fails the TLS handshake outright — this
cannot be upgraded from our side. So Arena's markup is treated as attacker-
controlled: anyone on the path can rewrite it.

### Untrusted input

**R-17.3 Every response is size-capped and read under the request deadline.**
`fetchOnce` reads the body while the abort timer is still armed and streams it
through a byte counter (8 MiB, `maxBytes`-overridable), rejecting early on an
oversized `Content-Length`. Before this, the timeout was cleared as soon as
headers arrived, so a body that never ended hung the hourly build with nothing
left to interrupt it.

**R-17.4 Redirects are followed manually, capped, and scheme-checked.** Five
hops maximum, and a redirect to anything but `http`/`https` is refused — the
fetch layer must never be steerable into `file:` by a scraped `Location`.

**R-17.5 The `curl_cffi` subprocess has a deadline and output caps.** 60
seconds, then `SIGKILL`; 8 MiB of stdout and 4 KB of stderr. A helper that
hangs must not take the build with it. It keeps its argv-array `spawn` with no
shell, which is what makes command injection impossible.

**R-17.6 Arena URLs are resolved against an origin allow-list** — its own site
for programme and poster links, plus the ticket host for booking links, with
`http` upgraded to `https` on that host. Anything else is dropped. Because the
page is fetched over plaintext, without this a MITM could point a booking chip
at a phishing host that a reader is about to type card details into.

**R-17.7 Titles are capped at 300 characters before parsing.** The noise-
stripping regexes are quadratic — measured, not assumed: 64 KB takes ~0.7 s and
about 1 MB takes minutes. The cap truncates rather than throwing, so one absurd
title degrades that title instead of the scrape.

### Browser output

**R-17.8 Escaping is not enough for URLs; schemes are allow-listed.**
`safeUrl()` guards every `href` and `src` on the page. `javascript:alert(1)`
contains no character `escapeHtml` touches, so it would otherwise survive
intact and run on click — and booking links, cinema sites, posters, trailers
and score links all come from third parties. Only `http`, `https`, `mailto` and
relative URLs pass; a rejected booking URL falls back to the venue programme
(R-8.1a) rather than disappearing.

**R-17.9 The page ships a Content-Security-Policy** with `default-src 'none'`
and no `unsafe-inline`, which is possible only because the page has no inline
script and no inline style. **Adding either would break the site**, and a test
asserts their absence. `img-src` stays broad (`https:`) because posters come
from several CDNs. `frame-ancestors` is absent by necessity: a meta-tag CSP
ignores it and GitHub Pages cannot set response headers.

**R-17.10 The service worker caches only successful, same-origin, non-redirected
responses.** Otherwise a 404 from a bad deploy is stored and then served back
offline as though it were the page. `VERSION` is bumped when this logic changes,
which is what evicts an installed copy holding the old rules.

**R-17.11 The preview server binds to loopback only.** `npm run serve` has no
auth and is not meant to leave the machine.

### Pipeline

**R-17.12 No job holds a permission it does not need.** The workflow is
`contents: read` at the top level. `build` — the only job that runs the scraper
and therefore the only one an attacker could plausibly reach — has no write
access at all. `persist` holds `contents: write` and does nothing but commit an
artifact; `deploy` holds `pages: write` and `id-token: write` and does nothing
but publish one.

**R-17.13 `deploy` depends on `build` alone, never on `persist`.** A failed
commit must not be able to hold back a good site.

**R-17.14 The `data/raw.json` commit is load bearing and must not be replaced
with a cache.** It is both the stale-data fallback (R-3.5) and the activity that
stops GitHub disabling a `schedule:` trigger after 60 days. Cache writes do not
count as repository activity. It moved into its own job, but it did not go away.

**R-17.15 Actions are pinned to commit SHAs**, with the version in a trailing
comment so Dependabot can bump both together. A tag can be moved to point at new
code; a SHA cannot. `.github/dependabot.yml` is what keeps the pins from
quietly rotting.

**R-17.16 `npm ci --ignore-scripts` and an exact `curl_cffi` pin.** No package
in the lockfile declares an install script, so refusing to run them costs
nothing and closes the usual npm supply-chain path. `pip install curl_cffi`
was unpinned, which made every build depend on whatever was published that
morning.

**R-17.17 Dependabot *alerts* are enabled, and that is separate from
`dependabot.yml`.** The file configures *version updates* — routine bumps — and
does not switch on vulnerability alerting; the two are conflated constantly.
Alerts were off despite the public-repo default and were enabled by hand under
Settings → Code security. Do not assume the config file covers it if alerting
is ever seen to be off again; the API says so plainly (`GET
/repos/.../dependabot/alerts` answers `403 Dependabot alerts are disabled for
this repository` when it is off, and a different `403` about token scope when
it is on).

**R-17.17a Pins are expected to move, and letting them rot is the failure
mode.** Within a minute of the first build after `dependabot.yml` landed,
Dependabot opened six PRs, and every action pin was a major behind — the run
had annotated all five with "Node.js 20 is deprecated". They were taken in one
commit rather than five sequential rebases, because every action PR edits the
same file. `deploy-pages` stays at v4 because that is still current.

### Examined and deliberately unchanged

**R-17.18 TLS verification is intact and the impersonation does not weaken it.**
`curl_cffi` replays a Chrome handshake *fingerprint*; there is no
`rejectUnauthorized: false`, no `verify=False` and no `curl -k` anywhere. This
code looks alarming by design — do not "harden" it by disabling the fallback,
or CineStar goes dark in CI.

**R-17.19 A Cloudflare site tag in the HTML is not a leak** (R-16.10). The
beacon now arrives by edge injection rather than from the build, so there is no
token in the repository at all — but it is still visible in the served page, by
design. It cannot carry Subresource Integrity either, because Cloudflare
updates the file at will. The CSP is the mitigation that is actually available,
which is another reason its `cloudflareinsights.com` entries must stay
(R-16.5).

**R-17.20 `data.json` is published deliberately** and contains only what the
page already shows. `npm audit` reports zero vulnerabilities across 24 runtime
and 3 dev packages, the lockfile is v3 with integrity hashes, and no secret
reaches `dist/` or `data/raw.json`.
