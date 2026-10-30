import { addDays, startOfDay, dateKey, parseDate, nowWall } from '../dates.js';
import * as f from '../format.js';
import { h, icon } from '../ui.js';
import { eventRow, emptyNote } from './common.js';

/** Upcoming events, or search results across the past year and next two. */
export function renderList(ctx) {
  const results = h('div', { class: 'list-results' });
  const search = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Search events',
    value: ctx.query,
    'aria-label': 'Search events',
    enterkeyhint: 'search',
    onInput: () => {
      ctx.query = search.value;
      fill();
    },
  });

  function fill() {
    const today = startOfDay(nowWall());
    const q = ctx.query.trim().toLowerCase();
    const from = q ? addDays(today, -365) : today;
    const to = q ? addDays(today, 730) : addDays(today, ctx.listDays);
    const match = q ? (e) => `${e.title}\n${e.location}\n${e.notes}`.toLowerCase().includes(q) : undefined;
    const occs = ctx.expand(from, to, { match });

    // Each occurrence is listed once, under the day it starts (or today, if already under way).
    const groups = new Map();
    for (const o of occs) {
      const key = dateKey(o.start < from ? from : o.start);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    const todayKey = dateKey(today);
    const tomorrowKey = dateKey(addDays(today, 1));
    // Long lists render a few hundred rows at a time.
    const sections = [];
    let shown = 0;
    let cut = false;
    for (const key of [...groups.keys()].sort()) {
      if (shown >= ctx.listRows) {
        cut = true;
        break;
      }
      shown += groups.get(key).length;
      const day = parseDate(key);
      const label = key === todayKey ? `Today · ${f.dayMedium(day)}` : key === tomorrowKey ? `Tomorrow · ${f.dayMedium(day)}` : f.dayLong(day);
      const yearNote = day.getUTCFullYear() !== today.getUTCFullYear() ? `, ${f.year(day)}` : '';
      sections.push(h('section', { class: `list-day${key < todayKey ? ' past' : ''}` },
        h('h3', { class: 'list-day-title' }, label + yearNote),
        groups.get(key).map((o) => eventRow(ctx, o, day))));
    }

    if (!sections.length) sections.push(emptyNote(q ? 'No events match.' : 'Nothing coming up.'));
    else if (cut || !q) {
      const more = () => {
        if (cut) ctx.listRows += 300;
        else ctx.listDays += 90;
        fill();
      };
      sections.push(h('button', { type: 'button', class: 'more-btn', onClick: more }, 'Show more'));
    }
    results.replaceChildren(...sections);
  }

  fill();
  return h('div', { class: 'list' },
    h('div', { class: 'search' }, icon('search'), search),
    results);
}
