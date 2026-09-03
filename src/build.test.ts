import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { computeAssetVersion, renderServiceWorker } from './build.js';

// This regression covers a real incident: the service worker caches
// style.css/app.js cache-first under a VERSION-keyed cache name (see
// sw.js), so a JS/CSS change that ships without a matching cache-key change
// is invisible to returning/installed users — the (network-first) HTML
// updates immediately, but the assets it depends on stay stale until the
// cache is evicted. Deriving VERSION from the assets' own content removes
// the manual step that was forgotten.
test('the service worker cache version changes whenever the cached assets do', () => {
  const template = "const VERSION = '__CACHE_VERSION__';\nconst CACHE = `kokice-${VERSION}`;\n";

  const before = renderServiceWorker(template, 'body{color:red}' + 'console.log(1)');
  const after = renderServiceWorker(template, 'body{color:blue}' + 'console.log(1)');

  assert.notEqual(before, after, 'a style.css/app.js content change must change the cache version');
  assert.ok(!before.includes('__CACHE_VERSION__'), 'the placeholder must be substituted');
});

test('the service worker cache version is stable for unchanged assets', () => {
  const template = "const VERSION = '__CACHE_VERSION__';\n";
  const a = renderServiceWorker(template, 'same-content');
  const b = renderServiceWorker(template, 'same-content');
  assert.equal(a, b, 'identical asset content must produce identical cache versions');
});

// Regression: the page's <meta name="sw-version"> (read by app.js to build a
// cache-busting sw.js?v= registration URL, R-9.7b) must be the exact same
// value baked into sw.js's own VERSION constant — otherwise a browser could
// register a "new" URL that still points at a worker whose Cache Storage key
// hasn't actually changed, defeating the whole point.
test('the embedded page version matches the service worker cache version', () => {
  const template = "const VERSION = '__CACHE_VERSION__';\n";
  const assets = 'body{color:red}' + 'console.log(1)';

  const version = computeAssetVersion(assets);
  const sw = renderServiceWorker(template, assets);

  assert.ok(sw.includes(`'${version}'`), 'sw.js must embed the same hash computeAssetVersion returns');
});

// Regression for the other half of the same incident (R-9.7c). Bumping the
// cache key is useless if the worker then refills the new cache through the
// browser's HTTP cache, which holds the assets for four hours on GitHub Pages:
// the key changes, the bytes do not, and the reader keeps seeing the old page.
// Reproduced in Chrome against a max-age=14400 server — a default cache.addAll
// stored the previous build's bytes.
test('the worker never fills its cache through the HTTP cache', async () => {
  // sw.js is a static asset, not compiled, so it is read from src/ the same
  // way build.ts reads it — tests run out of lib/, one level below the root.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = await readFile(path.join(root, 'src', 'render', 'sw.js'), 'utf8');

  // Every fetch that can populate Cache Storage has to opt out of the HTTP
  // cache; only the offline fallback reads from Cache Storage instead.
  assert.match(source, /cache: 'reload'/, 'shell and asset fetches must bypass the HTTP cache');
  assert.match(source, /cache: 'no-cache'/, 'document fetches must revalidate, not use max-age');
  assert.ok(
    !/[^.]\bfetch\(request\)/.test(source),
    'a bare fetch(request) reintroduces the stale-bytes bug; wrap it in a Request with a cache mode',
  );
});

// R-7c.2b. A screening inside the grace window is still shown, but its seats
// are off sale, so the chip must stop being a link. Only the browser knows the
// time, so the server ships a real href and app.js takes it away — which makes
// this a one-line change away from silently reverting.
test('a started showtime chip loses its href', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = await readFile(path.join(root, 'src', 'render', 'assets', 'app.js'), 'utf8');

  assert.match(source, /data-href/, 'the original href must be stashed, not discarded');
  assert.match(source, /removeAttribute\('href'\)/, 'a started chip must not stay clickable');
  assert.match(source, /aria-disabled/, 'assistive tech needs the same signal as the muting');
});

// R-8.3c. A variant badge is derived from every showtime in both cities, so it
// outlives its own chips unless apply() re-checks it: Odiseja showed an IMAX
// pill in Novi Sad, where it only ever played 2D.
test('variant badges are re-checked against the visible chips', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = await readFile(path.join(root, 'src', 'render', 'assets', 'app.js'), 'utf8');

  assert.match(source, /\[data-variant\]/, 'apply() must reach the badges');
  assert.match(source, /liveVariants/, 'badge visibility must follow the surviving chips');
});
