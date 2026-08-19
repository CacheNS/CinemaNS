---
name: cinema-requirements
description: Baseline requirements and hard-won data-accuracy rules for the Novi Sad cinema aggregator. Use before changing anything in this repository — scrapers/adapters (Arena, Cineplexx, CineStar), title matching, TMDb enrichment, age ratings, dubbing/subtitling labels, filters, the rendered HTML/CSS, the PWA install flow, or the hourly GitHub Actions build.
---

# Novi Sad cinema aggregator — requirements baseline

## Read this first

The authoritative specification is [`REQUIREMENTS.md`](../../../REQUIREMENTS.md)
at the repository root. Read it before proposing or making a change. Every
requirement there is implemented and verified against the live cinema sites, so
breaking one is a regression.

Requirements have stable ids (`R-10.3`). Cite them when a change touches them.

## Orientation

Static site → built hourly by GitHub Actions → served by GitHub Pages. A
Node.js + TypeScript build scrapes three cinemas in parallel, enriches via TMDb,
merges by movie, and emits one Serbian HTML page per day plus `data.json`.

| Area | Where | Spec |
|---|---|---|
| Scrapers | `src/adapters/{arena,cineplexx,cinestar}.ts` | §1, §10 |
| Title matching | `src/core/titles.ts` | §5 |
| Merging | `src/core/merge.ts` | §5, §10 |
| TMDb + age | `src/tmdb/client.ts`, `src/core/ratings.ts` | §6 |
| Rendering | `src/render/html.ts`, `assets/style.css` | §8 |
| Filters | `src/render/assets/app.js` | §7 |
| PWA | `src/render/icon.ts`, `sw.js` | §9 |
| Build/deploy | `src/build.ts`, `.github/workflows/build.yml` | §3, §13 |

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
   so every cinema shows the same label (§10.4–10.5).
6. **`4DX/3D/TITL` is `"4DX 3D"`** — premium formats compose with 3D (§10.2).
7. **`DS` is not a dubbing marker; CineStar's `.age` is genre** (§10.6–10.7).
8. **Parse Arena by DOM label, not body regex** — its rows run together
   (§10.8).
9. **Europe/Belgrade for every date** (§4.6).
10. **CSS badge modifiers go after the base `.badge` rule** (§15.4).

## Before committing

```
npx tsc --noEmit
npm test          # 54 tests, fixtures only, no network
npm run build     # scrapes live, writes dist/
npm run serve     # http://localhost:3000
```

Add a regression test for every parsing bug you fix, and make the fixture
reproduce the **real** markup — a simplified fixture once passed while the
parser was broken against the live page (§12.3).

## Known open items

- No `TMDB_API_KEY` is configured, so age ratings, scores and the "Za decu"
  filter are inactive or guesswork (§14.1).
- Not yet deployed: needs Pages source set to GitHub Actions and the
  `TMDB_API_KEY` secret (§14.3).
