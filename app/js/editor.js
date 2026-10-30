// The event sheet: create, edit, repeat, share and delete.

import {
  addDays, addMinutes, parseDate, parseWhen, dateKey, timeKey, diffDays, diffMinutes,
} from './dates.js';
import { weekdayPosition, occurrences, eventSpan } from './recurrence.js';
import { serializeICS } from './ics.js';
import * as f from './format.js';
import { h, icon, openSheet, choose, saveFile, slug } from './ui.js';
import { chooseScope, occurrenceChange } from './edits.js';

const PRESETS = {
  never: null,
  daily: { freq: 'daily', interval: 1 },
  weekdays: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] },
  weekly: { freq: 'weekly', interval: 1 },
  biweekly: { freq: 'weekly', interval: 2 },
  monthly: { freq: 'monthly', interval: 1 },
  yearly: { freq: 'yearly', interval: 1 },
};
const PRESET_LABELS = {
  never: 'Never', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week',
  biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year', custom: 'Custom…',
};
const UNITS = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'], yearly: ['year', 'years'] };
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

function presetOf(rule) {
  if (!rule) return 'never';
  const { until, count, ...shape } = rule;
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (preset && JSON.stringify(shape) === JSON.stringify(preset)) return name;
  }
  return 'custom';
}

/**
 * Opens the editor. Pass `occurrence` to edit an existing event (for a
 * repeating one, the occurrence that was tapped), or `draft` for a new one.
 */
