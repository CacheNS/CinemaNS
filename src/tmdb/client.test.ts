import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TmdbClient } from './client.js';

/** Swap in a fetch that always answers with `status`, restoring the original. */
async function withStubbedFetch<T>(status: number, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status_code: 7 }), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function captureWarnings(): { messages: string[]; restore: () => void } {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.join(' '));
  };
  return { messages, restore: () => (console.warn = original) };
}

test('a rejected key is reported instead of looking like no key at all', async () => {
  const warnings = captureWarnings();
  try {
    await withStubbedFetch(401, async () => {
      const client = new TmdbClient('an-api-read-access-token');
      const result = await client.resolve({ cleanTitle: 'Spider-Man', rawTitles: ['Spider-Man'] });
      assert.equal(result, null, 'a rejected key must degrade, never throw');
    });
  } finally {
    warnings.restore();
  }

  assert.equal(warnings.messages.length, 1, 'the key problem must be stated exactly once');
  assert.match(warnings.messages[0]!, /401/);
  assert.match(warnings.messages[0]!, /API Read Access Token/);
});

test('an ordinary outage does not blame the key', async () => {
  const warnings = captureWarnings();
  try {
    await withStubbedFetch(500, async () => {
      const client = new TmdbClient('a-valid-looking-key');
      await client.resolve({ cleanTitle: 'Dune', rawTitles: ['Dune'] });
    });
  } finally {
    warnings.restore();
  }

  assert.deepEqual(warnings.messages, []);
});

test('the client stays disabled without a key', async () => {
  const client = new TmdbClient(undefined);
  assert.equal(client.enabled, false);
  assert.equal(await client.resolve({ cleanTitle: 'Dune', rawTitles: ['Dune'] }), null);
});
