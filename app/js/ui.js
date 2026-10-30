// Small DOM helpers: element building, icons, sheets, prompts, toasts, files.

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'indeterminate']);

/** h('button', { class: 'x', onClick }, 'Label', child) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [name, value] of Object.entries(v)) el.style.setProperty(name, value);
    } else if (k === 'html') el.innerHTML = v; // trusted markup only (icons)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const PATHS = {
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  pin: '<path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5M5 4h14"/>',
};

export function icon(name, cls = 'icon') {
  return h('span', {
    class: cls,
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`,
  });
}

// ---------------------------------------------------------------------------
// Sheets: one modal at a time, a bottom sheet on phones and a card elsewhere.

const sheetEl = () => document.getElementById('sheet');
let activeSheet = null;

/**
 * Opens a sheet. `action` (a button) takes the header's right slot, with
 * Cancel on the left; without one there is just Done. `isDirty` guards
 * against losing edits to a stray tap or Escape.
 */
export function openSheet({ title, body, action, onClose, isDirty, wide = false }) {
  const dialog = sheetEl();
  closeSheetNow();
  const close = async (force = false) => {
    if (!force && isDirty?.()) {
      const discard = await choose({ title: 'Discard changes?', options: [{ label: 'Discard changes', value: true, destructive: true }], cancel: 'Keep editing' });
      if (!discard) return false;
    }
    closeSheetNow();
    onClose?.();
    return true;
  };
  const header = h('header', { class: 'sheet-head' },
    action ? h('button', { class: 'text-btn', type: 'button', onClick: () => close() }, 'Cancel') : h('span'),
    h('h2', { class: 'sheet-title' }, title),
    action ?? h('button', { class: 'text-btn strong', type: 'button', onClick: () => close() }, 'Done'),
  );
  dialog.className = `sheet${wide ? ' wide' : ''}`;
  dialog.replaceChildren(header, h('div', { class: 'sheet-body' }, body));
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  dialog.onclick = (e) => {
    if (e.target === dialog) close();
  };
  activeSheet = { close };
  dialog.showModal();
  return { close, dialog };
}

function closeSheetNow() {
  const dialog = sheetEl();
  if (dialog.open) dialog.close();
  dialog.replaceChildren();
  activeSheet = null;
}

export const sheetOpen = () => sheetEl().open;
export const closeSheet = (force) => activeSheet?.close(force);

/** An action sheet. Resolves to the chosen option's value, or null. */
export function choose({ title, message, options, cancel = 'Cancel' }) {
  const dialog = document.getElementById('prompt');
  return new Promise((resolve) => {
    const done = (value) => {
      dialog.close();
      dialog.replaceChildren();
      resolve(value);
    };
    dialog.replaceChildren(
      h('div', { class: 'prompt-card' },
        title || message ? h('div', { class: 'prompt-text' }, title && h('h3', null, title), message && h('p', null, message)) : null,
        options.map((o) => h('button', { type: 'button', class: `prompt-btn${o.destructive ? ' destructive' : ''}`, onClick: () => done(o.value) }, o.label)),
      ),
      h('button', { type: 'button', class: 'prompt-btn cancel', onClick: () => done(null) }, cancel),
    );
    dialog.oncancel = (e) => {
      e.preventDefault();
      done(null);
    };
    dialog.onclick = (e) => {
      if (e.target === dialog) done(null);
    };
    dialog.showModal();
  });
}

// ---------------------------------------------------------------------------
// Toasts

let toastTimer;

export function toast(message, { actionLabel, onAction, timeout = 4500 } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  const hide = () => {
    el.classList.remove('show');
    toastTimer = setTimeout(() => el.matches?.(':popover-open') && el.hidePopover(), 250);
  };
  el.replaceChildren(
    h('span', null, message),
    actionLabel && h('button', { type: 'button', class: 'toast-action', onClick: () => { hide(); onAction(); } }, actionLabel),
  );
  // As a popover the toast joins the top layer, above any open sheet.
  if (el.showPopover) {
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover();
    } catch { /* popover unsupported: the fixed position still works */ }
  }
  requestAnimationFrame(() => el.classList.add('show'));
  toastTimer = setTimeout(hide, timeout);
}

// ---------------------------------------------------------------------------
// Files

/**
 * Hands a file to the user: the share sheet on phones (Save to Files,
 * AirDrop, Messages), a plain download elsewhere. False if they cancelled.
 */
export async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Opens the file picker. Resolves to a File, or null if cancelled. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'calendar';
}
