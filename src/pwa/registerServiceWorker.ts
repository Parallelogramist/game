/**
 * The worker only exists in a production build (vite.config.ts generates it
 * into dist/), so registering in dev would 404 — and, worse, leave a stale
 * worker registered against localhost.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((error) => {
      console.warn('[pwa] service worker registration failed', error);
    });
  };

  // main.ts calls this from an async bootstrap, so `load` may already have
  // fired by now — waiting for an event that is never coming would silently
  // skip registration forever.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
