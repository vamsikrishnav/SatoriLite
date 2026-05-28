const CACHE_NAME = 'satorilite-v23';
const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/satori.css',
  '/js/app.js',
  '/js/fs.js',
  '/js/vault-db.js',
  '/js/tree.js',
  '/js/editor.js',
  '/js/renderer.js',
  '/js/viewmode.js',
  '/js/search.js',
  '/js/themes.js',
  '/js/status-bar.js',
  '/js/resize.js',
  '/js/tabs.js',
  '/js/file-ops.js',
  '/js/link-complete.js',
  '/js/command-palette.js',
  '/js/sync-scroll.js',
  '/js/link-preview.js',
  '/js/live-preview.js',
  '/js/toc.js',
  '/js/backlinks.js',
  '/js/chat.js',
  '/js/ai-actions.js',
  '/lib/codemirror-bundle.js',
  '/lib/marked.js',
  '/lib/minisearch.js',
  '/lib/mermaid.esm.min.js',
  '/lib/mermaid.min.js',
  '/lib/katex/katex.min.js',
  '/lib/katex/katex-core.min.js',
  '/lib/katex/katex.min.css',
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

// Fetch: network-first for pages/JS/CSS, cache-first for fonts/libs
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isAsset = url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/lib/');

  if (isAsset) {
    // Cache-first for large static assets (fonts, third-party libs)
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((fetchResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      }).catch(() => new Response('Offline', { status: 503 }))
    );
  } else {
    // Network-first for app code (JS, CSS, HTML) — always get latest
    event.respondWith(
      fetch(event.request).then((fetchResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, fetchResponse.clone());
          return fetchResponse;
        });
      }).catch(() => {
        return caches.match(event.request).then((response) => {
          return response || new Response('Offline', { status: 503 });
        });
      })
    );
  }
});
