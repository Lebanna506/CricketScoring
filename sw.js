// Offline-first cache for the app shell. All match data lives in IndexedDB
// (see js/storage.js), not here - this only caches the static app files so
// the app itself keeps working with no network at all.

const CACHE_VERSION = 'cricket-scorer-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/model.js',
  './js/calc.js',
  './js/storage.js',
  './js/fileio.js',
  './js/ui/common.js',
  './js/ui/library.js',
  './js/ui/newMatch.js',
  './js/ui/scorer.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Network-first: always prefer the latest file when online (this app is
  // actively updated via git pull), only falling back to the cached copy
  // when there's genuinely no connection.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
