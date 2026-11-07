// Sierra Leone Connect service worker — bump VERSION on every deploy.
const VERSION = 'slc-v1.4.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css?v=1.4.0', './js/app.js?v=1.4.0',
  './js/config.js', './js/util.js', './js/constants.js', './js/match.js', './js/icons.js', './js/geo.js', './js/geo-data.js',
  './js/data/index.js', './js/data/demo.js', './js/data/seed.js', './js/data/supabase.js', './js/vendor/supabase-2.49.4.js',
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
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  // HTML: network first so new deploys show immediately.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put('./index.html', c)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  // Static: stale-while-revalidate.
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
