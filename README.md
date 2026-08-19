# Cinemas in Novi Sad

**Live: <https://cachens.github.io/CinemaNS/>**

> **Changing anything in this repository?** Read
> [`REQUIREMENTS.md`](REQUIREMENTS.md) first — it is the project's baseline
> specification.

The combined programme of three Novi Sad cinemas on one fast page:

| Cinema | Source |
|---|---|
| Arena Cineplex Centar | film pages on `arenacineplex.com` (HTML) |
| Cineplexx Promenada | JSON API `app.cineplexx.rs/api/v1` |
| CineStar BIG | `cinestarcinemas.rs/novi-sad-big` (HTML) |

It shows today plus the next 7 days, grouped by film, with age ratings, audience
score, runtime, format (2D/3D/4DX/IMAX/ScreenX) and whether a screening is
dubbed or subtitled. The interface itself is in Serbian.

## How it works

There is no server. Every hour GitHub Actions runs a build that scrapes all
three sites, merges the films and generates static HTML; GitHub Pages serves it
from a CDN. A visitor's request never triggers scraping, so the page is instant
and cannot go down — the worst case is slightly stale data.

```
GitHub Actions (hourly cron)
  arena | cineplexx | cinestar  (in parallel)
            ↓
     TMDb (titles, age ratings, scores)
            ↓
     merge by film → dist/ → GitHub Pages
```

### Matching titles across cinemas

The same film is spelled differently at every cinema, sometimes in Serbian and
sometimes in English ("SPAJDERMEN:NOVI DAN" / "Spajdermen: Novi dan 3D" /
"Spider-Man: Brand New Day"). Titles are first normalized (Cyrillic → Latin,
diacritics and format markers removed), and then — when TMDb is available — each
film is reduced to a TMDb id, which is the real merge key. Without a TMDb key,
merging falls back to comparing every title variant (Dice similarity).
Exceptions are fixed by hand in `data/title-overrides.json`, with no code
change.

### Age ratings and scores

The cinemas do not publish a usable age rating (Cineplexx returns `o.A.` for
every film), so TMDb is used instead: certifications in the order
RS → HR → SI → DE/AT → GB → US, reduced to a minimum age. Where no certification
exists, a genre-based guess is used and is **visibly marked as a guess**. The
audience score is TMDb's `vote_average`, shown only from 20 votes upwards.

**Without `TMDB_API_KEY` the site still works**, but there are no age ratings
and no scores, and the "for children" filter relies on genre alone.

## The TMDb key

Use the **API Key (v3 auth)** — the short 32-character hex string — **not** the
"API Read Access Token" (the long JWT starting with `eyJ`). This client
authenticates with `?api_key=…`, which is v3 auth; the read access token is a v4
bearer credential and is rejected on that endpoint.

Get one at <https://www.themoviedb.org/settings/api> (free, requires an
account).

Where it goes:

| Where | What |
|---|---|
| GitHub Actions | a **repository secret** named `TMDB_API_KEY` — Settings → Secrets and variables → Actions → *Secrets* tab → New repository secret |
| Locally | an environment variable, most easily via a `.env` file (see `.env.example`) |

It must be a *secret*, not a *variable*: repository variables are visible to
anyone who can see the repo, and are exposed in build logs. The workflow passes
the secret to the build as an environment variable, so both environments use the
same code path.

Worth checking the key before saving it, which is quicker than waiting an hour
for a build to tell you it was the wrong one:

```bash
curl -s "https://api.themoviedb.org/3/movie/550?api_key=YOUR_KEY" | head -c 200
# a film title  => the key works
# {"status_code":7,...} => invalid key, or you pasted the v4 read access token
```

`TMDB_API_KEY` is deliberately optional at every level, so a missing or invalid
key degrades the site rather than failing the build (see R-5.3 in
`REQUIREMENTS.md`).

## Running locally

```bash
npm install
cp .env.example .env      # then fill in TMDB_API_KEY (optional but recommended)

npm run build             # scrapes everything and generates dist/
npm run serve             # http://localhost:3000
npm run report            # diagnostics only, without generating the site
npm test                  # tests against saved fixtures, no network
```

`npm run report` prints the number of films and screenings per cinema, TMDb
coverage, how many films were merged across cinemas and how many screenings have
an unknown language — the quickest way to see whether a parser has broken.

## Installing as an app

The site is a PWA. On Android (Chrome) the button in the footer triggers a real
install. iPhone Safari has no automatic install, so the button shows the
instructions instead: **Share → "Add to Home Screen"**. The installed version
also works offline with the programme it last loaded.

## Deploying

`.github/workflows/build.yml` does everything automatically. First publish:

```bash
# Publish the code as the main branch (needs an account with push access)
git push -u origin HEAD:main
```

Then configure the repository once:

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions**
   - secret `TMDB_API_KEY` — without it there are no age ratings or scores
   - (optional) variable `CINEPLEXX_CLIENT_KEY`
3. **Actions → Build and deploy → Run workflow** for the first build, or wait
   for the next full hour.

The site will be at `https://<account>.github.io/CinemaNS/`.

Every hour the workflow runs the build, commits `data/raw.json` (the last known
good data, which also keeps the scheduled workflow alive) and deploys `dist/`.

> **The repository must be public.** GitHub Pages on private repositories
> requires a paid plan. Also, **a fork will not work** — GitHub disables
> `schedule` workflows in forked repositories, which would stop the hourly
> refresh. If the project needs to change owner, use Settings → Transfer
> ownership rather than forking: the history is kept and the old URL redirects.

## When something breaks

Each cinema is an independent adapter. If one site changes its HTML, the build
reuses that cinema's last known good data and prints a warning on the page that
the data may be out of date; the other cinemas carry on as normal. The build
only fails if all three sources fail.

To check the Cineplexx API contract, if their site stops returning data:

```bash
curl -s https://app.cineplexx.rs/api/v1/cinemas \
  -H 'CINEPLEXX-Platform: WEB' \
  -H 'client-key: 308330b1-52a5-4883-aee3-304240c22ea1' | head -c 400
```

Novi Sad is `cinemaId` **1116**. If the `client-key` changes, find the new one
in the site's JS bundle and set it as `CINEPLEXX_CLIENT_KEY`.

## Layout

```
src/adapters/   one scraper per cinema
src/core/       types, dates, HTTP, title normalization, merging, age ratings
src/tmdb/       TMDb client (search, alternative titles, certifications)
src/render/     HTML, CSS, client-side JS, PWA icons and manifest
fixtures/       saved HTML/JSON for tests (no network)
data/           raw.json (last known good data) and title-overrides.json
```
