import { describe, test, expect } from 'vitest';
import { selectPrecacheUrls } from './precacheManifest';

const DIST_URLS = [
  '/index.html',
  '/assets/index-BavHZM2r.js',
  '/assets/phaser-0YPJO2g1.js',
  '/favicon.svg',
  '/legal.html',
  '/manifest.webmanifest',
  '/icons/game-icons.png',
  '/lib/IBXM.js',
  '/sfx/hit.ogg',
  '/fonts/rajdhani-700.woff2',
  '/music/razor-quake3.xm',
  '/CNAME',
  '/sw.js',
];

describe('selectPrecacheUrls', () => {
  // A worker served from its own cache can never be replaced — this would make
  // every future deploy, and the kill switch, permanently unreachable.
  test('never precaches the worker itself', () => {
    expect(selectPrecacheUrls(DIST_URLS)).not.toContain('/sw.js');
  });

  test('excludes music, which is runtime-cached on first play', () => {
    const urls = selectPrecacheUrls(DIST_URLS);
    expect(urls.some((url) => url.startsWith('/music/'))).toBe(false);
  });

  test('excludes GitHub Pages config', () => {
    expect(selectPrecacheUrls(DIST_URLS)).not.toContain('/CNAME');
  });

  test('precaches the app shell, hashed bundles, fonts and icons', () => {
    expect(selectPrecacheUrls(DIST_URLS)).toEqual(
      expect.arrayContaining([
        '/index.html',
        '/assets/index-BavHZM2r.js',
        '/assets/phaser-0YPJO2g1.js',
        '/manifest.webmanifest',
        '/fonts/rajdhani-700.woff2',
        '/icons/game-icons.png',
        '/lib/IBXM.js',
        '/sfx/hit.ogg',
      ])
    );
  });

  // The build id hashes this list, so an unstable order would rename the cache
  // on every build and re-download the whole shell for no reason.
  test('is sorted and order-independent', () => {
    const forward = selectPrecacheUrls(DIST_URLS);
    const reversed = selectPrecacheUrls([...DIST_URLS].reverse());
    expect(forward).toEqual(reversed);
    expect(forward).toEqual([...forward].sort());
  });
});
