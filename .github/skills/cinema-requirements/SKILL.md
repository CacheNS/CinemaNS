---
name: cinema-requirements
description: Baseline requirements and hard-won data-accuracy rules for Kokice, the Novi Sad + Beograd cinema aggregator. Use before changing anything in this repository — scrapers/adapters (Arena, Cineplexx, CineStar, Tuck), title matching, TMDb enrichment, age ratings, dubbing/subtitling labels, filters, the city switcher, the rendered HTML/CSS, the PWA install flow, or the scheduled GitHub Actions build. Also use after making any such change, to update REQUIREMENTS.md, AGENTS.md, copilot-instructions.md and this file — without being asked.
---

# Kokice (Novi Sad + Beograd cinema aggregator) — requirements baseline

## Read this first

The authoritative specification is [`REQUIREMENTS.md`](../../../REQUIREMENTS.md)
at the repository root. Read it before proposing or making a change. Every
requirement there is implemented and verified against the live cinema sites, so
breaking one is a regression.

Requirements have stable ids (`R-10.3`). Cite them when a change touches them.

**Always fetch the latest changes before making any change.** Run
`git fetch --all` and check `git status`/`git branch -vv` for how the current
branch relates to its remote before editing anything — this repo is built by a
scheduled Actions run that commits `data/raw.json` and `data/health.json`
straight to `main` (§17.14), so `main` moves on its own even with no human
pushes. Starting from a stale base risks a conflict-laden or silently
overwritten commit later.

## Orientation

Static site → built by scheduled GitHub Actions → served by GitHub Pages. A
Node.js + TypeScript build scrapes ten venues across two cities in parallel,
enriches via TMDb, merges by movie, and emits one Serbian HTML page per day plus `data.json`.

The cron asks for hourly but GitHub delivers **2-6 runs a day** (mean gap 4.3 h,
measured over 220 runs). The workflow is healthy — zero cancellations, ~2 min
per run — so do not go hunting for a repo-side cause, and **never let page copy
claim an hourly refresh** (R-2.6a).

| Area | Where | Spec |
|---|---|---|
| Scrapers | `src/adapters/{arena,cineplexx,cinestar,tuck}.ts` | §1, §10 |
| Title matching | `src/core/titles.ts` | §5 |
| Merging | `src/core/merge.ts` | §5, §10 |
| TMDb + age | `src/tmdb/client.ts`, `src/core/ratings.ts` | §6 |
| Rendering | `src/render/html.ts`, `assets/style.css` | §8 |
| SEO (canonical, sitemap, JSON-LD) | `src/render/html.ts` (`renderSitemap`, `renderRobots`) | §18 |
| Filters | `src/render/assets/app.js` | §7 |
| City switch | `src/core/types.ts` (registry), `html.ts`, `app.js` | §1, §7b |
| PWA | `src/render/icon.ts`, `sw.js` | §9 |
| Build/deploy | `src/build.ts`, `.github/workflows/build.yml` | §3, §13 |
| Trailers | `src/core/trailer.ts`, `src/tmdb/client.ts` | §8.10–8.11 |
| Analytics | Cloudflare edge injection (no repo code) | §16 |

## The rules most likely to be broken by a well-meaning change

1. **Do not add a server, database or frontend framework.** The whole design
   exists to have no runtime (§15.1).
2. **Do not make TMDb required.** The build must succeed with no API key
   (§5.3). It currently runs without one.
3. **Dubbing is per-showtime.** Filtering at the card level shows cards whose
   listed times are actually subtitled — the exact mistake a parent gets burned
   by (§7.2–7.3). The control is **one radio group with three states** — Svi /
   Sinhro. / Bez sinhro., carried as `?audio=` (§7.1a). "Bez sinhro." hides only
   a confirmed `dubbed` chip, so `subtitled`, `original` and `unknown` all stay
   visible — do not relabel it "Titlovano" and do not make it hide `unknown`
   (§7.1b). The unknown-language notice belongs to the dubbed state alone
   (§7.8). There is no `?dubbed=1` fallback; do not add one back.
4. **Metadata trust order is cineplexx → cinestar → tuck → arena** (§10.3).
   Arena's film page is positional prose, so it yields the *director* when a
   film has no original title, and it rounds runtimes. Tuck labels its fields
   explicitly like Cineplexx/CineStar, so it outranks Arena but stays below
   the two longer-audited sources.
