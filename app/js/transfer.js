// Moving data in and out: backups (.json) and calendar files (.ics).

import { todayKey, parseDate } from './dates.js';
import { createBackup, readBackup } from './backup.js';
import { parseICS, serializeICS } from './ics.js';
import { newId, CALENDAR_COLORS } from './model.js';
import * as f from './format.js';
import { choose, toast, saveFile, pickFile, slug } from './ui.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function backUp(ctx) {
  const text = createBackup({ settings: ctx.settings, calendars: ctx.calendars, events: ctx.events });
  if (await saveFile(`calendont-backup-${todayKey()}.json`, text, 'application/json')) {
    await ctx.markBackedUp();
    toast('Backup saved');
  }
}

/** Exports one calendar, or all of them, as an .ics file. */
export async function exportICS(ctx, calendar) {
  const events = ctx.events.filter((e) => !calendar || e.calendarId === calendar.id);
  if (!events.length) return toast(calendar ? `“${calendar.name}” has no events yet.` : 'No events to export yet.');
  const text = serializeICS(events, calendar ? { name: calendar.name, color: calendar.color } : { name: 'Calendont' });
  await saveFile(`${calendar ? slug(calendar.name) : 'calendont'}-${todayKey()}.ics`, text, 'text/calendar');
}

export async function chooseAndImport(ctx) {
  const file = await pickFile('.json,.ics,.ical,.ifb,.icalendar,application/json,text/calendar');
  if (file) await importFile(ctx, file);
}

export async function importFile(ctx, file) {
  let text;
  try {
    text = await file.text();
  } catch {
    return toast("Couldn't read that file.");
  }
  const head = text.trimStart();
  if (head.startsWith('{')) return importBackup(ctx, text);
  if (/BEGIN:VCALENDAR/i.test(head.slice(0, 2000))) return importCalendarFile(ctx, text, file.name);
  toast('Calendont opens its own backups (.json) and calendar files (.ics).');
}

async function importBackup(ctx, text) {
  let data;
  try {
    data = readBackup(text, navigator.language);
  } catch (err) {
    return toast(err.message);
  }
  const when = data.exportedAt ? `, saved ${f.dateFull(parseDate(data.exportedAt.slice(0, 10)))}` : '';
  const choice = await choose({
    title: 'Restore this backup?',
    message: `${plural(data.calendars.length, 'calendar')} and ${plural(data.events.length, 'event')}${when}.${data.skipped ? ` ${plural(data.skipped, 'entry', 'entries')} couldn't be read and will be skipped.` : ''}`,
    options: [
      { label: 'Replace everything on this device', value: 'replace', destructive: true },
      { label: 'Add to what’s already here', value: 'merge' },
    ],
  });
  if (choice === 'replace') {
    await ctx.replaceAll(data);
    toast(`Restored ${plural(data.events.length, 'event')}`, { actionLabel: 'Undo', onAction: () => ctx.undoReplace() });
  } else if (choice === 'merge') {
    await ctx.commit({ putCalendars: data.calendars, putEvents: data.events }, { message: `Added ${plural(data.events.length, 'event')}`, undo: true });
  }
}

async function importCalendarFile(ctx, text, fileName) {
  let parsed;
  try {
    parsed = parseICS(text);
  } catch (err) {
    return toast(err.message);
  }
  if (!parsed.events.length) return toast('No events in that file.');

  const name = parsed.name || fileName.replace(/\.[^.]+$/, '') || 'Imported';
  const target = await choose({
    title: `Import ${plural(parsed.events.length, 'event')}?`,
    message: parsed.warnings.join(' ') || undefined,
    options: [
      { label: `Into a new calendar, “${name}”`, value: '__new__' },
      ...ctx.calendars.map((c) => ({ label: `Into “${c.name}”`, value: c.id })),
    ],
  });
  if (!target) return;

  const putCalendars = [];
  let calendarId = target;
  if (target === '__new__') {
    const used = new Set(ctx.calendars.map((c) => c.color));
    const color = parsed.color || CALENDAR_COLORS.find((c) => !used.has(c)) || CALENDAR_COLORS[0];
    calendarId = newId();
    putCalendars.push({ id: calendarId, name, color, visible: true });
  }

  // Importing the same file twice updates events instead of duplicating them.
  const existing = new Map(ctx.events.filter((e) => e.calendarId === calendarId).map((e) => [e.uid, e]));
  const putEvents = parsed.events.map((e) => {
    const match = existing.get(e.uid);
    return { ...e, calendarId, id: match?.id ?? e.id, created: match?.created ?? e.created };
  });
  await ctx.commit({ putCalendars, putEvents }, { message: `Imported ${plural(putEvents.length, 'event')}`, undo: true });
}
