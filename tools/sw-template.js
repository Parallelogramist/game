/**
 * Service worker template — dist/sw.js is generated from this file by the
 * pwa-service-worker plugin in vite.config.ts, which substitutes __BUILD_ID__
 * and __PRECACHE_URLS__. This file is never served as-is.
 */

const BUILD_ID = '__BUILD_ID__';
const PRECACHE_URLS = __PRECACHE_URLS__;

const PRECACHE_NAME = `precache-${BUILD_ID}`;

// Tracker modules never change between builds and are the bulk of the payload,
// so the music cache is deliberately unversioned and survives deploys.
const MUSIC_CACHE_NAME = 'music-v1';

// A flaky network must fall back to cache rather than hang the launch — that
// blip is the whole reason this worker exists.
const NAVIGATION_TIMEOUT_MS = 3000;

const PRECACHE_PATHS = new Set(PRECACHE_URLS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== PRECACHE_NAME && name !== MUSIC_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), timeoutMs);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Network-first: an online launch always gets the newest deploy's index.html,
 * which names the newest hashed bundles. This is what stops a bad build pinning
 * players to a stale shell, and it is why no in-page update prompt is needed.
 */
async function handleNavigation(request) {
  try {
    return await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
  } catch (error) {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    throw error;
  }
}

async function handleMusic(request) {
  const cache = await caches.open(MUSIC_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function handlePrecached(request) {
  const cached = await caches.match(request);
  return cached || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
  } else if (url.pathname.startsWith('/music/')) {
    event.respondWith(handleMusic(request));
  } else if (PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(handlePrecached(request));
  }
});
