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
      cache
        .addAll([
          './',
          './index.html',
          './en/',
          './en/index.html',
          './assets/style.css',
          './assets/app.js',
        ])
        .catch(() => undefined),
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
      fetch(request)
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
        fetch(request).then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
