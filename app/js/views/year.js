import { addDays, startOfWeek, daysInMonth, dateKey, todayKey } from '../dates.js';
import * as f from '../format.js';
import { h } from '../ui.js';
import { bucketByDay } from './common.js';

/** Twelve small months; busier days glow brighter. */
export function renderYear(ctx) {
  const year = ctx.cursor.getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const busy = bucketByDay(ctx.expand(from, to), from, to);
  const today = todayKey();
  const ws = ctx.settings.weekStart;
  const thisMonth = today.slice(0, 7);

  const months = Array.from({ length: 12 }, (_, m) => {
    const first = new Date(Date.UTC(year, m, 1));
    const lead = (first.getUTCDay() - ws + 7) % 7;
    const days = daysInMonth(year, m);
    const key = dateKey(first).slice(0, 7);
    return h('section', { class: `ymonth${key === thisMonth ? ' current' : ''}` },
      h('button', { type: 'button', class: 'ymonth-title', onClick: () => ctx.select(first, 'month') }, f.monthName(first)),
      h('div', { class: 'ymonth-grid', role: 'grid', 'aria-label': f.monthName(first) },
        Array.from({ length: 7 }, (_, i) => h('span', { class: 'ywd', 'aria-hidden': 'true' }, f.weekdayNarrow(addDays(startOfWeek(first, ws), i)))),
        Array.from({ length: lead }, () => h('span')),
        Array.from({ length: days }, (_, i) => {
          const day = new Date(Date.UTC(year, m, i + 1));
          const k = dateKey(day);
          const count = busy.get(k)?.length ?? 0;
          return h('button', {
            type: 'button',
            class: `yday${count ? ` heat-${Math.min(count, 4)}` : ''}${k === today ? ' today' : ''}`,
            'aria-label': `${f.dayLong(day)}${count ? `, ${count} ${count === 1 ? 'event' : 'events'}` : ''}`,
            onClick: () => ctx.select(day, 'day'),
          }, String(i + 1));
        })));
  });

  const root = h('div', { class: 'year' }, h('div', { class: 'year-grid' }, months));
  root.mounted = () => {
    // Open with the month we came from in view.
    const focus = months[ctx.cursor.getUTCMonth()];
    if (focus.offsetTop + focus.offsetHeight > root.clientHeight) root.scrollTop = focus.offsetTop - 12;
  };
  return root;
}
