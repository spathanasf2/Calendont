import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen } from '../app/js/dates.js';
import { occurrenceChange } from '../app/js/edits.js';

const series = {
  id: 's', uid: 's@x', calendarId: 'c', title: 'Lunch', location: '', notes: '', allDay: false,
  start: '2026-10-05T12:30', end: '2026-10-05T13:30', rrule: { freq: 'weekly', interval: 1 },
  exdates: ['2026-10-12'], created: 'then', updated: 'then',
};
const occ = (date, time = '12:30') => ({ event: series, date, start: parseWhen(`${date}T${time}`) });

test('a one-off event just takes the new values', () => {
  const single = { ...series, rrule: null, exdates: [] };
  const { putEvents } = occurrenceChange({ series: single, occurrence: occ('2026-10-05'), values: { start: '2026-10-06T09:00', end: '2026-10-06T10:00' }, now: 'now' });
  assert.deepEqual(putEvents, [{ ...single, start: '2026-10-06T09:00', end: '2026-10-06T10:00', updated: 'now' }]);
});

test('"this event only" removes the date from the series and adds a single event', () => {
  const { putEvents: [rest, one] } = occurrenceChange({
    series, occurrence: occ('2026-10-19'), scope: 'one', now: 'now',
    values: { start: '2026-10-19T13:00', end: '2026-10-19T14:00' },
  });
  assert.deepEqual(rest.exdates, ['2026-10-12', '2026-10-19']);
  assert.equal(rest.start, series.start);
  assert.equal(one.rrule, null);
  assert.equal(one.start, '2026-10-19T13:00');
  assert.equal(one.uid, 's@x/2026-10-19');
  assert.notEqual(one.id, 's');
});

test('"all events" shifts the series and its removed dates by the same amount', () => {
  const { putEvents: [moved] } = occurrenceChange({
    series, occurrence: occ('2026-10-19'), scope: 'all', now: 'now',
    values: { start: '2026-10-20T13:00', end: '2026-10-20T14:30' },
  });
  assert.equal(moved.start, '2026-10-06T13:00');
  assert.equal(moved.end, '2026-10-06T14:30');
  assert.deepEqual(moved.exdates, ['2026-10-13']);
  assert.deepEqual(moved.rrule, series.rrule);
});
