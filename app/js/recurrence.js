// Turns an event and its repeat rule into concrete occurrences. The rules
// follow RFC 5545 semantics where Calendont supports them: the start always
// counts as the first occurrence, COUNT includes removed occurrences, weeks
// begin on Monday for interval math, and impossible dates (Feb 30, a fifth
// Friday that isn't there) are skipped rather than moved.

import { DAY_MS, parseWhen, parseDate, addDays, startOfDay, dateKey, daysInMonth } from './dates.js';

const MAX_STEPS = 50_000;

/** An event's extent as [start, end); an all-day event ends at the midnight after its last day. */
export function eventSpan(event) {
  const start = parseWhen(event.start);
  const end = event.allDay ? addDays(parseDate(event.end), 1) : parseWhen(event.end);
  return { start, end };
}

function overlaps(start, end, from, to) {
  if (end.getTime() === start.getTime()) return start >= from && start < to;
  return start < to && end > from;
}

/**
 * Every occurrence of `event` that overlaps [from, to), in order. Each is
 * { start, end, date }, where `date` is the occurrence's original start date:
 * the key that exdates and "this event only" edits refer to.
 */
export function occurrences(event, from, to) {
  const { start, end } = eventSpan(event);
  if (!event.rrule) return overlaps(start, end, from, to) ? [{ start, end, date: dateKey(start) }] : [];
  const duration = end - start;
  const removed = new Set(event.exdates);
  const out = [];
  for (const s of starts(event.rrule, start, new Date(from.getTime() - duration))) {
    if (s >= to) break;
    const e = new Date(s.getTime() + duration);
    const date = dateKey(s);
    if (!removed.has(date) && overlaps(s, e, from, to)) out.push({ start: s, end: e, date });
  }
  return out;
}

/** True when `date` (YYYY-MM-DD) is one of the event's occurrence dates. */
export function occursOn(event, date) {
  const day = parseDate(date);
  return occurrences(event, day, addDays(day, 1)).some((o) => o.date === date);
}

/** The weekday of `d` and which one of the month it is, for "the 2nd Tuesday" rules. */
export function weekdayPosition(d) {
  const day = d.getUTCDate();
  const dim = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
  return { day: d.getUTCDay(), nth: Math.ceil(day / 7), isLast: day + 7 > dim };
}

/** Day of the month of the nth `weekday` (nth -1 is the last), or null if it doesn't exist. */
export function nthWeekday(year, month0, weekday, nth) {
  const dim = daysInMonth(year, month0);
  if (nth === -1) {
    const lastDow = new Date(Date.UTC(year, month0, dim)).getUTCDay();
    return dim - ((lastDow - weekday + 7) % 7);
  }
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
  return day <= dim ? day : null;
}

/** Occurrence start times in order, honouring `until` and `count`. */
function* starts(rule, first, notBefore) {
  const until = rule.until ? addDays(parseDate(rule.until), 1) : null;
  const limit = rule.count ?? Infinity;
  // Skipping ahead is only safe when nothing needs counting from the start.
  const skipTo = rule.count == null && notBefore > first ? notBefore : null;
  let n = 0;
  if (until && first >= until) return;
  n++;
  yield first;
  for (const c of candidates(rule, first, skipTo)) {
    if (c <= first) continue;
    if (until && c >= until) return;
    if (++n > limit) return;
    yield c;
  }
}

function* candidates(rule, first, skipTo) {
  const interval = rule.interval || 1;
  const day0 = startOfDay(first);
  const timeMs = first - day0;
  let steps = 0;

  if (rule.freq === 'daily') {
    const stride = interval * DAY_MS;
    let k = skipTo ? Math.max(0, Math.floor((skipTo - first) / stride)) : 0;
    for (; steps++ < MAX_STEPS; k++) yield new Date(first.getTime() + k * stride);
    return;
  }

  if (rule.freq === 'weekly') {
    const fromMonday = (d) => (d + 6) % 7;
    const offsets = (rule.byDay ?? [first.getUTCDay()]).map(fromMonday).sort((a, b) => a - b);
    const monday = addDays(day0, -fromMonday(day0.getUTCDay()));
    const stride = interval * 7 * DAY_MS;
    let w = skipTo ? Math.max(0, Math.floor((skipTo - monday) / stride) - 1) : 0;
    for (; steps++ < MAX_STEPS; w++) {
      for (const off of offsets) yield new Date(monday.getTime() + w * stride + off * DAY_MS + timeMs);
    }
    return;
  }

  const monthStep = rule.freq === 'monthly' ? interval : interval * 12;
  const y0 = first.getUTCFullYear();
  const m0 = first.getUTCMonth();
  const d0 = first.getUTCDate();
  for (let k = 0; steps++ < MAX_STEPS; k++) {
    const months = m0 + k * monthStep;
    const y = y0 + Math.floor(months / 12);
    const m = months % 12;
    const d = rule.byWeekday
      ? nthWeekday(y, m, rule.byWeekday.day, rule.byWeekday.nth)
      : d0 <= daysInMonth(y, m) ? d0 : null;
    if (d != null) yield new Date(Date.UTC(y, m, d) + timeMs);
  }
}
