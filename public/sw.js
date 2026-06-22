// MetricPOS Aduanera Service Worker — v7.3-aduanera-3
// IMPORTANTE: app.js e index.html (/) NUNCA se cachean aquí.
// El servidor ya envía Cache-Control: no-store para esos archivos,
// y cachearlos en el Service Worker anula esa protección porque el SW
// responde "cache-first" antes de tocar la red. Solo se cachean assets
// verdaderamente estáticos (CSS, iconos) que casi nunca cambian.
const CACHE = 'metricpos-v7.3-aduanera-3';
const ASSETS = ['/styles.css'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Permite que el HTML fuerce la activación inmediata del SW nuevo
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;

  const url = new URL(e.request.url);

  // app.js, index.html (/), sw.js y manifest.json: SIEMPRE van directo a la red.
  // Nunca se sirven desde el caché del Service Worker.
  const esCriticoNoCachear =
    url.pathname === '/' ||
    url.pathname === '/app.js' ||
    url.pathname === '/sw.js' ||
    url.pathname === '/manifest.json';

  if (esCriticoNoCachear) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Para el resto (CSS, iconos): network-first con fallback a caché si no hay red
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
