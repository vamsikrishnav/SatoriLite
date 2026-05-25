const CACHE_NAME = 'satorilite-v11';
const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/satori.css',
  '/fonts/Satoshi-Regular.woff2',
  '/fonts/Satoshi-Italic.woff2',
  '/fonts/Satoshi-Medium.woff2',
  '/fonts/Satoshi-MediumItalic.woff2',
  '/fonts/Satoshi-Bold.woff2',
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
