// iCalendar (.ics, RFC 5545) import and export, for moving events to and from
// Apple Calendar, Google Calendar and everything else that speaks it.
//
// Import converts zoned and UTC times to this device's wall clock, so what
// comes out is floating like every other Calendont event. Export writes
// floating times, which calendar apps read as local time.

import {
  pad, addDays, dateKey, timeKey, minuteOfDay, deviceTimeZone, isKnownZone,
  wallFromInstant, instantFromWall,
} from './dates.js';
import { newId } from './model.js';
import { eventSpan } from './recurrence.js';

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------------------------------------------------------------------------
// Parsing

/**
 * Reads an .ics file. Returns { name, color, events, warnings }; the events
 * have no calendarId yet, since the caller decides where they go.
 */
export function parseICS(text, { timeZone = deviceTimeZone() } = {}) {
  const result = { name: '', color: '', events: [], warnings: [] };
  const stack = [];
  const raw = [];
  let current = null;

  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      stack.push(prop.value.toUpperCase());
      if (stack.at(-1) === 'VEVENT') current = [];
      continue;
    }
    if (prop.name === 'END') {
      if (stack.pop() === 'VEVENT' && current) {
        raw.push(current);
        current = null;
      }
      continue;
    }
    const top = stack.at(-1);
    if (top === 'VEVENT' && current) current.push(prop);
    else if (top === 'VCALENDAR') {
      if (prop.name === 'X-WR-CALNAME') result.name = unescapeText(prop.value).trim();
      if (prop.name === 'X-APPLE-CALENDAR-COLOR' && /^#[0-9a-f]{6}/i.test(prop.value)) {
        result.color = prop.value.slice(0, 7).toLowerCase();
      }
    }
  }

  if (!raw.length && !/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error("This doesn't look like a calendar (.ics) file.");
  }

  let simplified = 0;
  let skipped = 0;
  const masters = new Map();
  const overrides = [];
  for (const props of raw) {
    const parsed = readEvent(props, timeZone);
    if (!parsed) { skipped++; continue; }
    if (parsed.simplified) simplified++;
    if (parsed.recurrenceId) overrides.push(parsed);
    else {
      masters.set(parsed.event.uid, parsed.event);
      result.events.push(parsed.event);
    }
  }

  // A RECURRENCE-ID event replaces one occurrence of its series. Calendont
  // keeps it as a separate event and removes that date from the series.
  for (const { event, recurrenceId, cancelled } of overrides) {
    const master = masters.get(event.uid);
    if (master?.rrule && !master.exdates.includes(recurrenceId)) {
      master.exdates.push(recurrenceId);
      master.exdates.sort();
    }
    if (!cancelled) {
      event.uid = `${event.uid}/${recurrenceId}`;
      result.events.push(event);
    }
  }

  if (simplified) result.warnings.push(`${simplified} repeating ${simplified === 1 ? 'event uses' : 'events use'} a repeat rule Calendont simplified.`);
  if (skipped) result.warnings.push(`${skipped} ${skipped === 1 ? 'entry was' : 'entries were'} unreadable and skipped.`);
  return result;
}

