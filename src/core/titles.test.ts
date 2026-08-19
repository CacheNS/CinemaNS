import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanTitle,
  detectAudio,
  detectFormat,
  normalizeTitle,
  similarity,
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
