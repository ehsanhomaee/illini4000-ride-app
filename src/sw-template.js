/* Service worker: makes the app open with no signal.
   Built by vite.config.ts, which fills in the version and the file list. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = 'ride-day-' + VERSION;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('ride-day-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // backend, weather, Drive: straight to the network

  // Pages and config: use the network if it answers within 3.5 s (so updates show up),
  // otherwise the copy on the phone. One bar of signal should never mean a blank screen.
  if (req.mode === 'navigate' || url.pathname.endsWith('/config.json')) {
    const key = req.mode === 'navigate' ? './index.html' : req;
    const network = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    });
    const cached = caches.match(key).then(r => r || caches.match('./'));
    const timeout = new Promise(resolve => setTimeout(resolve, 3500));
    event.respondWith(
      Promise.race([network.catch(() => null), timeout.then(() => null)])
        .then(res => (res && res.ok ? res : cached.then(c => c || network))),
    );
    event.waitUntil(network.catch(() => {}));
    return;
  }

  // Everything else (scripts, styles, fonts, icons) never changes for a given name: phone copy first.
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })),
  );
});
