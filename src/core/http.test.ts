import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchText } from './http.js';

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
