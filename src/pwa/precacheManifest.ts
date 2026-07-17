/**
 * The service worker's precache list is derived from the built `dist/` tree at
 * build time (see the pwa-service-worker plugin in vite.config.ts), because the
 * list has to name Vite's content-hashed filenames. This module is the pure
 * selection rule, split out so it is testable without running a build.
 */

/**
 * `/sw.js` must never be precached — a worker that serves itself from its own
 * cache can never be replaced, which would make every deploy, and the kill
 * switch itself, permanently unreachable. `/CNAME` is GitHub Pages config, not
 * an app file.
 */
const PRECACHE_EXCLUDED_PATHS = new Set(['/sw.js', '/CNAME']);

/**
 * 2.1 MB of tracker modules a player may never hear; runtime-cached on first
 * play by the worker's music strategy instead of tripling the install cost.
 */
const PRECACHE_EXCLUDED_PREFIXES = ['/music/'];

/**
 * @param distUrls root-relative URLs of every file in `dist/`, e.g. `/index.html`.
 * @returns the URLs to precache, sorted so the generated build id is stable
 *          across machines (an unstable id would rename the cache on every
 *          build and re-download the shell for no reason).
 */
export function selectPrecacheUrls(distUrls: readonly string[]): string[] {
  const selected = distUrls.filter(
    (url) =>
      !PRECACHE_EXCLUDED_PATHS.has(url) &&
      !PRECACHE_EXCLUDED_PREFIXES.some((prefix) => url.startsWith(prefix))
  );
  return [...new Set(selected)].sort();
}