export function openEditor(ctx, { occurrence, draft }) {
  const series = occurrence?.event ?? null;
  const base = series ?? draft;
  const isNew = !series;
  const start0 = occurrence ? occurrence.start : parseWhen(draft.start);
  const end0 = occurrence ? occurrence.end : base.allDay ? addDays(parseDate(draft.end), 1) : parseWhen(draft.end);

  // ---- fields
  const title = h('input', { class: 'field-input title-input', placeholder: 'Title', value: base.title, 'aria-label': 'Title', enterkeyhint: 'done', autocomplete: 'off' });
  const location = h('input', { class: 'field-input', placeholder: 'Location', value: base.location, 'aria-label': 'Location', enterkeyhint: 'done', autocomplete: 'off' });
  const allDay = h('input', { type: 'checkbox', class: 'switch', checked: base.allDay, 'aria-label': 'All-day' });
  const startDate = h('input', { type: 'date', class: 'pill-input', value: dateKey(start0), 'aria-label': 'Start date', required: true });
  const startTime = h('input', { type: 'time', class: 'pill-input', value: base.allDay ? '09:00' : timeKey(start0), 'aria-label': 'Start time', step: 300 });
  const endDate = h('input', { type: 'date', class: 'pill-input', value: dateKey(base.allDay ? addDays(end0, -1) : end0), 'aria-label': 'End date', required: true });
  const endTime = h('input', { type: 'time', class: 'pill-input', value: base.allDay ? '10:00' : timeKey(end0), 'aria-label': 'End time', step: 300 });
  const error = h('p', { class: 'field-error', role: 'alert' });

  const repeat = h('select', { class: 'plain-select', 'aria-label': 'Repeat' },
    Object.entries(PRESET_LABELS).map(([value, label]) => h('option', { value }, label)));
  repeat.value = presetOf(base.rrule);

  const rule0 = base.rrule ?? {};
  const every = h('input', { type: 'number', class: 'pill-input num-input', min: 1, max: 999, value: rule0.interval ?? 1, 'aria-label': 'Repeat every', inputmode: 'numeric' });
  const unit = h('select', { class: 'pill-input', 'aria-label': 'Repeat unit' },
    Object.keys(UNITS).map((freq) => h('option', { value: freq }, UNITS[freq][1])));
  unit.value = rule0.freq ?? 'weekly';
  const weekdayButtons = Array.from({ length: 7 }, (_, i) => {
    const day = (ctx.settings.weekStart + i) % 7;
    const sample = addDays(parseDate('2026-01-04'), day); // a Sunday, plus `day`
    return h('button', { type: 'button', class: 'weekday-toggle', 'data-day': day, 'aria-pressed': 'false', 'aria-label': f.weekdayLong(sample) }, f.weekdayNarrow(sample));
  });
  for (const b of weekdayButtons) {
    b.addEventListener('click', () => {
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      ruleEdited = true;
      changed();
    });
  }
  const monthMode = h('select', { class: 'pill-input', 'aria-label': 'Repeat on' });
  const endMode = h('select', { class: 'plain-select', 'aria-label': 'End repeat' },
    h('option', { value: 'never' }, 'Never'), h('option', { value: 'until' }, 'On date'), h('option', { value: 'count' }, 'After'));
  endMode.value = rule0.until ? 'until' : rule0.count ? 'count' : 'never';
  const untilDate = h('input', { type: 'date', class: 'pill-input', value: rule0.until ?? dateKey(addDays(start0, 90)), 'aria-label': 'End repeat date' });
  const count = h('input', { type: 'number', class: 'pill-input num-input', min: 1, max: 9999, value: rule0.count ?? 10, 'aria-label': 'Number of times', inputmode: 'numeric' });

  const calendar = h('select', { class: 'plain-select', 'aria-label': 'Calendar' },
    ctx.calendars.map((c) => h('option', { value: c.id }, c.name)));
  calendar.value = base.calendarId;
  const calendarDot = h('span', { class: 'cal-dot' });
  const notes = h('textarea', { class: 'field-input notes-input', placeholder: 'Notes', rows: 3, 'aria-label': 'Notes' });
  notes.value = base.notes;

  // ---- layout
  const timeRows = [
    field('Starts', startDate, startTime),
    field('Ends', endDate, endTime),
  ];
  const customPanel = h('div', { class: 'custom-repeat' },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Every'), h('span', { class: 'field-controls' }, every, unit)),
    h('div', { class: 'field weekdays-row' }, h('span', { class: 'weekday-toggles' }, weekdayButtons)),
    h('div', { class: 'field month-row' }, h('span', { class: 'field-controls grow' }, monthMode)));
  const endRow = h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'End repeat'),
    h('span', { class: 'field-controls' }, endMode, untilDate, h('span', { class: 'count-wrap' }, count, h('span', { class: 'muted' }, 'times'))));

  const body = h('form', { class: 'editor', onSubmit: (e) => { e.preventDefault(); save(); } },
    h('div', { class: 'group' }, h('div', { class: 'field' }, title), h('div', { class: 'field' }, icon('pin', 'icon field-icon'), location)),
    h('div', { class: 'group' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'All-day'), allDay),
      timeRows,
      error),
    h('div', { class: 'group' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Repeat'), repeat),
      customPanel,
      endRow),
    h('div', { class: 'group' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Calendar'), h('span', { class: 'field-controls' }, calendarDot, calendar))),
    h('div', { class: 'group' }, h('div', { class: 'field' }, notes)),
    isNew ? templatePicker(ctx, useTemplate) : null,
    isNew ? null : h('div', { class: 'group actions' },
      h('button', { type: 'button', class: 'action-row', onClick: share }, icon('share'), 'Send as file'),
      h('button', { type: 'button', class: 'action-row destructive', onClick: remove }, icon('trash'), 'Delete event')),
    h('button', { type: 'submit', hidden: true }));

  const saveBtn = h('button', { type: 'button', class: 'text-btn strong', onClick: () => save() }, isNew ? 'Add' : 'Done');

  // Seed weekday toggles from an existing rule, then settle the form before snapshotting it.
  const seedDays = rule0.byDay ?? (rule0.freq === 'weekly' ? [start0.getUTCDay()] : []);
  for (const b of weekdayButtons) if (seedDays.includes(Number(b.dataset.day))) b.setAttribute('aria-pressed', 'true');
  refresh();
  const initial = JSON.stringify(values());
  const sheet = openSheet({
    title: isNew ? 'New Event' : 'Edit Event',
    body,
    action: saveBtn,
    isDirty: () => JSON.stringify(values()) !== initial,
  });

  // ---- behaviour
  let duration = diffMinutes(parseWhen(values().start), parseWhen(values().end));
  // Whether the repeat settings themselves were changed. Moving one occurrence can
  // alter the rule they produce ("the second Wednesday") without anyone editing it.
  let ruleEdited = false;

  function field(label, ...controls) {
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'field-controls' }, controls));
  }

  function startWall() {
    return allDay.checked ? parseDate(startDate.value) : parseWhen(`${startDate.value}T${startTime.value || '00:00'}`);
  }
  function endWall() {
    return allDay.checked ? parseDate(endDate.value) : parseWhen(`${endDate.value}T${endTime.value || '00:00'}`);
  }

  function selectedDays() {
    return weekdayButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => Number(b.dataset.day)).sort();
  }

  function buildRule() {
    const preset = repeat.value;
    if (preset === 'never' || !startDate.value) return null;
    const start = parseDate(startDate.value);
    let rule;
    if (preset !== 'custom') rule = structuredClone(PRESETS[preset]);
    else {
      rule = { freq: unit.value, interval: Math.min(999, Math.max(1, Number.parseInt(every.value, 10) || 1)) };
      if (rule.freq === 'weekly') {
        const days = selectedDays();
        if (days.length && !(days.length === 1 && days[0] === start.getUTCDay())) rule.byDay = days;
      }
      if ((rule.freq === 'monthly' || rule.freq === 'yearly') && monthMode.value !== 'date') {
        const pos = weekdayPosition(start);
        rule.byWeekday = { day: pos.day, nth: monthMode.value === 'last' ? -1 : pos.nth };
      }
    }
    if (endMode.value === 'until' && untilDate.value) rule.until = untilDate.value < startDate.value ? startDate.value : untilDate.value;
    if (endMode.value === 'count') rule.count = Math.min(9999, Math.max(1, Number.parseInt(count.value, 10) || 1));
    return rule;
  }

  function values() {
    const isAllDay = allDay.checked;
    return {
      title: title.value.trim(),
      location: location.value.trim(),
      notes: notes.value.trim(),
      calendarId: calendar.value,
      allDay: isAllDay,
      start: isAllDay ? startDate.value : `${startDate.value}T${startTime.value || '00:00'}`,
      end: isAllDay ? endDate.value : `${endDate.value}T${endTime.value || '00:00'}`,
      rrule: buildRule(),
    };
  }

  function valid() {
    if (!startDate.value || !endDate.value) return 'Pick a start and end date.';
    if (endWall() < startWall()) return 'The event ends before it starts.';
    return '';
  }

  function refresh() {
    for (const t of [startTime, endTime]) t.hidden = allDay.checked;
    const cal = ctx.calendar(calendar.value);
    calendarDot.style.setProperty('--c', cal?.color ?? 'transparent');

    const isCustom = repeat.value === 'custom';
    customPanel.hidden = !isCustom;
    endRow.hidden = repeat.value === 'never';
    unit.querySelectorAll('option').forEach((o) => { o.textContent = UNITS[o.value][every.value === '1' ? 0 : 1]; });
    body.querySelector('.weekdays-row').hidden = unit.value !== 'weekly';
    body.querySelector('.month-row').hidden = unit.value !== 'monthly' && unit.value !== 'yearly';
    untilDate.hidden = endMode.value !== 'until';
    count.parentElement.hidden = endMode.value !== 'count';
    untilDate.min = startDate.value;

    if (startDate.value) {
      // "On day 30" / "On the fifth Friday" / "On the last Friday", for the chosen start.
      const start = parseDate(startDate.value);
      const pos = weekdayPosition(start);
      const wd = f.weekdayLong(start);
      const yearly = unit.value === 'yearly';
      const ofMonth = yearly ? ` of ${f.monthName(start)}` : '';
      const options = [[ 'date', yearly ? `On ${f.monthName(start)} ${start.getUTCDate()}` : `On day ${start.getUTCDate()}` ]];
      if (pos.nth <= 4 || !pos.isLast) options.push(['nth', `On the ${ORDINALS[pos.nth]} ${wd}${ofMonth}`]);
      if (pos.isLast) options.push(['last', `On the last ${wd}${ofMonth}`]);
      const previous = monthMode.value || (rule0.byWeekday ? (rule0.byWeekday.nth === -1 ? 'last' : 'nth') : 'date');
      monthMode.replaceChildren(...options.map(([value, label]) => h('option', { value }, label)));
      monthMode.value = options.some(([v]) => v === previous) ? previous : 'date';
    }

    const problem = valid();
    error.textContent = problem;
    error.hidden = !problem;
    saveBtn.disabled = !!problem;
  }

  function changed() {
    refresh();
  }

  /** Fills the form from a repeating event, on the date already chosen. */
  function useTemplate(t) {
    title.value = t.title;
    location.value = t.location;
    notes.value = t.notes;
    calendar.value = t.calendarId;
    allDay.checked = t.allDay;
    repeat.value = 'never';
    const span = eventSpan(t);
    if (t.allDay) {
      endDate.value = dateKey(addDays(parseDate(startDate.value), diffDays(span.start, span.end) - 1));
    } else {
      startTime.value = timeKey(span.start);
      duration = diffMinutes(span.start, span.end);
      shiftEnd();
    }
    lastStartDate = startDate.value;
    changed();
    body.closest('.sheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function shiftEnd() {
    if (!startDate.value) return;
    if (allDay.checked) {
      const days = Math.max(0, diffDays(parseDate(startDate.value), parseDate(endDate.value || startDate.value)));
      endDate.value = dateKey(addDays(parseDate(startDate.value), days));
    } else {
      const end = addMinutes(startWall(), Math.max(0, duration));
      endDate.value = dateKey(end);
      endTime.value = timeKey(end);
    }
  }

  // Moving the start drags the end along, keeping the duration.
  let lastStartDate = startDate.value;
  startDate.addEventListener('change', () => {
    // A lone toggle on the start's weekday means "the start's weekday", so it moves along.
    const days = selectedDays();
    if (lastStartDate && startDate.value && days.length === 1 && days[0] === parseDate(lastStartDate).getUTCDay()) {
      const day = parseDate(startDate.value).getUTCDay();
      for (const b of weekdayButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.day) === day));
    }
    if (allDay.checked && lastStartDate && endDate.value) {
      const span = diffDays(parseDate(lastStartDate), parseDate(endDate.value));
      if (startDate.value) endDate.value = dateKey(addDays(parseDate(startDate.value), Math.max(0, span)));
    } else shiftEnd();
    lastStartDate = startDate.value;
    changed();
  });
  startTime.addEventListener('change', () => { shiftEnd(); changed(); });
  for (const input of [endDate, endTime]) {
    input.addEventListener('change', () => {
      if (!allDay.checked && !valid()) duration = diffMinutes(startWall(), endWall());
      changed();
    });
  }
  allDay.addEventListener('change', () => {
    if (!allDay.checked) {
      duration = ctx.settings.defaultDuration;
      shiftEnd();
    } else if (endTime.value === '00:00' && endDate.value > startDate.value) {
      // Ending at midnight, the event never reaches that last day.
      endDate.value = dateKey(addDays(parseDate(endDate.value), -1));
    }
    changed();
  });
  repeat.addEventListener('change', () => {
    ruleEdited = true;
    if (repeat.value === 'custom') {
      // Seed the custom panel from the start date.
      const start = parseDate(startDate.value);
      if (!selectedDays().length) weekdayButtons.find((b) => Number(b.dataset.day) === start.getUTCDay())?.setAttribute('aria-pressed', 'true');
    }
    changed();
  });
  for (const el of [every, unit, monthMode, endMode, untilDate, count, calendar]) {
    el.addEventListener('change', changed);
    el.addEventListener('input', changed);
    if (el !== calendar) el.addEventListener('input', () => { ruleEdited = true; });
  }
  for (const input of [title, location]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
  }

  if (isNew && !ctx.compact) title.focus();

  // ---- actions

  async function save() {
    if (valid()) return refresh();
    const v = values();
    const now = new Date().toISOString();
    // Saving into a hidden calendar shows it, or the event would seem to vanish.
    const cal = ctx.calendar(v.calendarId);
    const reveal = cal && !cal.visible ? { putCalendars: [{ ...cal, visible: true }] } : {};
    if (isNew) {
      await ctx.commit({ putEvents: [{ ...draft, ...v, updated: now }], ...reveal });
      return sheet.close(true);
    }
    if (JSON.stringify(v) === initial) return sheet.close(true);
    if (!series.rrule) {
      await ctx.commit({ putEvents: [{ ...series, ...v, updated: now }], ...reveal });
      return sheet.close(true);
    }

    const ruleChanged = ruleEdited && JSON.stringify(v.rrule) !== JSON.stringify(JSON.parse(initial).rrule);
    const scope = ruleChanged ? 'all' : await chooseScope();
    if (!scope) return;
    await ctx.commit({ ...occurrenceChange({ series, occurrence, values: v, scope, now }), ...reveal });
    sheet.close(true);
  }

  async function remove() {
    const label = series.title || 'Event';
    if (!series.rrule) {
      sheet.close(true);
      return ctx.commit({ deleteEvents: [series.id] }, { message: `Deleted “${label}”`, undo: true });
    }
    const isFirst = occurrence.date === dateKey(parseWhen(series.start));
    const scope = await choose({
      title: 'Delete this repeating event?',
      options: [
        { label: 'Delete this event only', value: 'one', destructive: true },
        !isFirst && { label: 'Delete this and future events', value: 'future', destructive: true },
        { label: 'Delete all events', value: 'all', destructive: true },
      ].filter(Boolean),
    });
    if (!scope) return;
    sheet.close(true);
    const now = new Date().toISOString();
    if (scope === 'all') return ctx.commit({ deleteEvents: [series.id] }, { message: `Deleted “${label}”`, undo: true });
    if (scope === 'one') {
      const next = { ...series, exdates: [...new Set([...series.exdates, occurrence.date])].sort(), updated: now };
      return ctx.commit({ putEvents: [next] }, { message: 'Deleted one event', undo: true });
    }
    const { count: _drop, ...rule } = series.rrule;
    rule.until = dateKey(addDays(parseDate(occurrence.date), -1));
    const kept = { ...series, rrule: rule, updated: now };
    // If every earlier occurrence was already deleted, nothing is left: drop the series.
    if (!occurrences(kept, parseWhen(series.start), parseDate(occurrence.date)).length) {
      return ctx.commit({ deleteEvents: [series.id] }, { message: `Deleted “${label}”`, undo: true });
    }
    return ctx.commit({ putEvents: [kept] }, { message: 'Deleted future events', undo: true });
  }

  async function share() {
    // A repeating event goes whole, from its first date, so its count and exceptions still line up.
    const when = series.rrule ? { allDay: series.allDay, start: series.start, end: series.end, rrule: series.rrule } : {};
    const ev = { ...series, ...values(), ...when };
    const text = serializeICS([ev], { color: ctx.calendar(ev.calendarId)?.color });
    await saveFile(`${slug(ev.title || 'event')}.ics`, text, 'text/calendar');
  }
}

