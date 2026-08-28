import assert from 'node:assert/strict';
import { test } from 'node:test';

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
