// Calendont: wires state, storage and views together.

import {
  addDays, addMinutes, addMonths, startOfDay, startOfWeek, sameDay, dateKey, parseDate,
  nowWall, todayKey, minuteOfDay,
} from './dates.js';
import { cleanCalendar, cleanEvent, cleanSettings, defaultSettings, draftEvent, newId, SKINS } from './model.js';
import { occurrences } from './recurrence.js';
import { openStore, requestPersistence } from './store.js';
import * as f from './format.js';
import { toast, sheetOpen, closeSheet } from './ui.js';
import { renderMonth } from './views/month.js';
import { renderTimeGrid } from './views/timegrid.js';
import { renderList } from './views/list.js';
import { renderYear } from './views/year.js';
import { openEditor } from './editor.js';
import { openSettings } from './settings.js';
import { importFile } from './transfer.js';

const $ = (sel) => document.querySelector(sel);
const compactQuery = matchMedia('(max-width: 720px)');
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('calendont') : null;

const VIEWS = {
  day: (c) => renderTimeGrid(c, 1),
  week: (c) => renderTimeGrid(c, 7),
  month: renderMonth,
  year: renderYear,
  list: renderList,
};

const state = {
  store: null,
  settings: defaultSettings(navigator.language),
  calendars: [],
  events: [],
  lastBackup: null,
  view: 'month',
  cursor: startOfDay(nowWall()),
  today: todayKey(),
  previous: null, // what "Replace everything" replaced, for its undo
  askedPersistence: false,
};

/** Everything the views and sheets may read or do. */
const ctx = {
  get settings() { return state.settings; },
  get calendars() { return state.calendars; },
  get events() { return state.events; },
  get lastBackup() { return state.lastBackup; },
  get persistent() { return state.store.persistent; },
  get cursor() { return state.cursor; },
  get view() { return state.view; },
  get compact() { return compactQuery.matches; },
  get viewHeight() { return $('#view').clientHeight; },
  // View-local memory that survives re-renders.
  query: '',
  listDays: 90,
  gridScroll: null,
  onDataChange: null,

  calendar: (id) => state.calendars.find((c) => c.id === id),
  expand,
  select,
  setView,
  showMonth,
  newEvent,
  openOccurrence: (occurrence) => openEditor(ctx, { occurrence }),
  commit,
  saveSettings,
  replaceAll,
  undoReplace: () => state.previous && replaceAll(state.previous, { keepPrevious: true }),
  markBackedUp,
  eraseAll,
};

// ---------------------------------------------------------------------------
// Data

/** Occurrences of visible events overlapping [from, to), in display order. */
function expand(from, to) {
  const visible = new Map(state.calendars.filter((c) => c.visible).map((c) => [c.id, c]));
  const out = [];
  for (const event of state.events) {
    const calendar = visible.get(event.calendarId);
    if (!calendar) continue;
    for (const o of occurrences(event, from, to)) out.push({ ...o, event, calendar, allDay: event.allDay });
  }
  return out.sort((a, b) =>
    (b.allDay - a.allDay)
    || (a.start - b.start)
    || ((b.end - b.start) - (a.end - a.start))
    || a.event.title.localeCompare(b.event.title));
}

const byOrder = (a, b) => a.order - b.order || a.name.localeCompare(b.name);

async function load() {
  const data = await state.store.load();
  state.events = data.events.map(cleanEvent).filter(Boolean);
  state.calendars = data.calendars.map(cleanCalendar).filter(Boolean).sort(byOrder);
  state.settings = cleanSettings(data.settings, navigator.language);
  state.lastBackup = data.lastBackup;
  if (!state.calendars.length) await createStarterCalendars();
  applySettings();
}

