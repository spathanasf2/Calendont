import { addDays, startOfDay, dateKey, DAY_MS } from '../dates.js';
import * as f from '../format.js';
import { h } from '../ui.js';

/** Groups occurrences under every day in [from, to) that they touch. */
export function bucketByDay(occs, from, to) {
  const days = new Map();
  for (const o of occs) {
    let d = startOfDay(o.start < from ? from : o.start);
    const last = o.end > o.start ? o.end : new Date(o.start.getTime() + 1);
    while (d < last && d < to) {
      const key = dateKey(d);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(o);
      d = addDays(d, 1);
    }
  }
  return days;
}

/** True when an occurrence belongs in the all-day lane rather than the time grid. */
export const isAllDayLike = (o) => o.allDay || o.end - o.start >= DAY_MS;

const colorStyle = (o) => ({ '--c': o.calendar.color });

/** A compact event label for month cells and the all-day lane. */
export function chip(ctx, o, day) {
  const startsHere = dateKey(o.start) === dateKey(day);
  const timed = !isAllDayLike(o);
  return h('button', {
    type: 'button',
    class: `chip${timed ? ' timed' : ' allday'}`,
    style: colorStyle(o),
    title: o.event.title || 'New event',
    onClick: (e) => {
      e.stopPropagation();
      ctx.openOccurrence(o);
    },
  },
  timed && startsHere ? h('span', { class: 'chip-time' }, f.time(o.start)) : null,
  h('span', { class: 'chip-title' }, o.event.title || 'New event'));
}

/** A full-width row for agenda lists: time, colour bar, title and place. */
export function eventRow(ctx, o, day) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  let top;
  let bottom;
  if (o.allDay) top = 'all-day';
  else if (o.start < dayStart && o.end > dayEnd) top = 'all-day';
  else {
    top = o.start >= dayStart ? f.time(o.start) : 'until';
    bottom = o.start >= dayStart ? (o.end <= dayEnd && o.end > o.start ? f.time(o.end) : '') : f.time(o.end);
  }
  return h('button', { type: 'button', class: 'row', style: colorStyle(o), onClick: () => ctx.openOccurrence(o) },
    h('span', { class: 'row-time' }, h('span', null, top), bottom ? h('span', { class: 'sub' }, bottom) : null),
    h('span', { class: 'row-bar' }),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, o.event.title || 'New event', o.event.rrule ? h('span', { class: 'row-repeat', title: 'Repeats', 'aria-label': 'Repeats' }, ' ↻') : null),
      o.event.location ? h('span', { class: 'row-sub' }, o.event.location) : null),
  );
}

export function emptyNote(text) {
  return h('p', { class: 'empty' }, text);
}
