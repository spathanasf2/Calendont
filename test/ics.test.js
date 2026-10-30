import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, serializeICS } from '../app/js/ics.js';

const APPLE_EXPORT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 15.0//EN',
  'X-WR-CALNAME:Home',
  'X-APPLE-CALENDAR-COLOR:#34C759',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'DTSTART;TZID=America/New_York:20261005T180000',
  'DTEND;TZID=America/New_York:20261005T193000',
  'SUMMARY:Soccer practice\\, U10',
  'LOCATION:Field 3',
  'DESCRIPTION:Bring water.\\nAnd cleats.',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T045959Z',
  'EXDATE;TZID=America/New_York:20261012T180000',
  'BEGIN:VALARM',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'RECURRENCE-ID;TZID=America/New_York:20261014T180000',
  'DTSTART;TZID=America/New_York:20261014T190000',
  'DTEND;TZID=America/New_York:20261014T203000',
  'SUMMARY:Soccer practice (late)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:bday',
  'DTSTART;VALUE=DATE:20270312',
  'DTEND;VALUE=DATE:20270313',
  'SUMMARY:Grandma’s birthday — a long title that has to be folded across several lines',
  'RRULE:FREQ=YEARLY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc',
  'DTSTART:20261101T150000Z',
  'DURATION:PT45M',
  'SUMMARY:Call',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('reads an Apple Calendar export', () => {
  const { name, color, events, warnings } = parseICS(APPLE_EXPORT, { timeZone: 'America/New_York' });
  assert.equal(name, 'Home');
  assert.equal(color, '#34c759');
  assert.deepEqual(warnings, []);
  assert.equal(events.length, 4);

  const [soccer, bday, call, late] = events;
  assert.equal(soccer.title, 'Soccer practice, U10');
  assert.equal(soccer.notes, 'Bring water.\nAnd cleats.');
  assert.equal(soccer.start, '2026-10-05T18:00');
  assert.equal(soccer.end, '2026-10-05T19:30');
  // UNTIL 04:59Z is 23:59 New York on Dec 30.
  assert.deepEqual(soccer.rrule, { freq: 'weekly', interval: 1, byDay: [1, 3], until: '2026-12-30' });
  assert.deepEqual(soccer.exdates, ['2026-10-12', '2026-10-14']);

  assert.equal(late.title, 'Soccer practice (late)');
  assert.equal(late.start, '2026-10-14T19:00');
  assert.equal(late.rrule, null);
  assert.equal(late.uid, 'weekly-1/2026-10-14');

  assert.equal(bday.allDay, true);
  assert.equal(bday.start, '2027-03-12');
  assert.equal(bday.end, '2027-03-12');
  assert.deepEqual(bday.rrule, { freq: 'yearly', interval: 1 });

  assert.equal(call.start, '2026-11-01T10:00'); // after DST ends, New York is UTC-5
  assert.equal(call.end, '2026-11-01T10:45');
});

test('converts zoned times into the device zone', () => {
  const { events } = parseICS(APPLE_EXPORT, { timeZone: 'Europe/London' });
  assert.equal(events[0].start, '2026-10-05T23:00');
});

test('keeps unknown zones as written and flags rules it simplifies', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:x',
    'DTSTART;TZID=Eastern Standard Time:20261005T090000',
    'DTEND;TZID=Eastern Standard Time:20261005T100000',
    'RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:weekdays',
    'DTSTART:20261005T070000',
    'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=10',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  const { events, warnings } = parseICS(ics, { timeZone: 'America/Chicago' });
  assert.equal(events[0].start, '2026-10-05T09:00');
  assert.equal(warnings.length, 1);
  assert.deepEqual(events[1].rrule, { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5], count: 10 });
});

test('rejects files that are not calendars', () => {
  assert.throws(() => parseICS('hello'), /calendar/);
});

test('export round-trips through import', () => {
  const original = parseICS(APPLE_EXPORT, { timeZone: 'America/New_York' }).events;
  const text = serializeICS(original, { name: 'Home, sweet; home', color: '#34c759' });
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const again = parseICS(text, { timeZone: 'Asia/Tokyo' }); // floating times ignore the zone
  assert.equal(again.name, 'Home, sweet; home');
  const strip = ({ id, created, updated, calendarId, ...rest }) => rest;
  assert.deepEqual(again.events.map(strip), original.map(strip));
});

test('export writes monthly and yearly weekday rules', () => {
  const text = serializeICS([{
    id: 'a', uid: 'a', title: 'Thanksgiving', location: '', notes: '', allDay: true,
    start: '2026-11-26', end: '2026-11-26', exdates: [],
    rrule: { freq: 'yearly', interval: 1, byWeekday: { day: 4, nth: 4 } },
  }], { now: new Date('2026-10-30T12:00:00Z') });
  assert.match(text, /RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH\r\n/);
  assert.match(text, /DTEND;VALUE=DATE:20261127\r\n/);
  assert.match(text, /DTSTAMP:20261030T120000Z\r\n/);
});

test('UIDs with commas survive a round trip', () => {
  const ev = {
    id: 'a', uid: 'abc,def;1@example.com', title: 'x', location: '', notes: '', allDay: true,
    start: '2026-11-02', end: '2026-11-02', rrule: null, exdates: [],
  };
  const [back] = parseICS(serializeICS([ev])).events;
  assert.equal(back.uid, 'abc,def;1@example.com');
});

test('an all-day series ending at midnight UTC keeps its last day west of UTC', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x',
    'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102',
    'RRULE:FREQ=DAILY;UNTIL=20261105T000000Z',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  assert.equal(parseICS(ics, { timeZone: 'America/Los_Angeles' }).events[0].rrule.until, '2026-11-05');
});

test('an unreadable BYDAY keeps the rule on the start day instead of emptying it', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x',
    'DTSTART:20261102T090000', 'RRULE:FREQ=WEEKLY;BYDAY=XX',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const { events, warnings } = parseICS(ics);
  assert.deepEqual(events[0].rrule, { freq: 'weekly', interval: 1 });
  assert.equal(warnings.length, 1);
});
