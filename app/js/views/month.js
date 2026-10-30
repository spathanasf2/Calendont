import { addDays, addMonths, startOfMonth, startOfWeek, dateKey, todayKey, parseDate } from '../dates.js';
import * as f from '../format.js';
import { h } from '../ui.js';
import { bucketByDay, chip, eventRow, emptyNote, dropDay } from './common.js';

const AROUND = 2; // months rendered either side of the one in view
const ROWS = 6; // weeks visible at once

/**
 * The month view: a vertical run of weeks that snaps to the start of each
 * month. Drag a little to peek at the next month and it springs back; drag
 * further (or flick) and it settles on the next month.
 */
export function renderMonth(ctx) {
  const ws = ctx.settings.weekStart;
  const current = startOfMonth(ctx.cursor);
  const currentKey = dateKey(current).slice(0, 7);
  const first = startOfWeek(addMonths(current, -AROUND), ws);
  const end = addDays(startOfWeek(addMonths(current, AROUND), ws), ROWS * 7);
  const byDay = bucketByDay(ctx.expand(first, end), first, end);
  const today = todayKey();
  const selected = dateKey(ctx.cursor);
  const compact = ctx.compact;

  // Fit as many labels as a row allows; phones show dots instead.
  const rowHeight = (ctx.viewHeight - 28) / ROWS;
  const maxChips = compact ? 3 : Math.max(1, Math.floor((rowHeight - 32) / 21));

  const head = h('div', { class: 'month-head' },
    Array.from({ length: 7 }, (_, i) => {
      const d = addDays(first, i);
      return h('span', null, compact ? f.weekdayNarrow(d) : f.weekdayShort(d));
    }));

  const scroller = h('div', { class: 'month-scroll' });
  for (let week = first; week < end; week = addDays(week, 7)) {
    const row = h('div', { class: 'week' });
    for (let i = 0; i < 7; i++) {
      const day = addDays(week, i);
      if (day.getUTCDate() === 1 && day >= addMonths(current, -AROUND)) {
        row.classList.add('snap');
        row.dataset.month = dateKey(day).slice(0, 7);
      }
      row.append(dayCell(ctx, day, byDay.get(dateKey(day)) ?? [], {
        outside: dateKey(day).slice(0, 7) !== currentKey,
        today: dateKey(day) === today,
        selected: dateKey(day) === selected,
        compact,
        maxChips,
      }));
    }
    scroller.append(row);
  }

  const parts = [head, scroller];
  if (compact) {
    const occs = byDay.get(selected) ?? [];
    parts.push(h('section', { class: 'day-list', 'aria-label': f.dayLong(ctx.cursor) },
      h('h3', { class: 'day-list-title' }, f.dayLong(ctx.cursor)),
      occs.length ? occs.map((o) => eventRow(ctx, o, ctx.cursor)) : emptyNote('No events')));
  }
  const root = h('div', { class: `month${compact ? ' compact' : ''}` }, parts);

  const rowFor = (key) => scroller.querySelector(`.week[data-month="${key}"]`);

  // Settle on whichever month start is nearest once scrolling stops, but
  // never while a finger is still down: holding a peek is allowed.
  let touching = false;
  let timer;
  const settle = () => {
    clearTimeout(timer);
    // A tap re-renders the view before the lifted finger's timer fires; this
    // scroller is then detached, reads every offset as 0 and would "settle"
    // on the first month it rendered.
    if (touching || !scroller.isConnected) return;
    const top = scroller.scrollTop;
    let best = null;
    for (const row of scroller.querySelectorAll('.week.snap')) {
      if (!best || Math.abs(row.offsetTop - top) < Math.abs(best.offsetTop - top)) best = row;
    }
    if (best && best.dataset.month !== currentKey) ctx.showMonth(parseDate(`${best.dataset.month}-01`));
  };
  scroller.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(settle, 160);
  }, { passive: true });
  scroller.addEventListener('scrollend', settle);
  scroller.addEventListener('touchstart', () => { touching = true; }, { passive: true });
  const release = () => {
    touching = false;
    clearTimeout(timer);
    timer = setTimeout(settle, 160);
  };
  scroller.addEventListener('touchend', release, { passive: true });
  scroller.addEventListener('touchcancel', release, { passive: true });

  root.mounted = () => {
    scroller.scrollTop = rowFor(currentKey)?.offsetTop ?? 0;
  };
  /** Glides to the previous or next month; settling re-renders around it. */
  root.page = (dir) => {
    const target = rowFor(dateKey(addMonths(current, dir)).slice(0, 7));
    if (!target) return false;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: target.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
    return true;
  };
  return root;
}

function dayCell(ctx, day, occs, { outside, today, selected, compact, maxChips }) {
  const shown = occs.length > maxChips && !compact ? occs.slice(0, maxChips - 1) : occs.slice(0, maxChips);
  const hidden = occs.length - shown.length;
  const classes = ['day'];
  if (outside) classes.push('outside');
  if (today) classes.push('today');
  if (selected) classes.push('selected');
  if (day.getUTCDay() === 0 || day.getUTCDay() === 6) classes.push('weekend');
  if (day.getUTCDate() === 1) classes.push('first');

  return h('div', {
    class: classes.join(' '),
    role: 'button',
    tabindex: selected ? '0' : '-1',
    'aria-label': f.dayLong(day),
    'aria-pressed': selected ? 'true' : 'false',
    'aria-current': today ? 'date' : null,
    onClick: () => {
      if (compact && selected) ctx.setView('day');
      else ctx.select(day);
    },
    onDblclick: () => ctx.newEvent({ day }),
    ...dropDay(ctx, day),
    onKeydown: (e) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.currentTarget.click();
    },
  },
  day.getUTCDate() === 1 ? h('span', { class: 'month-tag' }, f.monthShort(day)) : null,
  h('span', { class: 'num' }, f.dayNumber(day)),
  h('div', { class: 'chips' },
    shown.map((o) => chip(ctx, o, day)),
    hidden > 0 && !compact
      ? h('button', { type: 'button', class: 'more', onClick: (e) => { e.stopPropagation(); ctx.select(day, 'day'); } }, `${hidden} more`)
      : null));
}
