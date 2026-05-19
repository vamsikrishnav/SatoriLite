const CACHE_NAME = 'satorilite-v2';
const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/css/satori.css',
  '/js/app.js',
  '/lib/codemirror-bundle.js',
  '/lib/mermaid.esm.min.js',
  '/lib/mermaid.min.js',
  '/lib/katex/katex.min.js',
  '/lib/katex/katex-core.min.js',
  '/lib/katex/katex.min.css',
  '/manifest.json'
];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_FILES);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).then((fetchResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, fetchResponse.clone());
          return fetchResponse;
        });
      });
    }).catch(() => {
      // If both cache and network fail, return offline page (if we had one)
      return new Response('Offline', { status: 503 });
    })
  );
});