async function createStarterCalendars() {
  const calendars = [
    { id: newId(), name: 'Personal', color: '#0090ff', visible: true, order: 0 },
    { id: newId(), name: 'Family', color: '#30a46c', visible: true, order: 1 },
  ];
  state.calendars = calendars;
  state.settings = { ...state.settings, defaultCalendarId: calendars[0].id };
  await state.store.write({ putCalendars: calendars, settings: state.settings });
}

/** The inverse of a change, against current state, for undo. */
function invert({ putEvents = [], deleteEvents = [], putCalendars = [], deleteCalendars = [] }) {
  const events = new Map(state.events.map((e) => [e.id, e]));
  const calendars = new Map(state.calendars.map((c) => [c.id, c]));
  const inverse = { putEvents: [], deleteEvents: [], putCalendars: [], deleteCalendars: [] };
  for (const e of putEvents) events.has(e.id) ? inverse.putEvents.push(events.get(e.id)) : inverse.deleteEvents.push(e.id);
  for (const id of deleteEvents) if (events.has(id)) inverse.putEvents.push(events.get(id));
  for (const c of putCalendars) calendars.has(c.id) ? inverse.putCalendars.push(calendars.get(c.id)) : inverse.deleteCalendars.push(c.id);
  for (const id of deleteCalendars) if (calendars.has(id)) inverse.putCalendars.push(calendars.get(id));
  return inverse;
}

/**
 * Saves a change: { putEvents, deleteEvents, putCalendars, deleteCalendars }.
 * `message` shows a toast, `undo` adds an Undo button to it, and `quiet`
 * skips refreshing an open settings sheet.
 */
async function commit(change, { message, undo = false, quiet = false } = {}) {
  const inverse = invert(change);
  const events = new Map(state.events.map((e) => [e.id, e]));
  const calendars = new Map(state.calendars.map((c) => [c.id, c]));
  let nextOrder = Math.max(-1, ...state.calendars.map((c) => c.order)) + 1;
  for (const e of change.putEvents ?? []) events.set(e.id, e);
  for (const id of change.deleteEvents ?? []) events.delete(id);
  const putCalendars = (change.putCalendars ?? []).map((c) => (calendars.has(c.id) || Number.isFinite(c.order) ? c : { ...c, order: nextOrder++ }));
  for (const c of putCalendars) calendars.set(c.id, c);
  for (const id of change.deleteCalendars ?? []) calendars.delete(id);
  state.events = [...events.values()];
  state.calendars = [...calendars.values()].sort(byOrder);
  render();
  if (!quiet) ctx.onDataChange?.();

  try {
    await state.store.write({ ...change, putCalendars });
  } catch (err) {
    console.error(err);
    toast('Couldn’t save that change. Try again, or back up your calendar.');
    await load();
    render();
    return;
  }
  channel?.postMessage('changed');
  if (!state.askedPersistence) {
    state.askedPersistence = true;
    requestPersistence();
  }
  if (message) toast(message, undo ? { actionLabel: 'Undo', onAction: () => commit(inverse) } : {});
}

async function saveSettings(patch) {
  state.settings = cleanSettings({ ...state.settings, ...patch }, navigator.language);
  applySettings();
  render();
  await state.store.write({ settings: state.settings });
  channel?.postMessage('changed');
}

async function replaceAll(data, { keepPrevious = false } = {}) {
  if (!keepPrevious) {
    state.previous = { calendars: state.calendars, events: state.events, settings: state.settings };
  }
  const calendars = data.calendars.map((c, i) => ({ ...c, order: Number.isFinite(c.order) ? c.order : i }));
  await state.store.write({ clear: true, putCalendars: calendars, putEvents: data.events, settings: data.settings });
  await load();
  render();
  ctx.onDataChange?.();
  channel?.postMessage('changed');
}

async function markBackedUp() {
  state.lastBackup = new Date().toISOString();
  await state.store.write({ lastBackup: state.lastBackup });
  ctx.onDataChange?.();
}