/**
 * New events can start from a repeating one: its title, place, notes, calendar
 * and times, on the date being added. Only events saved as repeating are
 * offered, and only here: nothing is guessed from what you type.
 */
function templatePicker(ctx, use) {
  const seen = new Set();
  const templates = ctx.events
    .filter((e) => e.rrule)
    .sort((a, b) => a.title.localeCompare(b.title) || b.updated.localeCompare(a.updated))
    .filter((e) => {
      const key = `${e.title.trim().toLowerCase()}|${e.calendarId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!templates.length) return null;

  return h('section', { class: 'templates' },
    h('h3', { class: 'group-title' }, 'Start from a repeating event'),
    h('div', { class: 'group' }, templates.map((t) => {
      const { start, end } = eventSpan(t);
      const when = t.allDay ? 'all-day' : `${f.time(start)} – ${f.time(end)}`;
      const preset = presetOf(t.rrule);
      const how = preset !== 'custom' ? PRESET_LABELS[preset]
        : t.rrule.byDay ? `Every ${t.rrule.interval > 1 ? `${t.rrule.interval} weeks` : 'week'} on ${t.rrule.byDay.map((d) => f.weekdayShort(addDays(parseDate('2026-01-04'), d))).join(', ')}`
        : 'Repeats';
      return h('button', { type: 'button', class: 'action-row template-row', onClick: () => use(t) },
        h('span', { class: 'cal-dot', style: { '--c': ctx.calendar(t.calendarId)?.color ?? 'transparent' } }),
        h('span', { class: 'action-text' },
          t.title || 'New event',
          h('span', { class: 'action-sub' }, [how, when, t.location].filter(Boolean).join(' · '))));
    })));
}
