// The settings sheet: calendars, backups, preferences, about.

import { ACCENTS, CALENDAR_COLORS, SKINS, newId } from './model.js';
import * as f from './format.js';
import { h, icon, openSheet, choose } from './ui.js';
import { backUp, exportICS, chooseAndImport } from './transfer.js';

const REPO_URL = 'https://github.com/spathanasf2/Calendont';
export const VERSION = '0.1.0';

export function openSettings(ctx) {
  const body = h('div', { class: 'settings' });
  const fill = () => body.replaceChildren(
    calendarsGroup(ctx),
    lookGroup(ctx),
    backupGroup(ctx),
    preferencesGroup(ctx),
    aboutGroup(ctx),
  );
  fill();
  // Imports, undo and other tabs change data underneath the open sheet.
  ctx.onDataChange = fill;
  openSheet({ title: 'Settings', body, wide: true, onClose: () => { ctx.onDataChange = null; } });
}

function section(title, children, note) {
  return h('section', { class: 'settings-section' },
    h('h3', { class: 'group-title' }, title),
    h('div', { class: 'group' }, children),
    note ? h('p', { class: 'group-note' }, note) : null);
}

function calendarsGroup(ctx) {
  const rows = ctx.calendars.map((cal) => {
    const palette = h('div', { class: 'palette', hidden: true },
      CALENDAR_COLORS.map((color) => h('button', {
        type: 'button',
        class: `swatch${color === cal.color ? ' on' : ''}`,
        style: { '--c': color },
        'aria-label': `Colour ${color}`,
        onClick: () => ctx.commit({ putCalendars: [{ ...ctx.calendar(cal.id), color }] }),
      })));
    const name = h('input', {
      class: 'field-input',
      value: cal.name,
      'aria-label': 'Calendar name',
      autocomplete: 'off',
      onChange: () => ctx.commit({ putCalendars: [{ ...ctx.calendar(cal.id), name: name.value.trim() || 'Calendar' }] }, { quiet: true }),
      onKeydown: (e) => { if (e.key === 'Enter') name.blur(); },
    });
    const count = ctx.events.filter((e) => e.calendarId === cal.id).length;
    return h('div', { class: 'cal-block' },
      h('div', { class: 'field cal-row' },
        h('button', {
          type: 'button',
          class: `cal-toggle${cal.visible ? ' on' : ''}`,
          style: { '--c': cal.color },
          'aria-pressed': String(cal.visible),
          'aria-label': cal.visible ? `Hide ${cal.name}` : `Show ${cal.name}`,
          title: cal.visible ? 'Shown — tap to hide' : 'Hidden — tap to show',
          onClick: () => ctx.commit({ putCalendars: [{ ...ctx.calendar(cal.id), visible: !cal.visible }] }),
        }),
        name,
        h('span', { class: 'muted small' }, String(count)),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Colour for ${cal.name}`, onClick: () => { palette.hidden = !palette.hidden; } },
          h('span', { class: 'swatch mini', style: { '--c': cal.color } })),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Export ${cal.name} as .ics`, title: 'Export as .ics', onClick: () => exportICS(ctx, ctx.calendar(cal.id)) }, icon('share')),
        h('button', {
          type: 'button',
          class: 'icon-btn small',
          'aria-label': `Delete ${cal.name}`,
          title: 'Delete calendar',
          disabled: ctx.calendars.length === 1,
          onClick: async () => {
            const { name: label } = ctx.calendar(cal.id) ?? cal; // a rename doesn't redraw this row
            const ok = await choose({
              title: `Delete “${label}”?`,
              message: count ? `Its ${count} ${count === 1 ? 'event' : 'events'} will be deleted too.` : undefined,
              options: [{ label: 'Delete calendar', value: true, destructive: true }],
            });
            if (!ok) return;
            const events = ctx.events.filter((e) => e.calendarId === cal.id).map((e) => e.id);
            await ctx.commit({ deleteCalendars: [cal.id], deleteEvents: events }, { message: `Deleted “${label}”`, undo: true });
          },
        }, icon('trash'))),
      palette);
  });

  const add = h('button', {
    type: 'button',
    class: 'action-row',
    onClick: async () => {
      const used = new Set(ctx.calendars.map((c) => c.color));
      const color = CALENDAR_COLORS.find((c) => !used.has(c)) ?? CALENDAR_COLORS[0];
      await ctx.commit({ putCalendars: [{ id: newId(), name: 'New calendar', color, visible: true }] });
      const inputs = document.querySelectorAll('.settings .cal-row .field-input');
      inputs[inputs.length - 1]?.select();
    },
  }, icon('plus'), 'Add calendar');

  return section('Calendars', [rows, add], 'Tap a dot to show or hide that calendar.');
}

