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
  assert.match(ua, /Kokice/);
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
  process.env['KOKICE_DISABLE_IMPERSONATE'] = '1';
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

/**
 * A body that never ends. The stub's stream is deliberately NOT wired to the
 * abort signal, which is the pessimistic case: it proves the read layer itself
 * enforces the deadline rather than relying on the runtime to do it.
 */
function stubStalledBody(): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'));
          // ...and then nothing, ever.
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  return { restore: () => (globalThis.fetch = original) };
}

test('a stalled response body loses to the request deadline', async () => {
  // The timeout used to be cleared the moment headers arrived, so a body that
  // never finished hung the hourly build with nothing left to interrupt it.
  const stub = stubStalledBody();
  const started = Date.now();
  try {
    await assert.rejects(
      () => fetchText('https://example.test/stall', { timeoutMs: 200, retries: 0 }),
      /Isteklo vreme|aborted|abort/i,
    );
  } finally {
    stub.restore();
  }
  assert.ok(Date.now() - started < 5000, 'must abort promptly rather than hang');
});

test('an oversized response body is abandoned rather than buffered', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('x'.repeat(50_000), { status: 200 })) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () => fetchText('https://example.test/huge', { maxBytes: 1024, retries: 0 }),
      /prelazi 1024/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('a declared Content-Length over the cap is rejected before the body is read', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('short', {
      status: 200,
      headers: { 'content-length': '99999999' },
    })) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () => fetchText('https://example.test/lying', { maxBytes: 2048, retries: 0 }),
      /prelazi 2048/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('redirects are followed, but only a bounded number of times', async () => {
  const original = globalThis.fetch;
  let hops = 0;
  globalThis.fetch = (async (url: string) => {
    hops++;
    // An endless redirect loop, which is what a hostile or broken host serves.
    return new Response('', {
      status: 302,
      headers: { location: `https://example.test/${hops}` },
    });
  }) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () => fetchText('https://example.test/loop', { retries: 0 }),
      /Previše preusmeravanja/,
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(hops <= 7, `redirect chain must be bounded, took ${hops} hops`);
});

test('a redirect to a non-http scheme is refused', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('', {
      status: 302,
      headers: { location: 'file:///etc/passwd' },
    })) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () => fetchText('https://example.test/jump', { retries: 0 }),
      /Nedozvoljena šema/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
