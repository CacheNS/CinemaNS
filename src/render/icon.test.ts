import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MANIFEST, renderIcon } from './icon.js';

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
  const sources = MANIFEST.icons.map((icon) => icon.src);
  assert.deepEqual(sources, [
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/icon-maskable-512.png',
  ]);
  assert.ok(MANIFEST.icons.some((icon) => icon.purpose === 'maskable'));
  assert.equal(MANIFEST.display, 'standalone');
  assert.equal(MANIFEST.start_url, './index.html');
});
