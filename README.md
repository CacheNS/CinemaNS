# Kokice

**Live: <https://kokice.org>**

> **Changing anything in this repository?** Read
> [`REQUIREMENTS.md`](REQUIREMENTS.md) first — it is the project's baseline
> specification.

The combined programme of nine cinemas in two cities on one fast page.

**Novi Sad**

| Cinema | Source |
|---|---|
| Arena Cineplex Centar | film pages on `arenacineplex.com` (HTML) |
| Cineplexx Promenada | JSON API `app.cineplexx.rs/api/v1` |
| CineStar BIG | `cinestarcinemas.rs/novi-sad-big` (HTML) |

**Beograd**

| Cinema | Source |
|---|---|
| Cineplexx Delta City, Ušće, BIG, BEO, Galerija | JSON API `app.cineplexx.rs/api/v1` |
| CineStar Ada Mall | `cinestarcinemas.rs/beograd-concept-cinema-ada-mall` (HTML) |

Arena has no Belgrade venue — `arenacineplex.com` is a single cinema with no
location selector at all.

It shows today plus the next 7 days, grouped by film, with age ratings, audience
score, runtime, format (2D/3D/4DX/IMAX/ScreenX) and whether a screening is
dubbed or subtitled. Clicking a poster opens the trailer. The interface itself
is in Serbian.

## How it works

There is no server. Every hour GitHub Actions runs a build that scrapes all
nine venues, merges the films and generates static HTML; GitHub Pages serves it
from a CDN. A visitor's request never triggers scraping, so the page is instant
and cannot go down — the worst case is slightly stale data.

```
GitHub Actions (hourly cron)
  9 venues across Novi Sad + Beograd  (in parallel)
            ↓
     TMDb (titles, age ratings, scores)
            ↓
     merge by film → dist/ → GitHub Pages
```

### Switching city

Both cities are on the same page and the switch is instant, with no reload. That
sounds wasteful and isn't: a day page is ~50–80 KB of very repetitive markup
that gzips **11–14×**, and GitHub Pages does serve gzip. Both cities together
land around 18 KB over the wire — less than a single poster image.

The city is a property of each cinema block, so switching reuses the same filter
loop the dubbing and kids filters already use. Blocks for every city but Novi
Sad are rendered with `hidden` already set and JavaScript only ever *reveals*
them, so with JS disabled the page is still a correct single-city page rather
than a mix of both.

The choice lives in the URL (`?grad=beograd`) and is remembered locally; an
explicit link always wins over the remembered preference.

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

### Trailers

Clicking a poster opens a trailer in a new tab. Where TMDb knows a YouTube video
for the film the link goes straight to it, preferring Serbian, then
Croatian/Bosnian/Serbo-Croatian, then English — language outranks both video
type and officiality, because a Serbian teaser serves this audience better than
an official English trailer.

In practice TMDb currently holds **no Serbian-tagged trailer at all** for this
catalogue, so most posters open a Croatian or English one. That is a gap in
TMDb's data rather than a bug in the ranking, and the build prints the actual
distribution (`Trejleri: hr 10 · en 13 · pretraga 10`) so it stays visible.

Where TMDb has no video, the link becomes a YouTube *search* instead of a guess:
Serbian trailers are usually uploaded by local distributors and are often
missing from TMDb. The tooltip changes accordingly ("Pogledaj trailer" versus
"Potraži trailer na YouTube-u"), so the link never overstates what it knows.

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

The site is served from **<https://kokice.org>**. A fresh fork with no custom
domain lands at `https://<account>.github.io/CinemaNS/` instead.

> **Why is the repository still called `CinemaNS` when the app is Kokice?**
> Because with a custom domain the repository slug is internal plumbing that no
> visitor ever sees. Renaming it would rewrite every remote, badge and
> cross-reference, break existing links and orphan installed PWA copies (their
> scope and `start_url` are origin-relative) for no user-facing gain. This used
> to be framed as a rename deferred until the domain move; the domain move
> happened, and the answer is simply that the name stays.

Every hour the workflow runs the build, commits `data/raw.json` (the last known
good data, which also keeps the scheduled workflow alive) and deploys `dist/`.

