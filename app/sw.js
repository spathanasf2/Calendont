// Offline support: every app file is cached on install and served from the
// cache, so Calendont opens with no connection at all. `npm run stamp`
// rewrites the block below whenever app files change; a new VERSION is what
// tells browsers there is an update.

// <stamp>
const VERSION = 'dee2d8875e88';
const ASSETS = [
  './css/app.css',
  './css/themes.css',
  './fonts/JetBrainsMono-Bold-latin.woff2',
  './fonts/JetBrainsMono-Regular-latin.woff2',
  './fonts/OFL.txt',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './index.html',
  './js/app.js',
  './js/backup.js',
  './js/dates.js',
  './js/editor.js',
  './js/format.js',
  './js/ics.js',
  './js/model.js',
  './js/recurrence.js',
  './js/settings.js',
  './js/store.js',
  './js/transfer.js',
  './js/ui.js',
  './js/views/common.js',
  './js/views/list.js',
  './js/views/month.js',
  './js/views/timegrid.js',
  './js/views/year.js',
  './manifest.webmanifest',
];
// </stamp>

const CACHE = `calendont-${VERSION}`;

self.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, so a new version never caches old files.
  const requests = ['./', ...ASSETS].map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('calendont-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('./') : undefined);
    return cached ?? fetch(request);
  })());
});
