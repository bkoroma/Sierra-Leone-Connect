// Sierra Leone Connect service worker — bump VERSION on every deploy.
const VERSION = 'slc-v1.6.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css?v=1.6.0', './js/app.js?v=1.6.0',
  './js/config.js', './js/util.js', './js/constants.js', './js/match.js', './js/icons.js', './js/geo.js', './js/geo-data.js',
  './js/errors.js', './css/fonts.css', './fonts/dm-sans-latin-wght-normal.woff2', './fonts/sora-latin-wght-normal.woff2', './js/data/index.js', './js/data/demo.js', './js/data/seed.js', './js/data/supabase.js', './js/vendor/supabase-2.49.4.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Never cache API, auth, storage or staff consoles.
  if (url.hostname.endsWith('supabase.co') || /admin\.html$/.test(url.pathname)) return;
  if (url.origin !== location.origin) return; // never cache API calls or other sites
  // HTML: network first so new deploys show immediately. Each page is cached under its own URL
  // (previously every page overwrote index.html, so a visit to privacy.html could become the offline app shell).
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(/\/(index\.html)?$/.test(url.pathname) ? './index.html' : req, c)); }
      return r;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  // Self-hosted fonts never change: cache first.
  if (url.pathname.includes('/fonts/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; })));
    return;
  }
  // App files: network first, cache only when offline. Modules import each other without version strings,
  // so serving a stale cached copy next to a fresh one could break the app after a deploy.
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: /\.(js|css)$/.test(url.pathname) })));
});
