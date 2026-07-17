/**
 * Self-destruct service worker — emitted as dist/sw.js instead of the real
 * worker by `PWA_KILL=1 npm run build`. Deploying this is the kill switch: a
 * worker can only be removed by a newer worker that unregisters itself, and
 * browsers always revalidate the worker script, so this lands within 24h.
 * It registers no fetch handler, so nothing is served from cache while it runs.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.registration.unregister();

      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.navigate(client.url);
    })()
  );
});
