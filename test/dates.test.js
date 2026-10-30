import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateKey, isDateTimeKey, parseDate, parseDateTime, dateKey, dateTimeKey, addMonths,
  startOfWeek, diffDays, wallFromInstant, instantFromWall,
} from '../app/js/dates.js';

test('date keys validate real dates only', () => {
  assert.ok(isDateKey('2026-02-28'));
  assert.ok(isDateKey('2028-02-29'));
  assert.ok(!isDateKey('2026-02-29'));
  assert.ok(!isDateKey('2026-13-01'));
  assert.ok(!isDateKey('26-01-01'));
  assert.ok(!isDateKey(null));
  assert.ok(isDateTimeKey('2026-10-30T23:59'));
  assert.ok(!isDateTimeKey('2026-10-30T24:00'));
  assert.ok(!isDateTimeKey('2026-10-30'));
});

test('keys round-trip through wall dates', () => {
  assert.equal(dateKey(parseDate('2026-10-30')), '2026-10-30');
  assert.equal(dateTimeKey(parseDateTime('2026-03-08T02:30')), '2026-03-08T02:30');
});

test('addMonths clamps to the end of shorter months', () => {
  assert.equal(dateKey(addMonths(parseDate('2026-01-31'), 1)), '2026-02-28');
  assert.equal(dateKey(addMonths(parseDate('2026-03-31'), -1)), '2026-02-28');
  assert.equal(dateKey(addMonths(parseDate('2026-11-15'), 2)), '2027-01-15');
});

test('startOfWeek honours the chosen first weekday', () => {
  const fri = parseDate('2026-10-30');
  assert.equal(dateKey(startOfWeek(fri, 0)), '2026-10-25');
  assert.equal(dateKey(startOfWeek(fri, 1)), '2026-10-26');
  assert.equal(dateKey(startOfWeek(fri, 6)), '2026-10-24');
});

test('diffDays counts calendar days, ignoring time of day', () => {
  assert.equal(diffDays(parseDateTime('2026-10-30T23:00'), parseDateTime('2026-10-31T01:00')), 1);
});

test('zone conversion maps wall clocks between zones', () => {
  const ny = parseDateTime('2026-07-01T10:00');
  const instant = instantFromWall(ny, 'America/New_York');
  assert.equal(new Date(instant).toISOString(), '2026-07-01T14:00:00.000Z');
  assert.equal(dateTimeKey(wallFromInstant(instant, 'Europe/London')), '2026-07-01T15:00');
  assert.equal(dateTimeKey(wallFromInstant(instant, 'Asia/Tokyo')), '2026-07-01T23:00');
});

test('zone conversion is right on either side of a DST change', () => {
  // US clocks spring forward at 02:00 on 2026-03-08.
  const before = instantFromWall(parseDateTime('2026-03-08T01:30'), 'America/New_York');
  const after = instantFromWall(parseDateTime('2026-03-08T03:30'), 'America/New_York');
  assert.equal(new Date(before).toISOString(), '2026-03-08T06:30:00.000Z');
  assert.equal(new Date(after).toISOString(), '2026-03-08T07:30:00.000Z');
});
