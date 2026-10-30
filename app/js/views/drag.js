// Moving and resizing events by hand in the day and week grids: drag with a
// mouse, or press and hold then drag on a touch screen. Grab the bottom edge
// to change the length. Times snap to 15 minutes; nothing saves until you let
// go, and Escape (or a cancelled prompt) puts it back.

import { addMinutes } from '../dates.js';
import * as f from '../format.js';

const SNAP = 15;
const HOLD_MS = 350; // a touch must rest this long before it picks an event up
const EDGE_PX = 44; // dragging this close to the top or bottom scrolls the grid

// A drag ends with a click on whatever is under the pointer; swallow that one
// click (it follows within a few milliseconds), but nothing the user does next.
let quietUntil = 0;
document.addEventListener('click', (e) => {
  if (Date.now() < quietUntil) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

/**
 * Lets `block` (showing occurrence `o` in column `index`) be dragged.
 * `grid`: { hour (px), columns (elements), days (Dates), scroller, drop(start, end), cancel() }.
 */
export function makeDraggable(block, o, index, grid) {
  let s = null; // the drag in progress

  const toContentY = (clientY) => clientY - grid.scroller.getBoundingClientRect().top + grid.scroller.scrollTop;

  function begin(x, y, mode) {
    s = { mode, y0: toContentY(y), startY: y, x, y, day: index, minutes: 0, raf: 0 };
    block.classList.add('dragging');
    document.body.classList.add('dragging-event');
    s.raf = requestAnimationFrame(edgeScroll);
  }

  function update(x, y) {
    s.x = x;
    s.y = y;
    s.minutes = Math.round(((toContentY(y) - s.y0) / grid.hour) * 60 / SNAP) * SNAP;
    if (s.mode === 'move') {
      const col = grid.columns.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return x >= r.left && x < r.right;
      });
      if (col >= 0) s.day = col;
    }
    draw();
  }

  function result() {
    if (s.mode === 'resize') {
      const end = addMinutes(o.end, s.minutes);
      return { start: o.start, end: end - o.start < SNAP * 60_000 ? addMinutes(o.start, SNAP) : end };
    }
    const shift = (s.day - index) * 1440 + s.minutes;
    return { start: addMinutes(o.start, shift), end: addMinutes(o.end, shift) };
  }

  function draw() {
    const { start, end } = result();
    const column = grid.columns[s.day];
    if (block.parentElement !== column) column.append(block);
    const dayStart = grid.days[s.day];
    const top = Math.min(1440 - SNAP, Math.max(0, (start - dayStart) / 60_000));
    const bottom = Math.min(1440, Math.max(top + SNAP, (end - dayStart) / 60_000));
    block.style.setProperty('--top', top);
    block.style.setProperty('--len', bottom - top);
    block.style.setProperty('--col', 0);
    block.style.setProperty('--cols', 1);
    const time = block.querySelector('.tg-event-time');
    if (time) time.textContent = `${f.time(start)} – ${f.time(end)}`;
  }

  // Dragged toward the top or bottom edge, keep scrolling so far-off times are
  // reachable. Only toward: an event that starts near an edge stays put.
  function edgeScroll() {
    if (!s) return;
    const r = grid.scroller.getBoundingClientRect();
    const up = s.y < r.top + EDGE_PX && s.y < s.startY - 8;
    const down = s.y > r.bottom - EDGE_PX && s.y > s.startY + 8;
    const dy = up ? -10 : down ? 10 : 0;
    if (dy) {
      grid.scroller.scrollTop += dy;
      update(s.x, s.y);
    }
    s.raf = requestAnimationFrame(edgeScroll);
  }

  async function finish(keep) {
    const moved = s && (s.minutes || s.day !== index);
    const { start, end } = s ? result() : {};
    if (s) cancelAnimationFrame(s.raf);
    s = null;
    block.classList.remove('dragging');
    document.body.classList.remove('dragging-event');
    quietUntil = Date.now() + 80;
    if (keep && moved && (await grid.drop(start, end))) return;
    grid.cancel(); // redraw from saved data: puts the block back
  }

  // ---- mouse and pen
  block.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const mode = e.clientY > block.getBoundingClientRect().bottom - 7 ? 'resize' : 'move';
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev) => {
      if (!s) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        begin(x0, y0, mode);
      }
      ev.preventDefault();
      update(ev.clientX, ev.clientY);
    };
    const stop = (keep) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', esc, true);
      if (s) finish(keep);
    };
    const up = () => stop(true);
    const esc = (ev) => {
      if (ev.key !== 'Escape' || !s) return;
      ev.stopPropagation();
      stop(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', esc, true);
  });

  // ---- touch: hold still to pick up, then drag; moving first is a scroll
  block.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const mode = t.clientY > block.getBoundingClientRect().bottom - 12 ? 'resize' : 'move';
    const x0 = t.clientX;
    const y0 = t.clientY;
    const hold = setTimeout(() => {
      begin(x0, y0, mode);
      navigator.vibrate?.(8);
    }, HOLD_MS);
    const move = (ev) => {
      const p = ev.touches[0];
      if (!s) {
        if (Math.hypot(p.clientX - x0, p.clientY - y0) > 8) stop(false);
        return;
      }
      ev.preventDefault(); // we own this gesture now: no scrolling
      update(p.clientX, p.clientY);
    };
    const stop = (keep) => {
      clearTimeout(hold);
      block.removeEventListener('touchmove', move);
      block.removeEventListener('touchend', end);
      block.removeEventListener('touchcancel', cancel);
      if (s) finish(keep);
    };
    const end = () => stop(true);
    const cancel = () => stop(false);
    block.addEventListener('touchmove', move, { passive: false });
    block.addEventListener('touchend', end);
    block.addEventListener('touchcancel', cancel);
  }, { passive: true });
}
