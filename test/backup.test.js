import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, readBackup } from '../app/js/backup.js';
import { defaultSettings } from '../app/js/model.js';

const calendars = [{ id: 'c1', name: 'Family', color: '#30a46c', visible: true, order: 0 }];
const events = [{
  id: 'e1', uid: 'e1@calendont', calendarId: 'c1', title: 'Pizza night', location: '', notes: '',
  allDay: false, start: '2026-10-30T18:00', end: '2026-10-30T19:00',
  rrule: { freq: 'weekly', interval: 1 }, exdates: [],
  created: '2026-10-30T10:00:00.000Z', updated: '2026-10-30T10:00:00.000Z',
}];

test('a backup restores exactly what was saved', () => {
  const settings = { ...defaultSettings(), weekStart: 1, theme: 'dark' };
  const text = createBackup({ settings, calendars, events }, new Date('2026-10-30T12:00:00Z'));
  const restored = readBackup(text);
  assert.equal(restored.exportedAt, '2026-10-30T12:00:00.000Z');
  assert.deepEqual(restored.settings, settings);
  assert.deepEqual(restored.calendars, calendars);
  assert.deepEqual(restored.events, events);
  assert.equal(restored.skipped, 0);
});

test('rejects files that are not backups, or from the future', () => {
  assert.throws(() => readBackup('not json'), /isn't a Calendont backup/);
  assert.throws(() => readBackup('{"format":"something-else"}'), /isn't a Calendont backup/);
  assert.throws(() => readBackup('{"format":"calendont-backup","version":99}'), /newer version/);
});

test('drops broken entries and rehomes orphaned events', () => {
  const text = JSON.stringify({
    format: 'calendont-backup',
    version: 1,
    calendars: [{ name: 'no id' }],
    events: [
      { ...events[0], start: '2026-02-30T10:00' },
      { ...events[0], id: 'e2', calendarId: 'gone', end: '2026-10-30T17:00' },
    ],
  });
  const restored = readBackup(text);
  assert.equal(restored.skipped, 2);
  assert.equal(restored.calendars.length, 1);
  assert.equal(restored.calendars[0].name, 'Imported');
  assert.equal(restored.events.length, 1);
  assert.equal(restored.events[0].calendarId, restored.calendars[0].id);
  assert.equal(restored.events[0].end, restored.events[0].start, 'an end before the start is clamped');
});
