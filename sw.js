/* ============================================================
   sw.js — Service Worker (PWA offline support)
   Strategy: stale-while-revalidate — serve cache instantly,
   update cache in background → next load gets fresh files.
   ============================================================ */

const CACHE_NAME = 'pos-v2.9';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './inventory.html',
  './sales.html',
  './settings.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/shared.js',
  './js/sync.js',
  './js/agents.js',
  './js/app.js',
  './js/barcode.js',
  './js/inventory.js',
  './js/sales.js',
  './js/promptpay.js',
  './js/printer.js',
  './js/settings.js',
  './reports.html',
  './js/reports.js',
  './customer-display.html',
  './warehouse.html',
  './js/warehouse.js',
  './icons/icon.svg',
];

/* External CDN libraries — cached normally via stale-while-revalidate */
const CACHE_CDNS = [
  'cdn.jsdelivr.net/npm/chart.js',
  'cdn.jsdelivr.net/npm/html2canvas',
];

/* External APIs — never cache */
const NO_CACHE_DOMAINS = [
  'generativelanguage.googleapis.com',
  'world.openfoodfacts.org',
  'api.anthropic.com',
  'cdn.sheetjs.com',
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'gstatic.com/firebasejs',
];

/* ---- Install: pre-cache all app files ---- */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(LOCAL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---- Activate: delete old caches, claim clients ---- */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---- Fetch: stale-while-revalidate ---- */
self.addEventListener('fetch', e => {
  const url = e.request.url;

  /* Pass API calls straight through, but still cache allowed CDNs */
  if (NO_CACHE_DOMAINS.some(d => url.includes(d)) &&
      !CACHE_CDNS.some(d => url.includes(d))) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(cached => {
        /* Always fetch from network in background and update cache */
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);

        /* Return cached instantly if available, else wait for network */
        return cached || networkFetch.then(res => res || cache.match('./index.html'));
      })
    )
  );
});