function backupGroup(ctx) {
  const last = ctx.lastBackup ? `Last backup ${f.relative(ctx.lastBackup)}` : 'Never backed up';
  const stale = !ctx.lastBackup || Date.now() - new Date(ctx.lastBackup) > 30 * 86_400_000;
  return section('Backup & transfer', [
    h('button', { type: 'button', class: 'action-row', onClick: () => backUp(ctx) },
      icon('download'),
      h('span', { class: 'action-text' }, 'Back up everything', h('span', { class: `action-sub${stale ? ' warn' : ''}` }, last))),
    h('button', { type: 'button', class: 'action-row', onClick: () => chooseAndImport(ctx) },
      icon('upload'),
      h('span', { class: 'action-text' }, 'Restore or import a file', h('span', { class: 'action-sub' }, 'A Calendont backup, or any .ics calendar'))),
    h('button', { type: 'button', class: 'action-row', onClick: () => exportICS(ctx) },
      icon('share'),
      h('span', { class: 'action-text' }, 'Export all as .ics', h('span', { class: 'action-sub' }, 'For Apple Calendar, Google Calendar or Outlook'))),
  ], !ctx.persistent
    ? 'This browser isn’t letting Calendont save anything (private browsing?). Changes will be lost when you close it — back up before you go.'
    : `Your calendar lives only on this device${ctx.persisted
      ? ', and the browser has agreed not to clear it on its own'
      : ', and the browser may clear it if storage runs low'}. A backup is one small file with everything in it — keep a copy somewhere safe.`);
}

function preferencesGroup(ctx) {
  const s = ctx.settings;
  const select = (label, key, options, parse = (v) => v, fallback) => {
    const el = h('select', { class: 'plain-select', 'aria-label': label, onChange: () => ctx.saveSettings({ [key]: parse(el.value) }) },
      options.map(([value, text]) => h('option', { value: String(value) }, text)));
    el.value = String(fallback ?? s[key] ?? '');
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el);
  };

  return section('Preferences', [
    select('Week starts on', 'weekStart', [[0, 'Sunday'], [1, 'Monday'], [6, 'Saturday']], Number),
    select('Time format', 'timeFormat', [['auto', 'Automatic'], ['12', '12-hour'], ['24', '24-hour']]),
    select('Default length', 'defaultDuration', [[15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours']], Number),
    select('New events go to', 'defaultCalendarId', ctx.calendars.map((c) => [c.id, c.name]), (v) => v, ctx.calendar(s.defaultCalendarId) ? undefined : ctx.calendars[0]?.id),
  ]);
}

function lookGroup(ctx) {
  const s = ctx.settings;
  const skin = SKINS.find((k) => k.id === s.skin) ?? SKINS[0];
  const save = async (patch) => {
    await ctx.saveSettings(patch);
    ctx.onDataChange?.();
  };

  const tiles = h('div', { class: 'skins', role: 'radiogroup', 'aria-label': 'Theme' },
    SKINS.map((k) => h('button', {
      type: 'button',
      class: `skin-tile skin-${k.id}`,
      role: 'radio',
      'aria-checked': String(k.id === skin.id),
      style: { '--p-bg': k.preview.bg, '--p-fg': k.preview.fg, '--p-accent': k.preview.accent, '--p-alt': k.preview.alt ?? k.preview.bg },
      onClick: () => save({ skin: k.id }),
    },
    h('span', { class: 'skin-sample', 'aria-hidden': 'true' },
      h('span', { class: 'skin-num' }, '30'),
      h('span', { class: 'skin-lines' }, h('i'), h('i'), h('i'))),
    h('span', { class: 'skin-name' }, k.name, k.modes === 'dark' ? h('small', null, ' dark') : null))));

  const appearance = h('select', { class: 'plain-select', 'aria-label': 'Appearance', onChange: () => save({ theme: appearance.value }) },
    [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, t]) => h('option', { value: v }, t)));
  appearance.value = s.theme;

  const accents = h('span', { class: 'accents' },
    h('button', {
      type: 'button',
      class: `swatch auto${s.accent ? '' : ' on'}`,
      'aria-label': 'Theme accent',
      title: 'The theme’s own accent',
      onClick: () => save({ accent: null }),
    }),
    ACCENTS.map((a) => h('button', {
      type: 'button',
      class: `swatch${a.value === s.accent ? ' on' : ''}`,
      style: { '--c': a.value },
      'aria-label': a.name,
      title: a.name,
      onClick: () => save({ accent: a.value }),
    })));

  return section('Look', [
    h('div', { class: 'field skins-field' }, tiles),
    skin.modes === 'dark' ? null : h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Appearance'), appearance),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Accent'), accents),
  ]);
}

function aboutGroup(ctx) {
  const shortcuts = [
    ['←  →', 'Previous / next'], ['T', 'Today'], ['D W M Y L', 'Day, week, month, year, list'],
    ['N', 'New event'], ['/', 'Search'], [',', 'Settings'],
  ];
  return h('div', null,
    section('About', [
      h('div', { class: 'about' },
        h('p', null, h('strong', null, 'Calendont'), ` ${VERSION} — a calendar with no accounts, no tracking and no servers. Your events never leave this device unless you send them somewhere.`),
        h('p', null, 'Open source under the MIT license. ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Source code on GitHub'), '.')),
      matchMedia('(pointer: fine)').matches
        ? h('dl', { class: 'shortcuts' }, shortcuts.map(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)]))
        : null,
    ]),
    h('div', { class: 'group danger' },
      h('button', {
        type: 'button',
        class: 'action-row destructive',
        onClick: async () => {
          const ok = await choose({
            title: 'Erase everything?',
            message: 'All calendars, events and settings on this device will be deleted. This can’t be undone.',
            options: [{ label: 'Erase all data', value: true, destructive: true }],
          });
          if (ok) await ctx.eraseAll();
        },
      }, icon('trash'), 'Erase all data')));
}
