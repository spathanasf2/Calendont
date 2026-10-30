// Human-readable dates in the viewer's language. Wall dates keep their
// wall-clock values in UTC fields, so every formatter runs in UTC.

const locale = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
let hour12; // undefined lets the locale decide
let localeHour12; // what the locale decided, once asked
const cache = new Map();

export function setTimeFormat(pref) {
  hour12 = pref === '12' ? true : pref === '24' ? false : undefined;
  localeHour12 = undefined;
  cache.clear();
}

function fmt(options) {
  const key = JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...options });
    cache.set(key, f);
  }
  return f;
}

const timeOptions = () => (hour12 === undefined ? {} : { hour12 });

export const monthName = (d) => fmt({ month: 'long' }).format(d);
export const year = (d) => fmt({ year: 'numeric' }).format(d);
export const monthShort = (d) => fmt({ month: 'short' }).format(d);
export const weekdayNarrow = (d) => fmt({ weekday: 'narrow' }).format(d);
export const weekdayShort = (d) => fmt({ weekday: 'short' }).format(d);
export const weekdayLong = (d) => fmt({ weekday: 'long' }).format(d);
export const dayNumber = (d) => String(d.getUTCDate());
export const dayLong = (d) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(d);
export const dayMedium = (d) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(d);
export const dateFull = (d) => fmt({ year: 'numeric', month: 'long', day: 'numeric' }).format(d);

/** "Oct 26 – Nov 1, 2026" */
export function dateRange(a, b) {
  const f = fmt({ month: 'short', day: 'numeric', year: 'numeric' });
  return f.formatRange ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
}

/** "3:30 PM", or "3 PM" on the hour. */
export function time(d) {
  const opts = d.getUTCMinutes() === 0 && uses12h()
    ? { hour: 'numeric', ...timeOptions() }
    : { hour: 'numeric', minute: '2-digit', ...timeOptions() };
  return fmt(opts).format(d);
}

/** Label for an hour line in the time grid. */
export function hourLabel(h) {
  const d = new Date(Date.UTC(2000, 0, 1, h));
  return uses12h() ? fmt({ hour: 'numeric', ...timeOptions() }).format(d) : fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

export function uses12h() {
  if (hour12 !== undefined) return hour12;
  localeHour12 ??= fmt({ hour: 'numeric' }).resolvedOptions().hour12 ?? false;
  return localeHour12;
}

/** "3 days ago", "just now". */
export function relative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 45) return rtf.format(-days, 'day');
  return rtf.format(-Math.round(days / 30), 'month');
}