function readEvent(props, timeZone) {
  const get = (name) => props.find((p) => p.name === name);
  const dtstart = get('DTSTART') && parseDateValue(get('DTSTART'), timeZone);
  if (!dtstart) return null;
  const status = get('STATUS')?.value.toUpperCase();

  let end;
  const dtend = get('DTEND') && parseDateValue(get('DTEND'), timeZone);
  const duration = get('DURATION') && parseDuration(get('DURATION').value);
  if (dtend && dtend.wall >= dtstart.wall) end = dtend.wall;
  else if (duration != null) end = new Date(dtstart.wall.getTime() + duration);
  else end = dtstart.allDay ? addDays(dtstart.wall, 1) : dtstart.wall;

  const allDay = dtstart.allDay;
  const id = newId();
  const now = new Date().toISOString();
  const event = {
    id,
    uid: unescapeText(get('UID')?.value ?? '').trim() || `${id}@calendont`,
    calendarId: '',
    title: unescapeText(get('SUMMARY')?.value ?? '').trim(),
    location: unescapeText(get('LOCATION')?.value ?? '').trim(),
    notes: unescapeText(get('DESCRIPTION')?.value ?? '').trim(),
    allDay,
    start: allDay ? dateKey(dtstart.wall) : `${dateKey(dtstart.wall)}T${timeKey(dtstart.wall)}`,
    // All-day DTEND is exclusive; Calendont stores the last day.
    end: allDay
      ? dateKey(addDays(end, end > dtstart.wall ? -1 : 0))
      : `${dateKey(end)}T${timeKey(end)}`,
    rrule: null,
    exdates: [],
    created: now,
    updated: now,
  };

  let simplified = false;
  const rrule = get('RRULE');
  if (rrule) {
    const parsed = parseRule(rrule.value, dtstart, timeZone);
    event.rrule = parsed.rule;
    simplified = parsed.simplified;
  }
  if (event.rrule) {
    for (const p of props.filter((q) => q.name === 'EXDATE')) {
      for (const v of p.value.split(',')) {
        const d = parseDateValue({ ...p, value: v }, timeZone);
        if (d) event.exdates.push(dateKey(d.wall));
      }
    }
    event.exdates = [...new Set(event.exdates)].sort();
  }

  const rid = get('RECURRENCE-ID') && parseDateValue(get('RECURRENCE-ID'), timeZone);
  return {
    event,
    simplified,
    recurrenceId: rid ? dateKey(rid.wall) : null,
    cancelled: status === 'CANCELLED',
  };
}

function parseRule(value, dtstart, timeZone) {
  const parts = {};
  for (const piece of value.split(';')) {
    const [k, v] = piece.split('=');
    if (k && v) parts[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[parts.FREQ];
  if (!freq) return { rule: null, simplified: true };

  const start = dtstart.wall;
  const rule = { freq, interval: Math.max(1, Number.parseInt(parts.INTERVAL, 10) || 1) };
  const supported = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST']);
  let simplified = Object.keys(parts).some((k) => !supported.has(k));

  if (parts.UNTIL) {
    // An all-day series ends on a date; some apps still write it as midnight UTC.
    const value = dtstart.allDay ? parts.UNTIL.slice(0, 8) : parts.UNTIL;
    const until = parseDateValue({ name: 'UNTIL', params: {}, value }, timeZone);
    if (until) {
      let last = until.wall;
      // An UNTIL earlier in the day than the event's start excludes that day.
      if (!dtstart.allDay && !until.allDay && minuteOfDay(last) < minuteOfDay(start)) last = addDays(last, -1);
      rule.until = dateKey(last);
    }
  } else if (parts.COUNT) {
    const count = Number.parseInt(parts.COUNT, 10);
    if (count > 0) rule.count = count;
  }

  if (parts.BYDAY) {
    const days = parts.BYDAY.split(',').map((d) => {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d);
      return m && { nth: m[1] ? Number.parseInt(m[1], 10) : 0, day: WEEKDAYS.indexOf(m[2]) };
    });
    if (days.some((d) => !d)) simplified = true;
    const plain = days.filter(Boolean);
    if (!plain.length) {
      // Nothing readable: keep the frequency, on the start's own day.
    } else if ((freq === 'weekly' || freq === 'daily') && plain.every((d) => d.nth === 0)) {
      // "Every weekday" arrives as FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR.
      if (freq === 'daily' && rule.interval !== 1) simplified = true;
      rule.freq = 'weekly';
      rule.byDay = [...new Set(plain.map((d) => d.day))].sort();
    } else if ((freq === 'monthly' || freq === 'yearly') && plain.length === 1 && (plain[0].nth === -1 || (plain[0].nth >= 1 && plain[0].nth <= 5))) {
      rule.byWeekday = { day: plain[0].day, nth: plain[0].nth };
    } else {
      simplified = true;
    }
  }
  if (parts.BYMONTHDAY && !(freq === 'monthly' && !parts.BYDAY && Number(parts.BYMONTHDAY) === start.getUTCDate())) {
    simplified = true;
  }
  if (parts.BYMONTH && !(freq === 'yearly' && Number(parts.BYMONTH) === start.getUTCMonth() + 1)) {
    simplified = true;
  }
  if (rule.freq === 'weekly' && rule.byDay?.length === 1 && rule.byDay[0] === start.getUTCDay()) delete rule.byDay;
  return { rule, simplified };
}

/** { allDay, wall } for a DATE or DATE-TIME value, converted to `timeZone`'s wall clock. */
function parseDateValue(prop, timeZone) {
  const v = prop.value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { allDay: true, wall: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  let wall = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  if (Number.isNaN(wall.getTime())) return null;
  if (m[7]) {
    wall = wallFromInstant(wall.getTime(), timeZone);
  } else if (prop.params.TZID) {
    const zone = resolveZone(prop.params.TZID);
    // Unknown zones (Outlook writes Windows names) stay as written.
    if (zone && zone !== timeZone) wall = wallFromInstant(instantFromWall(wall, zone), timeZone);
  }
  return { allDay: false, wall };
}

/** Finds an IANA zone in a TZID like "America/New_York" or "/mozilla.org/20050126_1/Europe/Paris". */
function resolveZone(tzid) {
  const parts = tzid.replace(/^"|"$/g, '').split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join('/');
    if (isKnownZone(candidate)) return candidate;
  }
  return null;
}

/** Milliseconds in an ISO 8601 duration such as PT1H30M or P1D. */
function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w = 0, d = 0, h = 0, mi = 0, s = 0] = m;
  const ms = ((+w * 7 + +d) * 86400 + +h * 3600 + +mi * 60 + +s) * 1000;
  return sign === '-' ? null : ms;
}