5. **Domestic Serbian films are `audio: 'original'`**, remapped at merge level
   so every cinema shows the same label (§10.4–10.5). The country signal comes
   only from Arena, which exists only in Novi Sad, so TMDb's
   `original_language == 'sr'` is a second signal for Beograd (§10.5.1) —
   Serbian only, since a Croatian film is not "domaći".
6. **`4DX/3D/TITL` is `"4DX 3D"`** — premium formats compose with 3D (§10.2).
7. **`DS` is not a dubbing marker; CineStar's `.age` is genre** (§10.6–10.7).
8. **Parse Arena by DOM label, not body regex** — its rows run together
   (§10.8).
9. **Europe/Belgrade for every date** (§4.6), and today's page keeps a screening
   for 60 minutes after it starts, then hides it — client-side, today only, with
   the still-listed ones muted via `data-started` (§7c).
10. **Arena's `00:00` rows with an id-less `/numSale/index/` booking link are
    placeholders.** Drop them by the missing id, never by the time (§10.7a).
11. **Every booking chip must reach a page that can sell that ticket** (§8.1a).
    Cineplexx is `/purchase/wizard/<cinemaId>-<sessionId>` from the API's
    `session.id`; **`/movie/<slug>` is a 404** and shipped dead for a while (the
    site uses `/film/<slug>`). Arena's ticket host is forced to HTTPS. Fall back
    to the venue programme, never to a film page that hides the venue.
12. **CSS badge modifiers go after the base `.badge` rule** (§15.4). A badge's
    classes also belong on the single outermost element, never on a `<span>`
    nested inside a wrapping `<a>` — `.badges` is a flex row with default
    `align-items: stretch`, so only a direct flex child gets stretched to match
    its siblings' height; a nested one renders visibly shorter (§15.4a).
    **Showtime chips carry no audio colour** (§8.3a): the old green `dubbed` /
    violet `original` borders read as a status flag, were never explained on
    the page, and duplicated text the chip already shows. Leave the
    grace-window muting (§7c.2a) as a chip's only border variation, and keep
    `data-audio`, which the filter reads.
13. **CineStar needs `tlsFallback`.** It sits behind a Cloudflare TLS-fingerprint
    challenge and 403s from CI; headers and even headless Chromium do not clear
    it (§2.7a). It can pass locally and fail in CI — read the Actions log.
14. **The trailer language order (sr → sh/hr/bs → en) is already correct.** TMDb
    held zero `sr` trailers across 33 films, so Croatian ones are a legitimate
    fallback, not a bug. Check the build's `Trejleri:` line first (§8.10).
15. **The analytics beacon is injected by Cloudflare at the edge, not built**
    (§16.3). `kokice.org` is proxied, so there is no token and no analytics code
    in the repository. Don't add a beacon tag back — it would double-count
    (§16.4) — and **don't remove the `cloudflareinsights.com` entries from
    `buildCsp()`**, which now look like dead allowances but are what lets the
    injected script run at all (§16.5). A site tag visible in the served HTML is
    by design, not a leak.
16. **Serbian Latin only, never Cyrillic** (§8.12). TMDb's `sr-RS` responses are
    Cyrillic and are converted at the TMDb boundary, with `escapeHtml` as a
    second net. Use `toSerbianLatin()` for display; `transliterate()` folds
    diacritics and exists only for matching. The conversion is not cosmetic —
    Cyrillic genres matched nothing in the Latin-only `ADULT_GENRES`, so the
    age heuristic was silently returning no estimate (§10.12).
17. **`CinemaId` is a venue, not a chain** (§4.7). Beograd has five Cineplexx
    venues; a chain-level id would merge Delta City with Galerija into one
    block. Chain-level facts such as metadata trust key on `Cinema.chain`
    (§4.8).
18. **Cineplexx venue numbers are resolved from `/api/v1/cinemas` by
    `cinemaUrlName`, never hardcoded** (§4.10) — the live ids are
    non-contiguous (`1114` and `1117` do not exist), so a guessed id quietly
    scrapes the wrong cinema.
19. **Every city but the default renders pre-hidden, and JS only reveals**
    (§7b.4). This is the one place a no-JS superset is *wrong* rather than
    merely broad: a Novi Sad reader must never see Belgrade showtimes. Counts,
    empty state, subtitle and stale-source notices are all per city (§7b.5).
