# AGENTS.md

**Read [`REQUIREMENTS.md`](REQUIREMENTS.md) first.** It is the baseline
specification for this repository — every requirement in it is implemented and
verified against the live cinema websites. Breaking one is a regression, not a
refactor. Requirements have stable ids (`R-10.3`); cite them in commits and PRs.

For the condensed version, see
[`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## What this is

A static site, rebuilt hourly by GitHub Actions and served by GitHub Pages, that
scrapes and merges movie showtimes from three Novi Sad cinemas — Arena Centar,
Cineplexx Promenada and CineStar BIG — enriches them via TMDb, and renders one
Serbian-language page per day plus a reusable `data.json`.

## Commands

```
npm test          # 54 tests, fixtures only, no network
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
  merge level so all three cinemas agree.

## Conventions

- Adapters stay isolated with fixture-based tests, so a site's HTML change
  breaks one cinema visibly rather than the whole build.
- Add a regression test for every parsing bug fixed, and make the fixture
  reproduce the *real* markup — a simplified fixture once passed while the
  parser was broken against the live page.
- CSS badge modifier rules must stay after the base `.badge` rule.
