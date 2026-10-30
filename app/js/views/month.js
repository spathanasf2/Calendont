import { addDays, startOfMonth, startOfWeek, daysInMonth, diffDays, dateKey, todayKey } from '../dates.js';
import * as f from '../format.js';
import { h } from '../ui.js';
import { bucketByDay, chip, eventRow, emptyNote } from './common.js';

export function renderMonth(ctx) {
  const cursor = ctx.cursor;
  const first = startOfMonth(cursor);
  const gridStart = startOfWeek(first, ctx.settings.weekStart);
  const weeks = Math.ceil((diffDays(gridStart, first) + daysInMonth(first.getUTCFullYear(), first.getUTCMonth())) / 7);
  const gridEnd = addDays(gridStart, weeks * 7);
  const byDay = bucketByDay(ctx.expand(gridStart, gridEnd), gridStart, gridEnd);
  const today = todayKey();
  const selected = dateKey(cursor);
  const compact = ctx.compact;

  // Fit as many labels as the cell height allows; phones show dots instead.
  const cellHeight = (ctx.viewHeight - 28) / weeks;
  const maxChips = compact ? 3 : Math.max(1, Math.floor((cellHeight - 32) / 21));

  const head = h('div', { class: 'month-head' },
    Array.from({ length: 7 }, (_, i) => {
      const d = addDays(gridStart, i);
      return h('span', null, compact ? f.weekdayNarrow(d) : f.weekdayShort(d));
    }));

  const grid = h('div', { class: 'month-grid', style: { '--weeks': weeks } });
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(gridStart, i);
    const key = dateKey(day);
    const occs = byDay.get(key) ?? [];
    const shown = occs.length > maxChips && !compact ? occs.slice(0, maxChips - 1) : occs.slice(0, maxChips);
    const hidden = occs.length - shown.length;
    const classes = ['day'];
    if (day.getUTCMonth() !== first.getUTCMonth()) classes.push('outside');
    if (key === today) classes.push('today');
    if (key === selected) classes.push('selected');
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) classes.push('weekend');

    grid.append(h('div', {
      class: classes.join(' '),
      role: 'button',
      tabindex: key === selected ? '0' : '-1',
      'aria-label': f.dayLong(day),
      'aria-pressed': key === selected ? 'true' : 'false',
      'aria-current': key === today ? 'date' : null,
      onClick: () => {
        if (compact && key === selected) ctx.setView('day');
        else ctx.select(day);
      },
      onDblclick: () => ctx.newEvent({ day }),
    },
    h('span', { class: 'num' }, f.dayNumber(day)),
    h('div', { class: 'chips' },
      shown.map((o) => chip(ctx, o, day)),
      hidden > 0 && !compact
        ? h('button', { type: 'button', class: 'more', onClick: (e) => { e.stopPropagation(); ctx.select(day, 'day'); } }, `${hidden} more`)
        : null)));
  }

  const parts = [head, grid];
  if (compact) {
    const occs = byDay.get(selected) ?? [];
    parts.push(h('section', { class: 'day-list', 'aria-label': f.dayLong(cursor) },
      h('h3', { class: 'day-list-title' }, f.dayLong(cursor)),
      occs.length ? occs.map((o) => eventRow(ctx, o, cursor)) : emptyNote('No events')));
  }
  return h('div', { class: `month${compact ? ' compact' : ''}` }, parts);
}
