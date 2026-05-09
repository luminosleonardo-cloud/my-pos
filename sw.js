/* ============================================================
   sw.js — Service Worker (PWA offline support)
   Bump CACHE_NAME version whenever you deploy new files.
   ============================================================ */

const CACHE_NAME = 'pos-v1';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './inventory.html',
  './sales.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/shared.js',
  './js/app.js',
  './js/inventory.js',
  './js/sales.js',
  './js/promptpay.js',
  './js/printer.js',
  './icons/icon.svg',
];

/* External APIs — never cache */
const NO_CACHE_DOMAINS = [
  'generativelanguage.googleapis.com',
  'world.openfoodfacts.org',
];

/* ---- Install: pre-cache all app files ---- */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(LOCAL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---- Activate: delete old caches ---- */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---- Fetch: cache-first for local, network-only for APIs ---- */
self.addEventListener('fetch', e => {
  const url = e.request.url;

  /* Pass API calls straight through */
  if (NO_CACHE_DOMAINS.some(d => url.includes(d))) return;

  /* Cache CDN scripts on first load, serve from cache after */
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request)
        .then(res => {
          if (res.ok && e.request.method === 'GET') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          /* Offline fallback: any navigation → index.html */
          if (e.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
