import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyticsSnippet } from './analytics.js';

const VALID = '0123456789abcdef0123456789abcdef';

test('no token means no script at all', () => {
  assert.equal(analyticsSnippet(undefined), '');
  assert.equal(analyticsSnippet(''), '');
  assert.equal(analyticsSnippet('   '), '');
});

test('a valid token renders the beacon Cloudflare actually issues', () => {
  const html = analyticsSnippet(VALID);
  assert.match(html, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
  // Must mirror Cloudflare's own snippet: beacon.min.js is an ES module, so a
  // classic `defer` script would fail at parse time. Modules are deferred by
  // default, so rendering is still never blocked.
  assert.match(html, /type="module"/);
  assert.doesNotMatch(html, /\bdefer\b/);
  assert.ok(html.includes(`"token": "${VALID}"`));
});

test('surrounding whitespace from a pasted variable is tolerated', () => {
  assert.ok(analyticsSnippet(`  ${VALID}\n`).includes(`"token": "${VALID}"`));
});

test('a malformed token is dropped rather than rendered', () => {
  // Rendering a mistyped token would look like working analytics while
  // silently recording nothing.
  const warnings: unknown[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    assert.equal(analyticsSnippet('not-a-token'), '');
    assert.equal(analyticsSnippet(`${VALID}extra`), '');
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 2, 'the operator must be told why it was skipped');
});

test('a token cannot break out of the attribute it sits in', () => {
  assert.equal(analyticsSnippet(`${VALID}'></script><script>alert(1)</script>`), '');
});
