// Calendont keeps every time as floating wall-clock time: the dentist is at
// 3pm wherever you happen to be. A wall time lives in a Date whose UTC fields
// hold the wall-clock values, so date math never meets a daylight-saving
// transition. Only `nowWall` and the time-zone helpers touch real instants.

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const pad = (n) => String(n).padStart(2, '0');

export function daysInMonth(year, month0) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDateKey(s) {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return y >= 1000 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo - 1);
}

/** True for a real wall time written as YYYY-MM-DDTHH:mm. */
export function isDateTimeKey(s) {
  const m = typeof s === 'string' && DATETIME_RE.exec(s);
  return !!m && isDateKey(`${m[1]}-${m[2]}-${m[3]}`) && +m[4] < 24 && +m[5] < 60;
}

export function parseDate(key) {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

export function parseDateTime(key) {
  const [date, time] = key.split('T');
  const [h, mi] = time.split(':').map(Number);
  const d = parseDate(date);
  d.setUTCHours(h, mi);
  return d;
}

/** Parses either a date key or a date-time key. */
export function parseWhen(key) {
  return key.includes('T') ? parseDateTime(key) : parseDate(key);
}

export function dateKey(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function timeKey(d) {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function dateTimeKey(d) {
  return `${dateKey(d)}T${timeKey(d)}`;
}

export function startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** The first day of the week holding `d`; `weekStart` is 0 (Sunday) to 6. */
export function startOfWeek(d, weekStart) {
  const day = startOfDay(d);
  return addDays(day, -((day.getUTCDay() - weekStart + 7) % 7));
}

export function addDays(d, n) {
  return new Date(d.getTime() + n * DAY_MS);
}

export function addMinutes(d, n) {
  return new Date(d.getTime() + n * MINUTE_MS);
}

/** Moves by whole months, clamping the day: Jan 31 + 1 month is Feb 28. */
export function addMonths(d, n) {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes()));
  target.setUTCDate(Math.min(d.getUTCDate(), daysInMonth(target.getUTCFullYear(), target.getUTCMonth())));
  return target;
}

export function diffDays(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function diffMinutes(a, b) {
  return Math.round((b - a) / MINUTE_MS);
}

export function sameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

/** Minutes since midnight. */
export function minuteOfDay(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The current wall-clock time on this device. */
export function nowWall() {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes()));
}

export function todayKey() {
  return dateKey(nowWall());
}

// ---------------------------------------------------------------------------
// Time zones. Only imported .ics files carry zones; once converted to this
// device's wall clock, an event is floating like any other.

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isKnownZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const zoneFormatters = new Map();

/** How far `timeZone`'s wall clock is ahead of UTC at instant `ms`. */
function zoneOffset(ms, timeZone) {
  let f = zoneFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    zoneFormatters.set(timeZone, f);
  }
  const p = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The wall time in `timeZone` at instant `ms`, to the minute. */
export function wallFromInstant(ms, timeZone = deviceTimeZone()) {
  const wall = new Date(ms + zoneOffset(ms, timeZone));
  wall.setUTCSeconds(0, 0);
  return wall;
}

/** The instant at which `timeZone`'s clocks read `wall`. */
export function instantFromWall(wall, timeZone) {
  const ms = wall.getTime();
  const guess = ms - zoneOffset(ms, timeZone);
  return ms - zoneOffset(guess, timeZone);
}
