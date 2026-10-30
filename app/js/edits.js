// Changing one occurrence of an event, shared by the editor and drag-and-drop.

import { addDays, parseDate, parseWhen, dateKey, timeKey, diffDays } from './dates.js';
import { newId } from './model.js';
import { nthWeekday } from './recurrence.js';
import { choose } from './ui.js';

/** Asks whether a change to a repeating event is for this occurrence or all of them. */
export function chooseScope() {
  return choose({
    title: 'This is a repeating event.',
    options: [
      { label: 'Save for this event only', value: 'one' },
      { label: 'Save for all events', value: 'all' },
    ],
  });
}

/**
 * The change that makes `occurrence` of `series` take on `values` (any event
 * fields; start/end in the event's own key format). For a repeating event,
 * `scope` 'one' splits the occurrence off and 'all' shifts the whole series
 * by however far this occurrence moved.
 */
export function occurrenceChange({ series, occurrence, values, scope, now = new Date().toISOString() }) {
  const v = { ...series, ...values };
  if (!series.rrule) return { putEvents: [{ ...v, updated: now }] };

  if (scope === 'one') {
    const single = {
      ...v, id: newId(), uid: `${series.uid}/${occurrence.date}`,
      rrule: null, exdates: [], created: now, updated: now,
    };
    const rest = { ...series, exdates: [...new Set([...series.exdates, occurrence.date])].sort(), updated: now };
    return { putEvents: [rest, single] };
  }

  const moved = parseWhen(v.start) - occurrence.start;
  const days = diffDays(occurrence.start, parseWhen(v.start));
  const seriesStart = new Date(parseWhen(series.start).getTime() + moved);
  const length = parseWhen(v.end) - parseWhen(v.start);
  const seriesEnd = new Date(seriesStart.getTime() + length);
  const key = (d) => (v.allDay ? dateKey(d) : `${dateKey(d)}T${timeKey(d)}`);
  return {
    putEvents: [{
      ...v,
      start: key(seriesStart),
      end: key(seriesEnd),
      exdates: series.exdates.map((d) => {
        const shifted = addDays(parseDate(d), days);
        // "The second Tuesday" moved to Wednesdays isn't the same number of days away every month.
        const bw = v.rrule?.byWeekday;
        const day = bw && nthWeekday(shifted.getUTCFullYear(), shifted.getUTCMonth(), bw.day, bw.nth);
        return day ? dateKey(new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), day))) : dateKey(shifted);
      }),
      updated: now,
    }],
  };
}

/**
 * Moves or resizes an occurrence to [start, end) (wall Dates; all-day events
 * end at the midnight after their last day). Resolves false if cancelled.
 */
export async function moveOccurrence(ctx, occurrence, start, end) {
  const series = occurrence.event;
  const values = series.allDay
    ? { start: dateKey(start), end: dateKey(addDays(end, -1)) }
    : { start: `${dateKey(start)}T${timeKey(start)}`, end: `${dateKey(end)}T${timeKey(end)}` };
  const scope = series.rrule ? await chooseScope() : 'one';
  if (!scope) return false;
  await ctx.commit(occurrenceChange({ series, occurrence, values, scope }));
  return true;
}