async function eraseAll() {
  await state.store.write({ clear: true, settings: defaultSettings(navigator.language), lastBackup: null });
  await closeSheet(true);
  ctx.query = '';
  await load();
  render();
  channel?.postMessage('changed');
  toast('All data erased');
}

// ---------------------------------------------------------------------------
// Navigation

function select(day, view) {
  state.cursor = startOfDay(day);
  if (view) setView(view);
  else render();
}

function setView(view) {
  if (!VIEWS[view] || view === state.view) return render();
  state.view = view;
  render();
  state.settings = { ...state.settings, view };
  state.store.write({ settings: state.settings });
}

function navigate(dir) {
  const c = state.cursor;
  if (state.view === 'list') return;
  // The month view scrolls to its neighbour itself, then settles via showMonth.
  if (state.view === 'month' && $('#view').firstElementChild?.page?.(dir)) return;
  const step = { day: () => addDays(c, dir), week: () => addDays(c, 7 * dir), month: () => addMonths(c, dir), year: () => addMonths(c, 12 * dir) };
  state.cursor = step[state.view]();
  render(dir > 0 ? 'next' : 'prev');
}

/** Lands on a month: today if it's in that month, otherwise the 1st. */
function showMonth(first) {
  const now = startOfDay(nowWall());
  state.cursor = dateKey(now).slice(0, 7) === dateKey(first).slice(0, 7) ? now : startOfDay(first);
  render();
}

function goToday() {
  state.cursor = startOfDay(nowWall());
  ctx.gridScroll = null;
  render();
}

function newEvent({ day, start } = {}) {
  let when = start;
  if (!when) {
    const base = day ?? state.cursor;
    const now = nowWall();
    when = sameDay(base, now)
      ? addMinutes(startOfDay(now), Math.min(23, Math.floor(minuteOfDay(now) / 60) + 1) * 60)
      : addMinutes(startOfDay(base), 9 * 60);
  }
  const preferred = ctx.calendar(state.settings.defaultCalendarId);
  const calendar = preferred?.visible ? preferred : state.calendars.find((c) => c.visible) ?? state.calendars[0];
  openEditor(ctx, { draft: draftEvent({ start: when, durationMinutes: state.settings.defaultDuration, calendarId: calendar.id }) });
}

// ---------------------------------------------------------------------------
// Rendering

function applySettings() {
  const s = state.settings;
  f.setTimeFormat(s.timeFormat);
  const skin = SKINS.find((k) => k.id === s.skin) ?? SKINS[0];
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const mode = skin.modes === 'dark' ? 'dark' : s.theme === 'system' ? (systemDark ? 'dark' : 'light') : s.theme;
  const root = document.documentElement;
  root.dataset.skin = skin.id;
  root.dataset.mode = mode;
  root.toggleAttribute('data-tty', skin.tty);
  if (s.accent) root.style.setProperty('--accent-user', s.accent);
  else root.style.removeProperty('--accent-user');
  // The inline script in index.html reads this to paint the right theme on launch.
  try {
    localStorage.setItem('calendont:look', JSON.stringify({ skin: skin.id, mode, tty: skin.tty }));
  } catch { /* storage blocked: the default theme flashes first, nothing worse */ }
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = bg; });
}

function updateHeader() {
  const c = state.cursor;
  let main = f.monthName(c);
  let sub = f.year(c);
  if (state.view === 'week') {
    const s = startOfWeek(c, state.settings.weekStart);
    const e = addDays(s, 6);
    if (s.getUTCMonth() !== e.getUTCMonth()) main = `${f.monthShort(s)} – ${f.monthShort(e)}`;
    sub = f.year(e);
  } else if (state.view === 'year') {
    main = f.year(c);
    sub = '';
  } else if (state.view === 'list') {
    main = 'Upcoming';
    sub = '';
  }
  $('#title-main').textContent = main;
  $('#title-sub').textContent = sub;
  document.title = state.view === 'list' ? 'Calendont' : `${main} ${sub} · Calendont`;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  for (const b of document.querySelectorAll('[data-action="prev"], [data-action="next"]')) b.hidden = state.view === 'list';
}