> **The repository must be public.** GitHub Pages on private repositories
> requires a paid plan. Also, **a fork will not work** — GitHub disables
> `schedule` workflows in forked repositories, which would stop the hourly
> refresh. If the project needs to change owner, use Settings → Transfer
> ownership rather than forking: the history is kept and the old URL redirects.

## Hosting and DNS

`kokice.org` is registered at GoDaddy, but its DNS is Cloudflare's and the
records are **proxied** (orange cloud), pointing at GitHub Pages. Three things
about that setup are easy to get wrong and fail quietly:

- **Set the records up DNS-only first, and only go proxied once GitHub has
  issued the certificate** and *Enforce HTTPS* is ticked. The proxy can
  interfere with the validation that issues it.
- **SSL/TLS mode must be Full (strict).** Flexible speaks plain HTTP to the
  origin, GitHub redirects it back to HTTPS, and the result is a redirect loop.
- **Leave Bot Fight Mode, Under Attack mode, Cache Everything, APO and Always
  Online off.** The first two can block the ACME challenge and break certificate
  *renewal* months later; the rest cache HTML harder than an hourly rebuild
  allows.

There is deliberately **no `CNAME` file** in the repository: deployment is
artifact-based, so the custom domain lives in repository settings and survives
every deploy. Adding one is the branch-based-Pages instruction and does not
apply here.

## Visit counting

GitHub Pages keeps no access logs and offers no analytics API, and the
repository traffic API counts views of the *repo page* on github.com rather
than of the published site. So the only possible source of visit data is the
visitor's own browser.

The site uses **Cloudflare Web Analytics**, chosen because it is cookieless: it
stores nothing on the device and does not fingerprint, so the site needs no
consent banner.

Because the domain is proxied through Cloudflare, analytics runs in
**automatic** mode: Cloudflare injects the beacon into the HTML at its edge.
There is nothing to configure in this repository — no token, no variable, no
code. Enable it at *Cloudflare dashboard → Web Analytics → Add a site →
`kokice.org` → automatic setup*, and turn it off by deleting the site there.

> **Do not also add the beacon to the page.** Automatic injection plus a tag in
> the built HTML means both fire and every visit is counted twice. A test
> asserts the built page contains no beacon.

> **Do not remove `cloudflareinsights.com` from the CSP in
> `src/render/html.ts`.** Nothing in this repository references those hosts any
> more, so the two allowances look like dead configuration — they are not.
> Deleting them leaves analytics switched on in the dashboard and silently
> recording nothing, because `default-src 'none'` blocks the injected script.

Analytics also stops if a DNS record is ever set back to DNS-only, since
Cloudflare then has no way to inject anything. That is worth remembering,
because grey-clouding for an hour is the standard remedy for a failed
certificate renewal.

Treat the totals as a floor rather than a census: ad blockers, privacy browsers
and some corporate DNS suppress the beacon entirely. The hourly build never
executes it, so automation cannot inflate the count.

## When something breaks

Each cinema is an independent adapter. If one site changes its HTML, the build
reuses that cinema's last known good data and prints a warning on the page that
the data may be out of date; the other cinemas carry on as normal. The build
only fails if every source fails. Stale-data warnings are scoped to the city
they belong to, so a Belgrade outage never worries a Novi Sad reader.

To check the Cineplexx API contract, if their site stops returning data:

```bash
curl -s https://app.cineplexx.rs/api/v1/cinemas \
  -H 'CINEPLEXX-Platform: WEB' \
  -H 'client-key: 308330b1-52a5-4883-aee3-304240c22ea1' | head -c 400
```

That endpoint is also how the build resolves venue numbers: they are looked up
by `cinemaUrlName` at scrape time and never hardcoded, because the live ids are
non-contiguous (there is no 1114 or 1117). If the `client-key` changes, find the
new one in the site's JS bundle and set it as `CINEPLEXX_CLIENT_KEY`.

## Layout

```
src/adapters/   one scraper per cinema
src/core/       types, dates, HTTP, title normalization, merging, age ratings
src/tmdb/       TMDb client (search, alternative titles, certifications)
src/render/     HTML, CSS, client-side JS, PWA icons and manifest
fixtures/       saved HTML/JSON for tests (no network)
data/           raw.json (last known good data) and title-overrides.json
```
