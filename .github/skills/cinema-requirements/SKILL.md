---
name: cinema-requirements
description: Baseline requirements and hard-won data-accuracy rules for Kokice, the Novi Sad + Beograd cinema aggregator. Use before changing anything in this repository — scrapers/adapters (Arena, Cineplexx, CineStar), title matching, TMDb enrichment, age ratings, dubbing/subtitling labels, filters, the city switcher, the rendered HTML/CSS, the PWA install flow, or the hourly GitHub Actions build.
---

# Kokice (Novi Sad + Beograd cinema aggregator) — requirements baseline

## Read this first

The authoritative specification is [`REQUIREMENTS.md`](../../../REQUIREMENTS.md)
at the repository root. Read it before proposing or making a change. Every
requirement there is implemented and verified against the live cinema sites, so
breaking one is a regression.

Requirements have stable ids (`R-10.3`). Cite them when a change touches them.

## Orientation

Static site → built hourly by GitHub Actions → served by GitHub Pages. A
Node.js + TypeScript build scrapes nine venues across two cities in parallel,
enriches via TMDb, merges by movie, and emits one Serbian HTML page per day plus `data.json`.

| Area | Where | Spec |
|---|---|---|
| Scrapers | `src/adapters/{arena,cineplexx,cinestar}.ts` | §1, §10 |
| Title matching | `src/core/titles.ts` | §5 |
| Merging | `src/core/merge.ts` | §5, §10 |
| TMDb + age | `src/tmdb/client.ts`, `src/core/ratings.ts` | §6 |
| Rendering | `src/render/html.ts`, `assets/style.css` | §8 |
| Filters | `src/render/assets/app.js` | §7 |
| City switch | `src/core/types.ts` (registry), `html.ts`, `app.js` | §1, §7b |
| PWA | `src/render/icon.ts`, `sw.js` | §9 |
| Build/deploy | `src/build.ts`, `.github/workflows/build.yml` | §3, §13 |
| Trailers | `src/core/trailer.ts`, `src/tmdb/client.ts` | §8.10–8.11 |
| Analytics | `src/render/analytics.ts` | §16 |

## The rules most likely to be broken by a well-meaning change

1. **Do not add a server, database or frontend framework.** The whole design
   exists to have no runtime (§15.1).
2. **Do not make TMDb required.** The build must succeed with no API key
   (§5.3). It currently runs without one.
3. **Dubbing is per-showtime.** Filtering at the card level shows cards whose
   listed times are actually subtitled — the exact mistake a parent gets burned
   by (§7.2–7.3).
4. **Metadata trust order is cineplexx → cinestar → arena** (§10.3). Arena's
   film page is positional prose, so it yields the *director* when a film has no
   original title, and it rounds runtimes.
5. **Domestic Serbian films are `audio: 'original'`**, remapped at merge level
   so every cinema shows the same label (§10.4–10.5). The country signal comes
   only from Arena, which exists only in Novi Sad, so TMDb's
   `original_language == 'sr'` is a second signal for Beograd (§10.5.1) —
   Serbian only, since a Croatian film is not "domaći".
6. **`4DX/3D/TITL` is `"4DX 3D"`** — premium formats compose with 3D (§10.2).
7. **`DS` is not a dubbing marker; CineStar's `.age` is genre** (§10.6–10.7).
8. **Parse Arena by DOM label, not body regex** — its rows run together
   (§10.8).
9. **Europe/Belgrade for every date** (§4.6).
10. **CSS badge modifiers go after the base `.badge` rule** (§15.4).
11. **CineStar needs `tlsFallback`.** It sits behind a Cloudflare TLS-fingerprint
    challenge and 403s from CI; headers and even headless Chromium do not clear
    it (§2.7a). It can pass locally and fail in CI — read the Actions log.
12. **The trailer language order (sr → sh/hr/bs → en) is already correct.** TMDb
    held zero `sr` trailers across 33 films, so Croatian ones are a legitimate
    fallback, not a bug. Check the build's `Trejleri:` line first (§8.10).
13. **`CF_BEACON_TOKEN` is public by design and that is not a leak** (§16.10).
    It ships in the HTML because the visitor's browser reports the page view.
    Keep it a repository *variable*; a secret would hide it from logs while
    leaving it just as visible on the site. Keep the beacon `type="module"`.
14. **Serbian Latin only, never Cyrillic** (§8.12). TMDb's `sr-RS` responses are
    Cyrillic and are converted at the TMDb boundary, with `escapeHtml` as a
    second net. Use `toSerbianLatin()` for display; `transliterate()` folds
    diacritics and exists only for matching. The conversion is not cosmetic —
    Cyrillic genres matched nothing in the Latin-only `ADULT_GENRES`, so the
    age heuristic was silently returning no estimate (§10.12).
15. **`CinemaId` is a venue, not a chain** (§4.7). Beograd has five Cineplexx
    venues; a chain-level id would merge Delta City with Galerija into one
    block. Chain-level facts such as metadata trust key on `Cinema.chain`
    (§4.8).
16. **Cineplexx venue numbers are resolved from `/api/v1/cinemas` by
    `cinemaUrlName`, never hardcoded** (§4.10) — the live ids are
    non-contiguous (`1114` and `1117` do not exist), so a guessed id quietly
    scrapes the wrong cinema.
17. **Every city but the default renders pre-hidden, and JS only reveals**
    (§7b.4). This is the one place a no-JS superset is *wrong* rather than
    merely broad: a Novi Sad reader must never see Belgrade showtimes. Counts,
    empty state, subtitle and stale-source notices are all per city (§7b.5).
18. **Arena exists only in Novi Sad** (§1.2.1) — its site has no location
    selector at all. Do not try to parameterize it by city.

## Before committing

```
npx tsc --noEmit
npm test          # 104 tests, fixtures only, no network
npm run build     # scrapes live, writes dist/
npm run serve     # http://localhost:3000
```

Add a regression test for every parsing bug you fix, and make the fixture
reproduce the **real** markup — a simplified fixture once passed while the
parser was broken against the live page (§12.3).

## Known open items

- **Arena-only films** can still show a director in the original-title slot,
  because there is no second source to outrank Arena. Accepted; no reliable
  heuristic was found (§14.2).
- **TMDb holds no Serbian-language trailers** for this catalogue, so posters
  open Croatian or English ones (§8.10). Not fixable from this side.

## Already done — do not "fix" these

- `TMDB_API_KEY` is configured as a repository secret; age ratings, scores and
  cross-language matching are active (§14.1).
- The site is deployed and live at <https://cachens.github.io/CinemaNS/>,
  built and pushed hourly by Actions (§14.3).
- Cloudflare Web Analytics is enabled via the `CF_BEACON_TOKEN` variable (§16).
- **The repository is deliberately still named `CinemaNS` even though the app is
  called Kokice** (§13.8). Renaming it would change the Pages URL, break
  bookmarks, orphan installed PWA copies and reset the analytics history — for a
  URL that still would not be `kokice.org`. The rename waits for the domain move
  and happens once.
- **Both cities share one page on purpose** (§7b.2). The payload objection was
  measured, not assumed: measured on production, a full day page carrying both
  cities is 157 KB raw but **10.0 KB over the wire** (15.7× gzip, and GitHub
  Pages serves gzip). The known cost is SEO — one page cannot have a
  city-specific `<title>` (§7b.9).
- **CineStar clears Cloudflare from Actions at both venues** via `tlsFallback`
  (§2.7a-ii). Verified in the first production build after Beograd was added.
  Do not go looking for a new workaround unless a build actually fails.