function render(direction) {
  updateHeader();
  const host = $('#view');
  const el = VIEWS[state.view](ctx);
  if (direction) el.classList.add(`enter-${direction}`);
  host.replaceChildren(el);
  el.mounted?.();
}

// ---------------------------------------------------------------------------
// Wiring

function bindChrome() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action], [data-view]');
    if (!target) return;
    if (target.dataset.view) return setView(target.dataset.view);
    switch (target.dataset.action) {
      case 'prev': return navigate(-1);
      case 'next': return navigate(1);
      case 'today': return goToday();
      case 'new': return newEvent();
      case 'settings': return openSettings(ctx);
      case 'jump': return jumpToDate();
    }
  });

  const jump = $('#jump');
  jump.addEventListener('change', () => {
    if (jump.value) select(parseDate(jump.value));
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || sheetOpen() || document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, textarea, select')) return;
    const keys = {
      ArrowLeft: () => navigate(-1), ArrowRight: () => navigate(1), j: () => navigate(1), k: () => navigate(-1),
      t: goToday, d: () => setView('day'), w: () => setView('week'), m: () => setView('month'), y: () => setView('year'), l: () => setView('list'),
      n: () => newEvent(), ',': () => openSettings(ctx),
      '/': () => { setView('list'); $('.search-input')?.focus(); },
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  });

  // Swipe sideways to page through months, weeks and days.
  const view = $('#view');
  let touch = null;
  view.addEventListener('touchstart', (e) => {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!touch || state.view === 'list') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    const quick = Date.now() - touch.t < 600;
    touch = null;
    if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) navigate(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Drop a backup or .ics anywhere to import it.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      document.body.classList.add('dropping');
    }
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dropping');
  });
  window.addEventListener('drop', (e) => {
    document.body.classList.remove('dropping');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    importFile(ctx, file);
  });

  // Desktop installs can open .ics and backup files directly (manifest file_handlers).
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async ({ files }) => {
      for (const handle of files ?? []) importFile(ctx, await handle.getFile());
    });
  }

  compactQuery.addEventListener('change', () => render());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.view === 'month' && render(), 150);
  });

  // Keep "today" and the now-line honest, including after the phone sleeps.
  const tick = () => {
    if (todayKey() !== state.today) {
      if (dateKey(state.cursor) === state.today) state.cursor = startOfDay(nowWall());
      state.today = todayKey();
      render();
      return;
    }
    const m = minuteOfDay(nowWall());
    document.querySelectorAll('.now-line').forEach((el) => el.style.setProperty('--m', m));
  };
  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());

  channel?.addEventListener('message', async () => {
    await load();
    render();
    ctx.onDataChange?.();
  });
}

function jumpToDate() {
  const jump = $('#jump');
  jump.value = dateKey(state.cursor);
  try {
    jump.showPicker();
  } catch {
    jump.focus();
    jump.click();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let reloading = false;
  let requested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!requested || reloading) return;
    reloading = true;
    location.reload();
  });
  const offer = (worker) => {
    toast('A new version of Calendont is ready.', {
      actionLabel: 'Reload',
      timeout: 20_000,
      onAction: () => {
        requested = true;
        worker.postMessage('skip-waiting');
      },
    });
  };
  const watch = (worker) => worker?.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    watch(reg.installing); // an update may already be on its way
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch((err) => console.warn('Offline support unavailable:', err));
}

async function init() {
  state.store = await openStore();
  await load();
  state.view = state.settings.view;
  bindChrome();
  render();
  document.body.classList.add('ready');
  if (!state.store.persistent) toast('This browser won’t let Calendont save. Changes last until you close it.', { timeout: 8000 });
  registerServiceWorker();
}

init();