20. **Arena exists only in Novi Sad** (§1.2.1) — its site has no location
    selector at all. Do not try to parameterize it by city.
21. **`safeUrl()` guards every `href`/`src`, and the page has a strict CSP**
    (§17.8–17.9). `escapeHtml` does not stop `javascript:` — there is nothing in
    it to escape. Tab, newline and CR are stripped before the scheme/`//`
    checks run, matching what a URL parser strips before reading the scheme —
    without it, a tab hidden inside "javascript:" bypassed the scheme regex
    entirely (§17.8). CineStar's booking/detail links are origin-restricted
    the same way Arena's are (§17.6a) — a scraped `https://` href is no longer
    trusted just because it parses. The CSP has no `unsafe-inline`; its one
    inline `<script>` is the JSON-LD block, allowed by an exact-content
    `sha256-` hash rather than by loosening the policy (§18.6) — any *other*
    inline `<script>` or `style=` still breaks the site, and a test asserts
    their absence. Inside that JSON-LD block, use `isSafeUrl()` (validated,
    unescaped), not `safeUrl()` — the latter's HTML-entity escaping corrupts
    URLs in raw JSON text (§18.5).
22. **Fetches are deadline-bound, size-capped and redirect-capped** (§17.3–17.4),
    and the `curl_cffi` child is SIGKILLed after 60 s (§17.5). The body is read
    while the abort timer is still armed — moving that read outside it
    reintroduces a build that hangs forever.
23. **Arena URLs are origin-allow-listed** (§17.6). It is the one source fetched
    over plaintext HTTP, so a booking chip must never be steerable off-origin.
23a. **Tuck's ticket host is allow-listed but never upgraded to HTTPS**
    (§17.6b) — `https://ulaznice.tuck.rs` hangs (nothing listens on 443), so
    `tuckUrl()` keeps `http://ulaznice.tuck.rs` as-is, unlike Arena's ticket
    host which does upgrade cleanly. Tuck's booking link is also per movie,
    not per session — the listing page has no per-session id, so every
    showtime of a film shares one booking chip; this is accepted, not a bug.
24. **Workflow permissions are per job** (§17.12). `build` runs the scraper with
    no write access; `persist` commits, `deploy` publishes and `alert` opens or
    closes a GitHub issue. `deploy` must never depend on `persist` (§17.13).
25. **A degraded source only alerts after two consecutive failures, in a
    GitHub issue, not a webhook** (§11.9). `src/alert.ts` reads the
    consecutive-failure streak from the committed `data/health.json` — a
    single blip (§11.8) must not open an issue, and a cache write there would
    silently reset the streak, so it is committed alongside `raw.json`
    (§17.14).
26. **Every day page is independently indexable** (§18). Canonical URL, unique
    title/description, OG/Twitter tags and a per-day, default-city-scoped
    JSON-LD graph are all built from `BASE_URL` and `snapshot`, never
    hardcoded — a future domain change or a new day in the window must not
    require touching this logic.
27. **The service worker's cache-key VERSION is derived, never hand-bumped**
    (§9.7a). `renderServiceWorker()` in `build.ts` hashes `style.css` +
    `app.js` at build time. A shipped JS/CSS change that doesn't move this
    hash is invisible to returning/installed users — the network-first HTML
    updates immediately, but the cache-first assets it depends on stay
    stale — which is exactly what happened before this was automated. Don't
    reintroduce a literal `VERSION` string in `sw.js`.
28. **The search box's term lives in the URL, like the other filters** (§7.9).
    `syncUrl()` writes the raw typed text to `?q=` and copies it into every
    day-tab `href`; on load it's read back into the box before the first
    `apply()`. Without this, the term survived a city switch (JS-intercepted,
    never navigates) but was silently lost on a day switch (a real page load)
    — the same class of bug R-7.5 already solved for `audio`/`kids`.
