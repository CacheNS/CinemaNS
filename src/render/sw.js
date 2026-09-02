/**
 * Offline shell for the installed app. Pages are network-first so the hourly
 * refresh always wins when there is a connection; assets are cache-first.
 *
 * VERSION is substituted at build time (see `renderServiceWorker` in
 * build.ts) with a hash of style.css + app.js, so a content change
 * automatically evicts stale cached assets for installed/returning users —
 * this used to be a manually-bumped literal, and shipping a JS/CSS change
 * without remembering to bump it left returning visitors on stale assets
 * while the (network-first) HTML had already moved on, so the site looked
 * broken until they cleared storage. Hashing removes the step that can be
 * forgotten.
 */
const VERSION = '__CACHE_VERSION__';
const CACHE = `kokice-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './en/',
  './en/index.html',
  './assets/style.css',
  './assets/app.js',
];

/**
 * Every request this worker makes to fill its own cache must skip the browser's
 * HTTP cache, because GitHub Pages serves the assets with `max-age=14400`
 * (measured) and `sw.js` with the same.
 *
 * Without this, bumping VERSION changed the cache *key* but not the cached
 * *bytes*: the new worker installed correctly (R-9.7b), then re-filled its
 * brand-new cache from the four-hour-old HTTP cache entries and served that
 * stale CSS/JS cache-first until the TTL expired. That is the "I still see the
 * old page after a deploy" report, and why bumping the version alone never
 * fixed it. Reproduced in Chrome against a `max-age=14400` server: a default
 * `cache.addAll` stored the previous build's bytes, `{ cache: 'reload' }`
 * stored the current ones.
 */
function uncached(request) {
  return new Request(request, { cache: 'reload' });
}

/**
 * Only a successful, same-origin response is worth storing. Without this gate a
 * 404 or a 500 from a bad deploy gets cached and then served back offline as if
 * it were the page, and an opaque cross-origin response would be stored blind.
 * Redirects are excluded too: caching one under the original request URL pins a
 * redirect that may not survive the next build.
 */
function isCacheable(response) {
  return response.ok && response.type === 'basic' && !response.redirected;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL.map((url) => uncached(new Request(url)))).catch(() => undefined),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = request.mode === 'navigate' || url.pathname.endsWith('.html');

  if (isDocument) {
    event.respondWith(
      // Revalidated rather than reloaded: pages carry `max-age=600`, so a plain
      // fetch() makes "network-first" a lie for ten minutes and delays the
      // whole update chain, since the HTML is what carries the sw-version tag.
      // 'no-cache' still allows a cheap 304 when nothing changed.
      fetch(new Request(request, { cache: 'no-cache' }))
        .then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        // A miss right after a version bump is exactly the case that must not
        // be answered out of the stale HTTP cache.
        fetch(uncached(request)).then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
