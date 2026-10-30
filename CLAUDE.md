# Calendont — notes for coding agents

A private, offline-first calendar PWA. Read README.md for what it does; this file is the
rules for changing it.

## Invariants

- **No dependencies, no build step.** `app/` is served exactly as committed. Don't add npm
  packages, bundlers, frameworks or CDN scripts. Tooling in `scripts/` uses Node built-ins only.
- **Nothing leaves the device.** No network calls, analytics, fonts or embeds from other
  origins. Data moves only when the user exports a file.
- **Run `npm run stamp` after any change under `app/`.** It rewrites the cache list and
  version in `app/sw.js`; `npm test` fails until you do. Forgetting it ships a stale offline copy.
- **Relative paths only** (`./js/app.js`, `icons/…`). The app is served from a subpath
  (`/Calendont/` on GitHub Pages) as well as from `/`.
- **Times are floating wall-clock times.** A wall time is a `Date` whose *UTC* fields hold the
  wall-clock values (see `app/js/dates.js`). Never use local-time getters (`getHours`,
  `getDate`) on them, and format with `timeZone: 'UTC'` (`app/js/format.js`). Only `.ics` import
  deals with real zones.
- **Data shapes live in `app/js/model.js`.** Everything read from storage or a file passes
  through its `clean*` functions. If you change a shape, keep reading the old one, and bump
  `BACKUP_VERSION` in `app/js/backup.js` only if older apps couldn't ignore the change.
- **Themes are tokens.** `app/css/app.css` only reads custom properties; `app/css/themes.css`
  sets them per `data-skin` / `data-mode` / `data-tty` on `<html>`. The theme list (ids, which
  follow light/dark, picker colours) is `SKINS` in `app/js/model.js`, and the inline script in
  `app/index.html` repeats the default so the first paint matches. New visual rules should use
  tokens rather than hard-coded colours, radii or fonts.
- **All writes go through `ctx.commit()`** in `app/js/app.js`, which handles undo, persistence
  and other open tabs.

## Checks

- `npm test`: unit tests for dates, recurrence, `.ics`, backups, and the service-worker stamp.
  Add tests for any logic change in those modules.
- UI changes: run `npm start` and look at the change at phone width (≈390px) and desktop
  width, in light and dark. Inputs stay ≥16px (iOS zooms smaller ones).

## Icons

`app/icons/*.png` are rendered from `app/icons/icon.svg` (180 apple-touch, full-bleed; 192
and 512 rounded; 512 maskable, full-bleed). Re-render them if the SVG changes.
