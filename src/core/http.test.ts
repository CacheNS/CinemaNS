import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchText } from './http.js';
import { resetInterpreterCache } from './impersonate.js';

interface Call {
  url: string;
  headers: Record<string, string>;
}

/**
 * Replaces global fetch with one that answers from `statuses` in order, so a
 * retry sequence can be asserted without touching the network.
 */
function stubFetch(statuses: number[]): { calls: Call[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
    const status = statuses[Math.min(index++, statuses.length - 1)]!;
    return new Response('<html></html>', { status });
  }) as unknown as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('a bot-protection 403 is retried rather than accepted as final', async () => {
  const stub = stubFetch([403, 403, 200]);
  try {
    const body = await fetchText('https://cinestarcinemas.rs/novi-sad-big');
    assert.match(body, /<html>/);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 3, '403 must be retried, since it is a scoring decision');
});

test('a genuine 404 is not retried', async () => {
  const stub = stubFetch([404]);
  try {
    await assert.rejects(() => fetchText('https://example.test/missing'), /HTTP 404/);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 1, 'asking again for a missing page helps nobody');
});

test('browserLike sends the header set Cloudflare expects of a real navigation', async () => {
  const stub = stubFetch([200]);
  try {
    await fetchText('https://cinestarcinemas.rs/novi-sad-big', { browserLike: true });
  } finally {
    stub.restore();
  }

  const headers = stub.calls[0]!.headers;
  assert.match(headers['User-Agent']!, /Mozilla\/5\.0/);
  assert.equal(headers['Sec-Fetch-Mode'], 'navigate');
  assert.equal(headers['Sec-Fetch-Dest'], 'document');
  assert.ok(headers['Accept']?.includes('text/html'));
  assert.equal(headers['Accept-Language'], 'sr-RS,sr;q=0.9,en;q=0.8');
});

test('other hosts keep the honest, identifiable User-Agent', async () => {
  const stub = stubFetch([200]);
  try {
    await fetchText('https://www.arenacineplex.com/');
  } finally {
    stub.restore();
  }

  const ua = stub.calls[0]!.headers['User-Agent']!;
  assert.match(ua, /CinemaNS/);
  assert.doesNotMatch(ua, /Mozilla/);
});

test('a 403 without tlsFallback still surfaces as an HTTP error', async () => {
  const stub = stubFetch([403]);
  try {
    await assert.rejects(() => fetchText('https://cinestarcinemas.rs/novi-sad-big'), /HTTP 403/);
  } finally {
    stub.restore();
  }
});

test('tlsFallback reports the original 403 when the impersonator is unavailable', async () => {
  // A missing interpreter must not mask the real diagnosis, which is that the
  // host returned 403. Forced off so the test never depends on what happens to
  // be installed, and never reaches the network.
  process.env['CINEMANS_DISABLE_IMPERSONATE'] = '1';
  resetInterpreterCache();
  const stub = stubFetch([403]);
  try {
    await assert.rejects(
      () => fetchText('https://cinestarcinemas.rs/novi-sad-big', { tlsFallback: true }),
      (error: Error) => {
        assert.match(error.message, /HTTP 403/);
        assert.doesNotMatch(error.message, /curl_cffi nije dostupan/);
        return true;
      },
    );
  } finally {
    stub.restore();
    resetInterpreterCache();
  }
});
