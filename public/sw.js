// =============================================================
// Wiramart UNPERBA — PWA Service Worker (WebAPK Installability)
// Network-first strategy: menjamin harga, stok & sesi real-time,
// sekaligus memenuhi syarat wajib Chrome Android WebAPK Install.
// =============================================================

const CACHE_NAME = 'wiramart-pwa-v1';
const STATIC_ASSETS = [
  '/icon.png',
  '/icon-512.png',
  '/apple-icon.png',
  '/logo.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Jangan pernah meng-cache endpoint API atau rute autentikasi
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    return;
  }

  // Untuk aset ikon statis: network-first dengan fallback cache
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
  }
});
