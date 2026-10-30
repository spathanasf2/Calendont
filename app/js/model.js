// The shapes Calendont stores, and the gatekeepers that clean anything coming
// from outside (a backup file, an old database) before the app trusts it.
//
// Calendar
//   id, name, color, visible, order (position in lists)
//
// Event
//   id, uid           local id, and the iCalendar UID used for .ics round trips
//   calendarId
//   title, location, notes
//   allDay            true: start/end are YYYY-MM-DD and `end` is the last day
//                     false: start/end are YYYY-MM-DDTHH:mm and `end` is exclusive
//   rrule             null, or { freq, interval, byDay?, byWeekday?, until?, count? }
//                     byDay: weekdays 0–6 for weekly rules (omitted: start's weekday)
//                     byWeekday: { day: 0–6, nth: 1–5 or -1 } for "the last Friday"
//                     until: last date (inclusive) on which the rule may land
//   exdates           YYYY-MM-DD dates of occurrences that were removed
//   created, updated  ISO timestamps

import { isDateKey, isDateTimeKey, parseWhen, addMinutes, dateTimeKey } from './dates.js';

export const CALENDAR_COLORS = [
  '#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594',
  '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ad7f58', '#8d8d86',
];

export const ACCENTS = [
  { name: 'Coral', value: '#e5484d' },
  { name: 'Orange', value: '#f76b15' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Teal', value: '#12a594' },
  { name: 'Blue', value: '#0090ff' },
  { name: 'Indigo', value: '#3e63dd' },
  { name: 'Purple', value: '#8e4ec6' },
  { name: 'Graphite', value: '#6f6f78' },
];

export const VIEWS = ['day', 'week', 'month', 'list'];
export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];

export function defaultWeekStart(locale) {
  try {
    const info = new Intl.Locale(locale).getWeekInfo?.() ?? new Intl.Locale(locale).weekInfo;
    if (info?.firstDay) return [0, 1, 6].includes(info.firstDay % 7) ? info.firstDay % 7 : 1;
  } catch { /* fall through */ }
  return 0;
}

export function defaultSettings(locale = 'en-US') {
  return {
    weekStart: defaultWeekStart(locale),
    timeFormat: 'auto',
    theme: 'system',
    accent: ACCENTS[0].value,
    defaultDuration: 60,
    view: 'month',
    defaultCalendarId: null,
  };
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // randomUUID needs a secure context; a phone on plain-http LAN has none.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const str = (v, max = 10_000) => (typeof v === 'string' ? v.slice(0, max) : '');

export function cleanCalendar(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 200);
  if (!id) return null;
  return {
    id,
    name: str(raw.name, 200).trim() || 'Calendar',
    color: HEX_RE.test(raw.color) ? raw.color.toLowerCase() : CALENDAR_COLORS[5],
    visible: raw.visible !== false,
    order: Number.isFinite(raw.order) ? raw.order : 0,
  };
}

export function cleanRule(raw) {
  if (!raw || typeof raw !== 'object' || !FREQS.includes(raw.freq)) return null;
  const rule = { freq: raw.freq, interval: clampInt(raw.interval, 1, 999) ?? 1 };
  if (raw.freq === 'weekly' && Array.isArray(raw.byDay)) {
    const days = [...new Set(raw.byDay.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (days.length) rule.byDay = days;
  }
  if ((raw.freq === 'monthly' || raw.freq === 'yearly') && raw.byWeekday) {
    const { day, nth } = raw.byWeekday;
    if (Number.isInteger(day) && day >= 0 && day <= 6 && (nth === -1 || (Number.isInteger(nth) && nth >= 1 && nth <= 5))) {
      rule.byWeekday = { day, nth };
    }
  }
  if (isDateKey(raw.until)) rule.until = raw.until;
  else if (raw.count != null) {
    const count = clampInt(raw.count, 1, 9999);
    if (count) rule.count = count;
  }
  return rule;
}

export function cleanEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 200);
  const calendarId = str(raw.calendarId, 200);
  if (!id || !calendarId) return null;
  const allDay = raw.allDay === true;
  const valid = allDay ? isDateKey : isDateTimeKey;
  if (!valid(raw.start)) return null;
  let end = valid(raw.end) ? raw.end : raw.start;
  if (parseWhen(end) < parseWhen(raw.start)) end = raw.start;
  const now = new Date().toISOString();
  return {
    id,
    uid: str(raw.uid, 500) || `${id}@calendont`,
    calendarId,
    title: str(raw.title, 500),
    location: str(raw.location, 500),
    notes: str(raw.notes),
    allDay,
    start: raw.start,
    end,
    rrule: cleanRule(raw.rrule),
    exdates: Array.isArray(raw.exdates) ? [...new Set(raw.exdates.filter(isDateKey))].sort() : [],
    created: str(raw.created, 40) || now,
    updated: str(raw.updated, 40) || now,
  };
}

export function cleanSettings(raw, locale) {
  const base = defaultSettings(locale);
  if (!raw || typeof raw !== 'object') return base;
  return {
    weekStart: [0, 1, 6].includes(raw.weekStart) ? raw.weekStart : base.weekStart,
    timeFormat: ['auto', '12', '24'].includes(raw.timeFormat) ? raw.timeFormat : base.timeFormat,
    theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : base.theme,
    accent: HEX_RE.test(raw.accent) ? raw.accent.toLowerCase() : base.accent,
    defaultDuration: clampInt(raw.defaultDuration, 5, 24 * 60) ?? base.defaultDuration,
    view: VIEWS.includes(raw.view) ? raw.view : base.view,
    defaultCalendarId: typeof raw.defaultCalendarId === 'string' ? raw.defaultCalendarId : null,
  };
}

/** A fresh event starting at `start` (a wall Date), not yet saved. */
export function draftEvent({ start, allDay = false, durationMinutes = 60, calendarId }) {
  const id = newId();
  const now = new Date().toISOString();
  return {
    id,
    uid: `${id}@calendont`,
    calendarId,
    title: '',
    location: '',
    notes: '',
    allDay,
    start: allDay ? dateTimeKey(start).slice(0, 10) : dateTimeKey(start),
    end: allDay ? dateTimeKey(start).slice(0, 10) : dateTimeKey(addMinutes(start, durationMinutes)),
    rrule: null,
    exdates: [],
    created: now,
    updated: now,
  };
}

function clampInt(v, min, max) {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
  if (!Number.isInteger(n)) return null;
  return Math.min(max, Math.max(min, n));
}
