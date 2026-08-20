import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanTitle,
  detectAudio,
  detectFormat,
  normalizeTitle,
  similarity,
  tidyDisplayTitle,
  toSerbianLatin,
  transliterate,
} from './titles.js';

test('transliterates Cyrillic and folds diacritics', () => {
  assert.equal(transliterate('Приča о играčkama'), 'Prica o igrackama');
  assert.equal(transliterate('LETO ZA PAMĆENJE'), 'LETO ZA PAMCENJE');
  assert.equal(transliterate('Đorđe'), 'Djordje');
});

test('strips format and version noise from titles', () => {
  assert.equal(cleanTitle('MALCI I MONSTRUMI 3D (sinhronizovano)'), 'MALCI I MONSTRUMI');
  assert.equal(cleanTitle('PRIČA O IGRAČKAMA 5 (sinhronizovano)'), 'PRIČA O IGRAČKAMA 5');
  assert.equal(cleanTitle('HAJDUK U BEOGRADU DS'), 'HAJDUK U BEOGRADU');
  assert.equal(cleanTitle('Spajdermen: Novi dan 3D'), 'Spajdermen: Novi dan');
});

test('normalizes different cinema spellings to the same key', () => {
  assert.equal(normalizeTitle('SPAJDERMEN:NOVI DAN 3D'), normalizeTitle('Spajdermen: Novi dan'));
  assert.equal(normalizeTitle('LETO ZA PAMĆENJE'), normalizeTitle('Leto za pamćenje'));
  assert.equal(
    normalizeTitle('ASTRALNA PODMUKLOST : ONI SU MEĐU NAMA'),
    normalizeTitle('Astralna podmuklost: Oni su među nama'),
  );
});

test('similarity separates near-identical titles from different films', () => {
  assert.equal(similarity('Patrolne šape - Dino avantura', 'Patrolne šape: Dino avantura'), 1);
  assert.ok(similarity('Odiseja', 'Opsesija') < 0.82);
  assert.ok(similarity('Vajana', 'Vajana 2') < 1);
});

test('detects dubbing only from explicit markers', () => {
  assert.equal(detectAudio('MAGIČNO DALEKO DRVO(sinhronizovano) DS'), 'dubbed');
  assert.equal(detectAudio('KIDS/SINH'), 'dubbed');
  assert.equal(detectAudio('TITL'), 'subtitled');
  assert.equal(detectAudio('OV'), 'subtitled');
  // Nothing recognizable must never be silently called subtitled.
  assert.equal(detectAudio('Spajdermen: Novi dan'), 'unknown');
  assert.equal(detectAudio(''), 'unknown');
});

test('detects projection format', () => {
  assert.equal(detectFormat('4DX/3D/TITL'), '4DX');
  assert.equal(detectFormat('3D/TITL'), '3D');
  assert.equal(detectFormat('SCREENX/TITL'), 'ScreenX');
  assert.equal(detectFormat('TITL'), '2D');
});

test('toSerbianLatin keeps the diacritics that transliterate() folds', () => {
  // transliterate() is for matching and asciifies; display must not.
  assert.equal(toSerbianLatin('Научна фантастика'), 'Naučna fantastika');
  assert.equal(toSerbianLatin('Хорор'), 'Horor');
  assert.equal(toSerbianLatin('Трилер'), 'Triler');
  assert.equal(toSerbianLatin('Цртани'), 'Crtani');
  assert.equal(toSerbianLatin('Породични'), 'Porodični');
  assert.equal(toSerbianLatin('Љубавни'), 'Ljubavni');
});

test('toSerbianLatin maps every Serbian Cyrillic letter', () => {
  assert.equal(
    toSerbianLatin('абвгдђежзијклљмнњопрстћуфхцчџш'),
    'abvgdđežzijklljmnnjoprstćufhcčdžš',
  );
});

test('a digraph in an all-caps run stays all-caps', () => {
  // "ЉУБАВ" is "LJUBAV", not "LjUBAV"; the digraph's own case cannot tell.
  assert.equal(toSerbianLatin('ЉУБАВ'), 'LJUBAV');
  assert.equal(toSerbianLatin('ЊЕГОШ'), 'NJEGOŠ');
  assert.equal(toSerbianLatin('ЏЕМ'), 'DŽEM');
  // ...but a normally capitalised word must not be shouted.
  assert.equal(toSerbianLatin('Његош'), 'Njegoš');
  assert.equal(toSerbianLatin('Џем'), 'Džem');
});

test('toSerbianLatin leaves Latin and punctuation untouched, and is idempotent', () => {
  const latin = 'Spider-Man: Brand New Day (2026) — 4DX/3D';
  assert.equal(toSerbianLatin(latin), latin);
  const once = toSerbianLatin('Спајдермен: Нови дан');
  assert.equal(toSerbianLatin(once), once);
});

test('an absurdly long title is capped instead of stalling the build', () => {
  // The noise-stripping regexes are quadratic in input length (measured: 64 KB
  // takes ~0.7 s, ~1 MB takes minutes), so an upstream page could otherwise
  // hang the hourly build with a single title.
  const absurd = `${'('.repeat(40000)}Film 3D`;
  const started = Date.now();
  const cleaned = cleanTitle(absurd);
  const display = tidyDisplayTitle(absurd);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `title cleaning took ${elapsed}ms`);
  assert.ok(cleaned.length <= 300);
  assert.ok(display.length <= 300);
});

test('the cap is far above any real title', () => {
  const real = 'Spider-Man: Brand New Day (3D, sinhronizovano)';
  assert.equal(cleanTitle(real), cleanTitle(real));
  assert.ok(cleanTitle(real).length > 0);
});
