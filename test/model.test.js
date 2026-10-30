import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, SKINS } from '../app/js/model.js';

test('settings from before themes get the default theme and its own accent', () => {
  const old = cleanSettings({ theme: 'dark', accent: '#e5484d', weekStart: 1 });
  assert.equal(old.skin, SKINS[0].id);
  assert.equal(old.accent, null);
  assert.equal(old.theme, 'dark');
  assert.equal(old.weekStart, 1);
});

test('a chosen theme and accent survive cleaning; unknown ones fall back', () => {
  assert.deepEqual(
    [cleanSettings({ skin: 'rose', accent: '#30A46C' }).skin, cleanSettings({ skin: 'rose', accent: '#30A46C' }).accent],
    ['rose', '#30a46c'],
  );
  assert.equal(cleanSettings({ skin: 'vaporwave' }).skin, SKINS[0].id);
  assert.equal(cleanSettings({ skin: 'rose', accent: 'pink' }).accent, null);
  assert.equal(cleanSettings({ view: 'year' }).view, 'year');
});
