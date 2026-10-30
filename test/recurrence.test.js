import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, dateKey, dateTimeKey } from '../app/js/dates.js';
import { occurrences, nthWeekday, weekdayPosition } from '../app/js/recurrence.js';

const ev = (fields) => ({
  id: 'e', calendarId: 'c', title: '', allDay: false, rrule: null, exdates: [], ...fields,
});
const dates = (event, from, to) =>
  occurrences(event, parseDate(from), parseDate(to)).map((o) => dateKey(o.start));

test('a single event appears only where it overlaps', () => {
  const e = ev({ start: '2026-10-30T23:00', end: '2026-10-31T01:00' });
  assert.deepEqual(dates(e, '2026-10-31', '2026-11-01'), ['2026-10-30']);
  assert.deepEqual(dates(e, '2026-11-01', '2026-11-02'), []);
});

test('a zero-length event still shows on its day', () => {
  const e = ev({ start: '2026-10-30T09:00', end: '2026-10-30T09:00' });
  assert.deepEqual(dates(e, '2026-10-30', '2026-10-31'), ['2026-10-30']);
});

test('multi-day all-day events cover each day through the last', () => {
  const e = ev({ allDay: true, start: '2026-10-30', end: '2026-11-01' });
  assert.deepEqual(dates(e, '2026-11-01', '2026-11-02'), ['2026-10-30']);
  assert.deepEqual(dates(e, '2026-11-02', '2026-11-03'), []);
});

test('daily with interval, until and exdates', () => {
  const e = ev({
    start: '2026-10-01T08:00', end: '2026-10-01T08:30',
    rrule: { freq: 'daily', interval: 3, until: '2026-10-13' },
    exdates: ['2026-10-07'],
  });
  assert.deepEqual(dates(e, '2026-10-01', '2026-11-01'), ['2026-10-01', '2026-10-04', '2026-10-10', '2026-10-13']);
});

test('count includes removed occurrences', () => {
  const e = ev({
    allDay: true, start: '2026-10-01', end: '2026-10-01',
    rrule: { freq: 'daily', interval: 1, count: 4 }, exdates: ['2026-10-02'],
  });
  assert.deepEqual(dates(e, '2026-09-01', '2026-12-01'), ['2026-10-01', '2026-10-03', '2026-10-04']);
});

test('weekly on several days, every other week', () => {
  // Starts Wednesday 2026-10-07; repeats Mon/Wed every 2 weeks (weeks start Monday).
  const e = ev({
    start: '2026-10-07T18:00', end: '2026-10-07T19:00',
    rrule: { freq: 'weekly', interval: 2, byDay: [1, 3] },
  });
  assert.deepEqual(dates(e, '2026-10-01', '2026-11-01'), ['2026-10-07', '2026-10-19', '2026-10-21']);
});

test('the start always counts, even off-pattern', () => {
  const e = ev({
    start: '2026-10-06T09:00', end: '2026-10-06T10:00', // a Tuesday
    rrule: { freq: 'weekly', interval: 1, byDay: [1], count: 3 },
  });
  assert.deepEqual(dates(e, '2026-10-01', '2026-11-01'), ['2026-10-06', '2026-10-12', '2026-10-19']);
});

test('monthly on the 31st skips short months', () => {
  const e = ev({ allDay: true, start: '2026-01-31', end: '2026-01-31', rrule: { freq: 'monthly', interval: 1 } });
  assert.deepEqual(dates(e, '2026-01-01', '2026-06-01'), ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('monthly on the last Friday', () => {
  const e = ev({
    start: '2026-10-30T17:00', end: '2026-10-30T18:00',
    rrule: { freq: 'monthly', interval: 1, byWeekday: { day: 5, nth: -1 } },
  });
  assert.deepEqual(dates(e, '2026-10-01', '2027-01-01'), ['2026-10-30', '2026-11-27', '2026-12-25']);
});

test('yearly on Feb 29 waits for leap years', () => {
  const e = ev({ allDay: true, start: '2024-02-29', end: '2024-02-29', rrule: { freq: 'yearly', interval: 1 } });
  assert.deepEqual(dates(e, '2024-01-01', '2033-01-01'), ['2024-02-29', '2028-02-29', '2032-02-29']);
});

test('yearly on the fourth Thursday of November', () => {
  const e = ev({
    allDay: true, start: '2026-11-26', end: '2026-11-26',
    rrule: { freq: 'yearly', interval: 1, byWeekday: { day: 4, nth: 4 } },
  });
  assert.deepEqual(dates(e, '2026-01-01', '2029-01-01'), ['2026-11-26', '2027-11-25', '2028-11-23']);
});

test('skipping ahead matches walking from the start', () => {
  const daily = ev({ start: '2001-03-04T07:15', end: '2001-03-04T07:45', rrule: { freq: 'daily', interval: 5 } });
  const weekly = ev({ start: '2001-03-04T07:15', end: '2001-03-05T07:45', rrule: { freq: 'weekly', interval: 3, byDay: [0, 2, 6] } });
  const from = parseDate('2026-10-01');
  const to = parseDate('2026-12-01');
  const key = (o) => dateTimeKey(o.start);
  for (const e of [daily, weekly]) {
    const fast = occurrences(e, from, to).map(key);
    const slow = occurrences(e, parseDate('2001-01-01'), to).filter((o) => o.end > from).map(key);
    assert.ok(fast.length > 5);
    assert.deepEqual(fast, slow);
  }
});

test('occurrence durations carry over to each instance', () => {
  const e = ev({ start: '2026-10-30T22:00', end: '2026-10-31T00:30', rrule: { freq: 'weekly', interval: 1 } });
  const [o] = occurrences(e, parseDate('2026-11-07'), parseDate('2026-11-08'));
  assert.equal(dateTimeKey(o.start), '2026-11-06T22:00');
  assert.equal(dateTimeKey(o.end), '2026-11-07T00:30');
  assert.equal(o.date, '2026-11-06');
});

test('weekday helpers', () => {
  assert.equal(nthWeekday(2026, 9, 5, -1), 30);
  assert.equal(nthWeekday(2026, 9, 5, 5), 30);
  assert.equal(nthWeekday(2026, 1, 1, 5), null);
  assert.deepEqual(weekdayPosition(parseDate('2026-10-30')), { day: 5, nth: 5, isLast: true });
  assert.deepEqual(weekdayPosition(parseDate('2026-10-13')), { day: 2, nth: 2, isLast: false });
});