29. **`sw.js` is registered as `sw.js?v=<hash>`, not bare `sw.js`** (§9.7b).
    GitHub Pages serves `sw.js` itself with a multi-hour `Cache-Control`, so a
    browser can keep re-fetching the *previous* worker straight from its own
    HTTP cache — with its old `VERSION` baked in — without ever seeing the
    new bytes; §9.7a's content hash never even gets the chance to change.
    This actually happened: only "clear site data" fixed it for a real
    visitor right after a deploy. `computeAssetVersion()` in `build.ts`
    produces the one hash used both for `sw.js`'s `VERSION` and for the
    `<meta name="sw-version">` every page embeds; `app.js` reads that meta
    tag and appends it as `?v=` when calling `.register()`, so the
    registration URL itself changes whenever the content does — a URL the
    browser has never cached always reaches the network, regardless of the
    response header.

## Before committing

```
npx tsc --noEmit
npm test          # 152 tests, fixtures only, no network
npm run build     # scrapes live, writes dist/
npm run serve     # http://localhost:3000
```

Add a regression test for every parsing bug you fix, and make the fixture
reproduce the **real** markup — a simplified fixture once passed while the
parser was broken against the live page (§12.3).

## Keep documentation in sync — do this without being asked

Every one of the docs below has gone stale at least once because a change
landed without it. Update them as part of the change itself, not as a
follow-up someone has to request:

- **`REQUIREMENTS.md`** — add or amend a numbered requirement (`R-<section>.<n>`)
  for any new behavior, changed threshold, or fixed bug that future work could
  silently regress. Cite the id in commit messages.
- **The test count** — `npm test`'s total appears in four places:
  `REQUIREMENTS.md` (§12.4), `AGENTS.md`, `.github/copilot-instructions.md` and
  this file's own "Before committing" section above. Adding or removing a test
  means updating the number in all four, in the same change.
- **`AGENTS.md`** and **`.github/copilot-instructions.md`** — both restate this
  skill's content in shorter form for surfaces that don't load it. A rule
  worth adding here is worth a matching line in both, not just one.
- **This skill file** — if a change adds a new "rule most likely to be broken"
  (a new numbered item candidate above), a new hard constraint, or retires a
  "known open item" by fixing it, update those lists too.

Treat "the docs didn't mention it" the same as a failing test: it means the
change isn't finished yet.

## Known open items

- **Arena-only films** can still show a director in the original-title slot,
  because there is no second source to outrank Arena. Accepted; no reliable
  heuristic was found (§14.2).
- **TMDb holds no Serbian-language trailers** for this catalogue, so posters
  open Croatian or English ones (§8.10). Not fixable from this side.

## Already done — do not "fix" these

- `TMDB_API_KEY` is configured as a repository secret; age ratings, scores and
  cross-language matching are active (§14.1).
- The site is deployed and live at <https://kokice.org>, built and pushed by
  scheduled Actions runs (§14.3). DNS is Cloudflare's and the records are
  **proxied**; GoDaddy is only the registrar. There is deliberately **no
  `CNAME` file** — artifact-based Pages keeps the custom domain in repository
  settings (§13.12).
- Cloudflare Web Analytics is enabled in **automatic** mode and injected at the
  edge; there is no token and no analytics code to find (§16.3).
- **The repository is deliberately still named `CinemaNS` even though the app is
  called Kokice** (§13.8). With a custom domain the slug is internal plumbing no
  visitor sees, so renaming it would churn every remote, badge and reference for
  nothing. This used to read "the rename waits for the domain move" — the domain
  move happened, and the name stays.
- **Cross-venue inconsistency about past screenings is fixed on our side**
  (§7c), because it is upstream policy: measured at 23:17, Cineplexx had pruned
  to the next screening, CineStar still listed 16:00, and Arena had dropped the
  day. Today's page keeps a screening for an hour after it starts and then hides
  it, client-side, so a late-evening page going empty is the correct answer, not
  a bug. The grace period exists because you can still walk into a film that
  began twenty minutes ago; those chips are muted, never struck through, because
  they are working booking links (§7c.2a).
- **Both cities share one page on purpose** (§7b.2). The payload objection was
  measured, not assumed: measured on production, a full day page carrying both
  cities is 157 KB raw but **10.0 KB over the wire** (15.7× gzip, and GitHub
  Pages serves gzip). The known cost is SEO — one page cannot have a
  city-specific `<title>` (§7b.9).
- **CineStar clears Cloudflare from Actions at both venues** via `tlsFallback`
  (§2.7a-ii). Verified in the first production build after Beograd was added.
  Do not go looking for a new workaround unless a build actually fails.
