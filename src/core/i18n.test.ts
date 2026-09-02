import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_LANG,
  GENRES_EN,
  LANGS,
  LOCALES,
  STRINGS,
  otherLang,
  translateGenre,
} from './i18n.js';
import type { Lang } from './i18n.js';

test('every language defines every string', () => {
  // The `Strings` interface already makes a missing key a compile error; this
  // catches the other half — a key present but left as the Serbian original.
  const keys = Object.keys(STRINGS[DEFAULT_LANG]) as (keyof (typeof STRINGS)['sr'])[];
  for (const lang of LANGS) {
    for (const key of keys) {
      const value = STRINGS[lang][key];
      assert.ok(value !== undefined && value !== null, `${lang}.${key} is missing`);
      if (typeof value === 'string') {
        assert.notEqual(value.trim(), '', `${lang}.${key} is empty`);
      }
    }
  }
});

test('the English chrome is actually translated, not copied', () => {
  // Only the strings that must differ; the audio short forms legitimately
  // collide ("dom.", "?") and the app name is a proper noun.
  const shared: (keyof (typeof STRINGS)['sr'])[] = [
    'siteTitle',
    'empty',
    'emptyPast',
    'kids',
    'searchLabel',
    'startedLabel',
    'privacy',
    'scrollTop',
    'ageUnknown',
    'audioLabelDubbed',
    'audioLabelSubtitled',
  ];
  for (const key of shared) {
    assert.notEqual(STRINGS.en[key], STRINGS.sr[key], `${key} is still Serbian in English`);
  }
});

test('only the default language renders at the site root', () => {
  assert.equal(LOCALES[DEFAULT_LANG].pathPrefix, '');
  assert.equal(LOCALES[DEFAULT_LANG].assetPrefix, '');
  for (const lang of LANGS.filter((code) => code !== DEFAULT_LANG)) {
    // A tree one directory down has to climb back out for the shared assets,
    // and the two prefixes must stay in step or every asset 404s.
    assert.equal(LOCALES[lang].pathPrefix, `${lang}/`);
    assert.equal(LOCALES[lang].assetPrefix, '../');
  }
});

test('plural templates carry as many forms as the rule can select', () => {
  const expected: Record<Lang, number> = { sr: 3, en: 2 };
  for (const lang of LANGS) {
    for (const key of ['pluralMovies', 'pluralShowtimes', 'pluralUnknownAudio'] as const) {
      const forms = STRINGS[lang][key].split('|');
      assert.equal(forms.length, expected[lang], `${lang}.${key}`);
      // `{n}` is what the client substitutes; a form without it loses the count.
      for (const form of forms) assert.ok(form.includes('{n}'), `${lang}.${key}: ${form}`);
    }
  }
});

test('otherLang round-trips', () => {
  for (const lang of LANGS) {
    assert.notEqual(otherLang(lang), lang);
    assert.equal(otherLang(otherLang(lang)), lang);
  }
});

test('genres are translated for English and left alone for Serbian', () => {
  assert.equal(translateGenre('Akcija', 'sr'), 'Akcija');
  assert.equal(translateGenre('Akcija', 'en'), 'Action');
  // The cinemas disagree with each other about the same genre.
  for (const variant of ['Akcija', 'Akcijski', 'Akcioni']) {
    assert.equal(translateGenre(variant, 'en'), 'Action');
  }
  // Case and stray whitespace are the sources' doing, not the reader's.
  assert.equal(translateGenre('triler', 'en'), 'Thriller');
  assert.equal(translateGenre(' Triler ', 'en'), 'Thriller');
  // An unknown genre is shown untranslated rather than dropped.
  assert.equal(translateGenre('Neki novi žanr', 'en'), 'Neki novi žanr');
});

test('every genre the cinemas publish has an English name', () => {
  // Taken from a real build's data.json; a new one showing up here means the
  // English page will print Serbian until it is added to the table. Checked by
  // key rather than by output, since "Anime" and "Drama" are the same word in
  // both languages and a value comparison would call those untranslated.
  const published = [
    'Akcija', 'Akcijski', 'Akcioni', 'Anime', 'Animirani', 'Avantura',
    'Biografska drama', 'Dokumentarni', 'Dokumentarni film', 'Drama',
    'Epski spektakl', 'Fantazija', 'Horor', 'Istorijski', 'Komedija',
    'Koncert live', 'Kriminalistički', 'Misterija', 'Muzički film',
    'Porodični', 'Porodični film', 'Romantični/ljubavni', 'SF', 'Triler',
    'triler',
  ];
  for (const genre of published) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(GENRES_EN, genre.trim().toLowerCase()),
      `${genre} has no English name`,
    );
  }
});
