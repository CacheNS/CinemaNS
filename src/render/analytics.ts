/**
 * Cloudflare Web Analytics.
 *
 * Chosen because GitHub Pages exposes no access logs of its own: the repository
 * traffic API counts views of the repo page on github.com, not of the published
 * site, so a count can only come from the visitor's browser.
 *
 * The beacon sets no cookies and stores nothing on the device, which is why the
 * site still needs no consent banner under the ZZPL/GDPR — the reason this was
 * preferred over Google Analytics.
 */

/** Cloudflare issues a 32-character hex site tag. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * Returns the beacon script, or '' when no token is configured.
 *
 * A malformed token yields '' plus a warning rather than a broken tag: the
 * token is pasted by hand into a repository variable, and a silently
 * mistyped one that still renders would look like it was working.
 */
export function analyticsSnippet(token: string | undefined): string {
  const trimmed = token?.trim();
  if (!trimmed) return '';

  if (!TOKEN_PATTERN.test(trimmed)) {
    console.warn(
      'CF_BEACON_TOKEN ne liči na Cloudflare token (32 heksadecimalna znaka) — analitika je preskočena.',
    );
    return '';
  }

  // Mirrors Cloudflare's own issued snippet exactly, including `type="module"`.
  // beacon.min.js is served as an ES module, so loading it as a classic script
  // would fail at parse time. A module is deferred by default, so this still
  // never blocks rendering.
  return `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${trimmed}"}'></script>`;
}
