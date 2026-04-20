// Lumostage Production Schedule — Service Worker
// Strategy: network-first for data.json (always want fresh data),
//           cache-first for static assets (HTML, fonts, etc.)

const CACHE_NAME = 'lumostage-v1';
const DATA_CACHE  = 'lumostage-data-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap',
];

// ─── INSTALL: pre-cache static shell ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        // Non-fatal — fonts may fail in some environments
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: clean old caches ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // data.json — network first, fall back to cache
  if (url.pathname.endsWith('data.json')) {
    event.respondWith(networkFirstData(event.request));
    return;
  }

  // Google Fonts — cache first (they rarely change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, CACHE_NAME));
    return;
  }

  // Everything else — network first, fall back to cache
  event.respondWith(networkFirst(event.request, CACHE_NAME));
});

// ─── STRATEGIES ──────────────────────────────────────────

// Network first → cache → offline fallback
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Last resort: return the cached index.html for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline — no cached version available.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Network first for data.json, with stale data message
async function networkFirstData(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request.url.split('?')[0], response.clone()); // strip cache-bust param
    }
    return response;
  } catch {
    // Try cached version (strip cache-bust param from lookup)
    const cached = await caches.match(request.url.split('?')[0]);
    if (cached) {
      // Inject a header so the app knows data may be stale
      const body = await cached.text();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Lumostage-Cached': 'true'
        }
      });
    }
    return new Response(JSON.stringify({
      error: 'offline',
      productions: [],
      updated: 'Offline — no cached data'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Cache first → network (for stable assets)
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Asset unavailable offline.', { status: 503 });
  }
}
