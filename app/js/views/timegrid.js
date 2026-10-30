import { addDays, addMinutes, startOfDay, startOfWeek, dateKey, todayKey, nowWall, minuteOfDay } from '../dates.js';
import * as f from '../format.js';
import { h } from '../ui.js';
import { bucketByDay, chip, isAllDayLike, dropDay } from './common.js';
import { makeDraggable } from './drag.js';

const MIN_BLOCK_MINUTES = 22; // shortest an event is drawn, so its title fits

/** The day and week views: `days` columns of 24 hours. */
export function renderTimeGrid(ctx, days) {
  const first = days === 7 ? startOfWeek(ctx.cursor, ctx.settings.weekStart) : startOfDay(ctx.cursor);
  const columns = Array.from({ length: days }, (_, i) => addDays(first, i));
  const end = addDays(first, days);
  const occs = ctx.expand(first, end);
  const today = todayKey();
  const hour = ctx.compact ? 48 : 52;

  const allDay = bucketByDay(occs.filter(isAllDayLike), first, end);
  const timed = bucketByDay(occs.filter((o) => !isAllDayLike(o)), first, end);

  const root = h('div', { class: `tg${days === 1 ? ' tg-day' : ''}`, style: { '--cols': days, '--hour': `${hour}px` } });

  // Header: day names for the week, or a week strip to hop between days.
  if (days === 7) {
    root.append(h('div', { class: 'tg-head' }, h('span'), columns.map((d) => h('button', {
      type: 'button',
      class: `tg-dayhead${dateKey(d) === today ? ' today' : ''}`,
      onClick: () => ctx.select(d, 'day'),
      'aria-label': f.dayLong(d),
    }, h('span', { class: 'wd' }, ctx.compact ? f.weekdayNarrow(d) : f.weekdayShort(d)), h('span', { class: 'num' }, f.dayNumber(d))))));
  } else {
    const weekStart = startOfWeek(ctx.cursor, ctx.settings.weekStart);
    root.append(h('div', { class: 'strip' },
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const key = dateKey(d);
        const cls = ['strip-day'];
        if (key === today) cls.push('today');
        if (key === dateKey(ctx.cursor)) cls.push('selected');
        return h('button', { type: 'button', class: cls.join(' '), onClick: () => ctx.select(d), 'aria-label': f.dayLong(d) },
          h('span', { class: 'wd' }, f.weekdayNarrow(d)), h('span', { class: 'num' }, f.dayNumber(d)));
      })),
    h('div', { class: 'strip-label' }, f.dayLong(ctx.cursor)));
  }

  if (allDay.size) {
    root.append(h('div', { class: 'tg-allday' },
      h('span', { class: 'tg-gutter-label' }, 'all-day'),
      columns.map((d) => h('div', { class: 'tg-allday-col', ...dropDay(ctx, d) }, (allDay.get(dateKey(d)) ?? []).map((o) => chip(ctx, o, d))))));
  }

  const body = h('div', { class: 'tg-body' },
    h('div', { class: 'tg-hours', 'aria-hidden': 'true' },
      Array.from({ length: 23 }, (_, i) => h('span', { style: { '--h': i + 1 } }, f.hourLabel(i + 1)))),
    columns.map((d) => dayColumn(ctx, d, timed.get(dateKey(d)) ?? [], dateKey(d) === today, hour)));

  const scroller = h('div', { class: 'tg-scroll' }, body);
  scroller.addEventListener('scroll', () => { ctx.gridScroll = scroller.scrollTop; }, { passive: true });
  root.append(scroller);

  const columnEls = [...body.querySelectorAll('.tg-col')];
  columnEls.forEach((col, i) => {
    for (const block of col.querySelectorAll('.tg-event')) {
      makeDraggable(block, block.occurrence, i, {
        hour,
        columns: columnEls,
        days: columns,
        scroller,
        drop: (start, end) => ctx.moveOccurrence(block.occurrence, start, end),
        cancel: () => ctx.refresh(),
      });
    }
  });

  root.mounted = () => {
    if (ctx.gridScroll != null) {
      scroller.scrollTop = ctx.gridScroll;
      return;
    }
    const showsToday = columns.some((d) => dateKey(d) === today);
    const minute = showsToday ? Math.max(0, minuteOfDay(nowWall()) - 90) : 7 * 60;
    scroller.scrollTop = Math.min(minute, 15 * 60) * hour / 60;
  };
  return root;
}

function dayColumn(ctx, day, occs, isToday, hour) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const segments = occs
    .map((o) => {
      const top = o.start < dayStart ? 0 : minuteOfDay(o.start);
      const bottom = o.end >= dayEnd ? 1440 : minuteOfDay(o.end);
      return { o, top, bottom, drawnBottom: Math.min(1440, Math.max(bottom, top + MIN_BLOCK_MINUTES)) };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  layout(segments);

  const col = h('div', {
    class: `tg-col${isToday ? ' today' : ''}`,
    onClick: (e) => {
      if (e.target !== col) return;
      const minute = Math.floor((e.offsetY / hour) * 2) * 30; // snap to the half hour
      ctx.newEvent({ start: addMinutes(dayStart, Math.min(minute, 1410)) });
    },
  });

  for (const s of segments) {
    const { o } = s;
    const short = s.drawnBottom - s.top < 45;
    const block = h('button', {
      type: 'button',
      class: `tg-event${short ? ' short' : ''}`,
      style: {
        '--c': o.calendar.color,
        '--top': s.top,
        '--len': s.drawnBottom - s.top,
        '--col': s.col,
        '--cols': s.cols,
      },
      onClick: () => ctx.openOccurrence(o),
    },
    h('span', { class: 'tg-event-title' }, o.event.title || 'New event'),
    h('span', { class: 'tg-event-time' }, `${f.time(o.start)} – ${f.time(o.end)}`),
    o.event.location && !short ? h('span', { class: 'tg-event-sub' }, o.event.location) : null);
    block.occurrence = o;
    col.append(block);
  }

  if (isToday) col.append(h('div', { class: 'now-line', style: { '--m': minuteOfDay(nowWall()) } }));
  return col;
}

/** Side-by-side columns for overlapping events, like every calendar since the '90s. */
function layout(segments) {
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const columnEnds = [];
    for (const s of cluster) {
      let c = columnEnds.findIndex((end) => end <= s.top);
      if (c < 0) c = columnEnds.push(0) - 1;
      columnEnds[c] = s.drawnBottom;
      s.col = c;
    }
    for (const s of cluster) s.cols = columnEnds.length;
    cluster = [];
  };
  for (const s of segments) {
    if (cluster.length && s.top >= clusterEnd) flush();
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.drawnBottom);
  }
  flush();
}