function unfold(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** NAME;PARAM=VALUE:value → { name, params, value }. */
function parseLine(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      const [name, ...rawParams] = splitUnquoted(line.slice(0, i), ';');
      const params = {};
      for (const p of rawParams) {
        const eq = p.indexOf('=');
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
      }
      return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
    }
  }
  return null;
}

function splitUnquoted(s, sep) {
  const out = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') quoted = !quoted;
    else if (s[i] === sep && !quoted) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function unescapeText(v) {
  return v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

// ---------------------------------------------------------------------------
// Writing

/** Serializes events as an .ics file. `name` and `color` label the calendar. */
export function serializeICS(events, { name = '', color = '', now = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendont//Calendont//EN', 'CALSCALE:GREGORIAN'];
  if (name) lines.push(`X-WR-CALNAME:${escapeText(name)}`);
  if (color) lines.push(`X-APPLE-CALENDAR-COLOR:${color.toUpperCase()}`);
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  for (const ev of events) {
    const { start, end } = eventSpan(ev);
    lines.push('BEGIN:VEVENT', `UID:${escapeText(ev.uid || `${ev.id}@calendont`)}`, `DTSTAMP:${stamp}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(end)}`);
    } else {
      lines.push(`DTSTART:${icsDateTime(start)}`, `DTEND:${icsDateTime(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.title || 'New event')}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${escapeText(ev.notes)}`);
    if (ev.rrule) {
      lines.push(`RRULE:${ruleToICS(ev.rrule, ev, start)}`);
      if (ev.exdates.length) {
        const time = ev.allDay ? '' : `T${icsDateTime(start).slice(9)}`;
        const values = ev.exdates.map((d) => d.replaceAll('-', '') + time).join(',');
        lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${values}` : `EXDATE:${values}`);
      }
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function ruleToICS(rule, ev, start) {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay) parts.push(`BYDAY=${rule.byDay.map((d) => WEEKDAYS[d]).join(',')}`);
  if (rule.byWeekday) {
    if (rule.freq === 'yearly') parts.push(`BYMONTH=${start.getUTCMonth() + 1}`);
    parts.push(`BYDAY=${rule.byWeekday.nth}${WEEKDAYS[rule.byWeekday.day]}`);
  }
  // UNTIL must match DTSTART's type: a date for all-day events, else a floating date-time.
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll('-', '')}${ev.allDay ? '' : 'T235959'}`);
  else if (rule.count) parts.push(`COUNT=${rule.count}`);
  return parts.join(';');
}

const icsDate = (d) => dateKey(d).replaceAll('-', '');
const icsDateTime = (d) => `${icsDate(d)}T${timeKey(d).replace(':', '')}00`;

function escapeText(v) {
  return String(v).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
}

/** Folds a line to 75 octets, never splitting a UTF-8 character. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let chunk = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  out.push(chunk);
  return out.join('\r\n ');
}

/** Exports one event (with its whole series) for sending to someone. */
export function eventToICS(event, calendar) {
  return serializeICS([event], { color: calendar?.color ?? '' });
}
