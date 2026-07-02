import { describe, test, expect } from 'vitest';
import { ALL_STORAGE_KEYS } from './StorageBootstrap';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-file consistency: every SecureStorage key a manager declares (the
// `STORAGE_KEY` / `STORAGE_KEY_*` naming convention used throughout src/) must
// be pre-loaded by initializeStorage(), or it silently reads back as null on
// every fresh page load (see the comment on ALL_STORAGE_KEYS) even though it
// writes fine. Source-scan every non-test file for the convention instead of
// hand-maintaining a mirror list, so a newly added manager can't slip through.
// ─────────────────────────────────────────────────────────────────────────────

const sourceModules = import.meta.glob<string>(
  ['../**/*.ts', '!../**/*.test.ts', '!../**/*.d.ts'],
  { query: '?raw', import: 'default', eager: true }
);

const declaredKeys = new Set(
  Object.values(sourceModules).flatMap((source) =>
    [...source.matchAll(/const STORAGE_KEY[A-Z_]*\s*=\s*'([^']+)'/g)].map((match) => match[1])
  )
);

describe('SecureStorage key registration', () => {
  // Guards the extraction itself: if the STORAGE_KEY naming convention is
  // abandoned, the set-equality tests below would pass vacuously.
  test('source scan finds a plausible number of declared keys', () => {
    expect(declaredKeys.size).toBeGreaterThan(20);
  });

  test('every key a manager declares is pre-loaded by initializeStorage', () => {
    const unregistered = [...declaredKeys].filter((key) => !ALL_STORAGE_KEYS.includes(key));
    expect(unregistered, 'these keys read back as null on every fresh page load').toEqual([]);
  });

  test('every pre-loaded key is still declared by some manager', () => {
    const orphaned = ALL_STORAGE_KEYS.filter((key) => !declaredKeys.has(key));
    expect(orphaned, 'stale entries in ALL_STORAGE_KEYS — dead, but harmless').toEqual([]);
  });

  test('no duplicate keys in the pre-load list', () => {
    const seen = new Set<string>();
    const duplicates = ALL_STORAGE_KEYS.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
    expect(duplicates).toEqual([]);
  });
});
