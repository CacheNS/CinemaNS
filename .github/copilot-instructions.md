# Copilot instructions — Novi Sad Cinema Aggregator

**Read [`REQUIREMENTS.md`](../REQUIREMENTS.md) before making any change to this
repository.** It is the baseline specification: every requirement in it is
implemented and verified against the live cinema websites. If a change breaks
one, that is a regression, not a refactor. Reference requirement ids (`R-10.3`)
in commit messages and PR descriptions when a change touches them.

## What this is

A static site, rebuilt hourly by GitHub Actions and served by GitHub Pages, that
scrapes and merges showtimes from three Novi Sad cinemas (Arena Centar,
Cineplexx Promenada, CineStar BIG), enriches them via TMDb, and renders one
Serbian-language HTML page per day.

## Non-negotiable constraints

- **No runtime server, database, or frontend framework.** The build produces
  plain HTML/CSS/JS. There must be nothing to keep alive.
- **TMDb is enrichment, never a hard dependency.** The build must fully succeed
  with no API key — titles then merge by fuzzy matching and age badges read
  "Uzrast nepoznat".
- **Dubbing is a property of the showtime, not the film.** The same film runs
  dubbed in the afternoon and subtitled in the evening, so the dubbed filter
  hides individual chips and only then empties cards.
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
- CineStar is behind Cloudflare and 403s from datacenter IPs, so it alone is
  fetched with `browserLike: true` browser headers (R-2.7a). A scraper can fail
  in CI while passing locally — read the Actions log, don't re-run locally.

## Working in this repo

- `npm test` (54 tests, no network — fixtures only) and `npx tsc --noEmit` must
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
