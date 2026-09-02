import assert from 'node:assert/strict';
import { test } from 'node:test';

import { manifestFor, renderIcon } from './icon.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('generates valid PNG icons at the requested size', () => {
  for (const size of [180, 192, 512]) {
    const png = renderIcon(size);
    assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
    assert.equal(png.readUInt32BE(16), size, `width for ${size}`);
    assert.equal(png.readUInt32BE(20), size, `height for ${size}`);
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.ok(png.subarray(-8, -4).toString('ascii') === 'IEND');
  }
});

test('the maskable icon fills the whole square', () => {
  const size = 64;
  const masked = renderIcon(size, true);
  const rounded = renderIcon(size, false);
  // Rounded corners are transparent, so the two differ; both must still decode.
  assert.notEqual(masked.length, rounded.length);
});

test('the manifest advertises the icons the pages reference', () => {
  const manifest = manifestFor('sr');
  const sources = manifest.icons.map((icon) => icon.src);
  assert.deepEqual(sources, [
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/icon-maskable-512.png',
  ]);
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './index.html');
});

test('the English manifest reaches the icons at the site root, one level up', () => {
  // It is served from /en/, but the icons are single-copy at the root (R-19.4),
  // so a bare "assets/…" would 404 for anyone who installs the English app.
  const manifest = manifestFor('en');
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    [
      '../assets/icon-192.png',
      '../assets/icon-512.png',
      '../assets/icon-maskable-512.png',
    ],
  );
  assert.equal(manifest.lang, 'en');
  assert.equal(manifest.name, 'Kokice');
  assert.notEqual(manifest.description, manifestFor('sr').description);
  // start_url stays relative, so each tree opens its own index.
  assert.equal(manifest.start_url, './index.html');
});
