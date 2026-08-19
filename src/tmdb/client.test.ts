import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TmdbClient, pickTrailer, pickTrailerKey } from './client.js';

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

test('a Serbian trailer wins over an official English one', () => {
  const key = pickTrailerKey({
    results: [
      { key: 'en-official', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en' },
      { key: 'sr-teaser', site: 'YouTube', type: 'Teaser', official: false, iso_639_1: 'sr' },
    ],
  });
  assert.equal(key, 'sr-teaser', 'language matters more to this audience than officiality');
});

test('English is used when nothing regional exists', () => {
  const key = pickTrailerKey({
    results: [{ key: 'en1', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en' }],
  });
  assert.equal(key, 'en1');
});

test('Croatian stands in ahead of English but behind Serbian', () => {
  const results = [
    { key: 'en1', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en' },
    { key: 'hr1', site: 'YouTube', type: 'Trailer', official: false, iso_639_1: 'hr' },
  ];
  assert.equal(pickTrailerKey({ results }), 'hr1');
  assert.equal(
    pickTrailerKey({ results: [...results, { key: 'sr1', site: 'YouTube', type: 'Teaser', iso_639_1: 'sr' }] }),
    'sr1',
  );
});

test('non-YouTube and unknown-language videos are ignored', () => {
  assert.equal(
    pickTrailerKey({
      results: [
        { key: 'vimeo1', site: 'Vimeo', type: 'Trailer', iso_639_1: 'sr' },
        { key: 'nolang', site: 'YouTube', type: 'Trailer' },
      ],
    }),
    undefined,
    'falling back to a YouTube search beats linking a video we cannot vouch for',
  );
});

test('a film with no videos yields no key', () => {
  assert.equal(pickTrailerKey(undefined), undefined);
  assert.equal(pickTrailerKey({ results: [] }), undefined);
});

test('the full order is Serbian, then the neighbours, then English', () => {
  const all = [
    { key: 'en1', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en' },
    { key: 'hr1', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'hr' },
    { key: 'sr1', site: 'YouTube', type: 'Teaser', iso_639_1: 'sr' },
  ];
  assert.equal(pickTrailer({ results: all })?.language, 'sr');
  assert.equal(pickTrailer({ results: all.slice(0, 2) })?.language, 'hr');
  assert.equal(pickTrailer({ results: all.slice(0, 1) })?.language, 'en');
});

test('the Serbian country code breaks ties inside one language band', () => {
  // Distributors sometimes tag a Serbian upload as 'hr' but with country RS.
  assert.equal(
    pickTrailer({
      results: [
        { key: 'hr-hr', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'hr', iso_3166_1: 'HR' },
        { key: 'hr-rs', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'hr', iso_3166_1: 'RS' },
      ],
    })?.key,
    'hr-rs',
  );
});

test('country never outranks language', () => {
  // An English video from Serbia must not beat a Croatian one.
  assert.equal(
    pickTrailer({
      results: [
        { key: 'en-rs', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en', iso_3166_1: 'RS' },
        { key: 'hr-hr', site: 'YouTube', type: 'Teaser', iso_639_1: 'hr', iso_3166_1: 'HR' },
      ],
    })?.key,
    'hr-hr',
  );
});
