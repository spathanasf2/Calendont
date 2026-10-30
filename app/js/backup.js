// The Calendont backup file: one readable JSON document holding everything
// (calendars, events, settings), for safekeeping or moving to another device.
// Bump BACKUP_VERSION only for changes older readers can't ignore, and keep
// reading every older version.

import { cleanCalendar, cleanEvent, cleanSettings, newId, CALENDAR_COLORS } from './model.js';

export const BACKUP_FORMAT = 'calendont-backup';
export const BACKUP_VERSION = 1;

export function createBackup({ settings, calendars, events }, now = new Date()) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    settings,
    calendars,
    events,
  }, null, 2);
}

/**
 * Reads and cleans a backup. Throws an Error with a user-facing message when
 * the file can't be used. `skipped` counts entries dropped as unreadable.
 */
export function readBackup(text, locale) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a Calendont backup.");
  }
  if (!data || data.format !== BACKUP_FORMAT) throw new Error("This file isn't a Calendont backup.");
  if (!Number.isInteger(data.version) || data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Calendont. Update the app and try again.');
  }

  let skipped = 0;
  const calendars = [];
  for (const raw of Array.isArray(data.calendars) ? data.calendars : []) {
    const cal = cleanCalendar(raw);
    if (cal && !calendars.some((c) => c.id === cal.id)) calendars.push(cal);
    else skipped++;
  }

  const events = [];
  for (const raw of Array.isArray(data.events) ? data.events : []) {
    const ev = cleanEvent(raw);
    if (ev) events.push(ev);
    else skipped++;
  }

  // Events whose calendar is missing go to the first calendar, or a new one.
  const known = new Set(calendars.map((c) => c.id));
  const orphans = events.filter((e) => !known.has(e.calendarId));
  if (orphans.length) {
    if (!calendars.length) calendars.push({ id: newId(), name: 'Imported', color: CALENDAR_COLORS[5], visible: true, order: 0 });
    for (const e of orphans) e.calendarId = calendars[0].id;
  }

  return {
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    settings: cleanSettings(data.settings, locale),
    calendars,
    events,
    skipped,
  };
}
