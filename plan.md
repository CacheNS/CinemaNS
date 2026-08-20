
---

## SHIPPED — security fixes from Plan D

`7059c92` on `main`; run 32366514285 built and deployed green, all three jobs
(`build`, `persist`, `deploy`) succeeding under the new per-job permissions.
Tests 110 -> 122, tsc clean. Recorded as `REQUIREMENTS.md` §17.

The report found 0 critical and 0 high; all 3 medium and the material low
findings are fixed. Highlights:

- The fetch layer now reads the body while the abort timer is still armed. It
  used to clear the timeout as soon as headers arrived, so a body that never
  ended hung the build with nothing left to interrupt it.
- Responses are size-capped while streaming, redirects are followed by hand
  (five hops, http/https only), and the `curl_cffi` child gets a 60 s deadline
  and SIGKILL reaping.
- `safeUrl()` guards every `href`/`src`. `escapeHtml` never stopped
  `javascript:` — there is nothing in it to escape.
- A strict CSP (`default-src 'none'`, no `unsafe-inline`) ships on every page.
- Workflow permissions are per job: the scraper job has no write access at all.
  The `raw.json` commit moved to its own job but stayed, because it is also the
  activity that stops GitHub disabling the hourly schedule.
- Actions SHA-pinned, `curl_cffi==0.16.0`, `npm ci --ignore-scripts`,
  `.github/dependabot.yml` added.

Production verified in a browser, not just by grepping the HTML: **zero CSP
violations**, stylesheet applied, 19 cards, TMDb posters and age badges present,
service worker registered, city switch working, and the Cloudflare beacon both
loaded and completed its RUM POST — so analytics survived the policy.

One thing left that cannot be done from code: **Dependabot alerts are still
disabled** and must be turned on under Settings → Code security. The API refuses
the token (404), so this is yours to click (R-17.17).
