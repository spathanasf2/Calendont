// One quiet line under the header, for the only two things worth interrupting
// for: installing on iPhone before events pile up in Safari's separate storage,
// and a backup that is overdue. Each can be dismissed.

import { h } from './ui.js';
import * as f from './format.js';
import { backupDue } from './backup.js';
import { backUp } from './transfer.js';

const PREFS = 'calendont:banner'; // per-device: which hints were dismissed
const SNOOZE_MS = 14 * 86_400_000;

function prefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS)) ?? {};
  } catch {
    return {};
  }
}

function remember(patch) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...prefs(), ...patch }));
  } catch { /* storage blocked: the hint may come back, nothing worse */ }
}

const onIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

export function updateBanner(ctx) {
  const el = document.getElementById('banner');
  const p = prefs();
  let content = null;

  if (onIOS() && !installed() && !p.installHintDismissed) {
    content = [
      h('span', { class: 'banner-text' },
        'Install Calendont: tap ', h('b', null, 'Share'), ', then ', h('b', null, 'Add to Home Screen'),
        '. The installed app keeps its own copy of your calendar, so install before adding events.'),
      h('button', { type: 'button', class: 'banner-btn', onClick: () => { remember({ installHintDismissed: true }); updateBanner(ctx); } }, 'Got it'),
    ];
  } else if (backupDue(ctx.events, ctx.lastBackup) && (p.backupSnoozedUntil ?? 0) < Date.now()) {
    content = [
      h('span', { class: 'banner-text' }, ctx.lastBackup
        ? `Your last backup was ${f.relative(ctx.lastBackup)}, and things have changed since.`
        : 'No backup yet, and your calendar lives only on this device.'),
      h('button', { type: 'button', class: 'banner-btn strong', onClick: () => backUp(ctx) }, 'Back up'),
      h('button', { type: 'button', class: 'banner-btn', onClick: () => { remember({ backupSnoozedUntil: Date.now() + SNOOZE_MS }); updateBanner(ctx); } }, 'Later'),
    ];
  }

  el.hidden = !content;
  el.replaceChildren(...(content ?? []));
}
