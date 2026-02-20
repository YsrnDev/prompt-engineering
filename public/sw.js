const CACHE_VERSION = 'v1';
const CACHE_NAME = `prompt-architect-shell-${CACHE_VERSION}`;
const APP_SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/pwa-192.png',
  '/icons/pwa-512.png',
  '/icons/pwa-maskable-192.png',
  '/icons/pwa-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        APP_SHELL_ASSETS.map(async (assetUrl) => {
          const response = await fetch(assetUrl, { cache: 'reload' });
          if (response.ok) {
            await cache.put(assetUrl, response);
          }
        })
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('prompt-architect-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

const isCacheableRequest = (request) => {
  if (request.method !== 'GET') {
    return false;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return false;
  }

  if (url.pathname.startsWith('/api/')) {
    return false;
  }

  return true;
};

const putInCache = async (request, response) => {
  if (!response || !response.ok) {
    return;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
};

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (!isCacheableRequest(request)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          void putInCache(request, response);
          return response;
        })
        .catch(async () => {
          const cachedPage =
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match('/'));
          return cachedPage || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      const networkResponsePromise = fetch(request)
        .then((networkResponse) => {
          void putInCache(request, networkResponse);
          return networkResponse;
        })
        .catch(() => undefined);

      return cachedResponse || networkResponsePromise || Response.error();
    })
  );
});
