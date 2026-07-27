import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so save/read round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one.
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

import { SecureStorage } from '../storage';
import { getPaceGhost, savePaceGhost, paceDeltaKills } from './PaceGhostManager';

const STORAGE_KEY = 'survivor-pace-ghost';

describe('PaceGhostManager', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('no ghost means no delta', () => {
    expect(paceDeltaKills(null, 60, 100)).toBeNull();
    expect(paceDeltaKills([], 60, 100)).toBeNull();
  });

  test('before the first sample there is nothing to compare against', () => {
    expect(paceDeltaKills([10, 20], 14.9, 40)).toBeNull();
  });

  test('on a sample boundary the delta is kills minus that sample', () => {
    expect(paceDeltaKills([10, 20, 30], 30, 26)).toBe(6);
  });

  test('between samples the ghost is linearly interpolated', () => {
    // 22.5 s sits halfway between sample 0 (15 s, 10 kills) and sample 1 (30 s, 20).
    expect(paceDeltaKills([10, 20], 22.5, 20)).toBe(5);
  });

  test('past the end of the recorded curve the delta goes quiet', () => {
    expect(paceDeltaKills([10, 20], 30, 25)).toBe(5);
    expect(paceDeltaKills([10, 20], 30.1, 25)).toBeNull();
  });

  test('a saved curve round-trips per world level', () => {
    savePaceGhost(3, [5, 9, 14]);
    expect(getPaceGhost(3)).toEqual([5, 9, 14]);
    expect(getPaceGhost(4)).toBeNull();
  });

  test('a corrupt payload reads as no ghost instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, 'null');
    expect(() => getPaceGhost(1)).not.toThrow();
    expect(getPaceGhost(1)).toBeNull();

    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ '1': [5, 'nine'], '2': [1, 2] }));
    expect(getPaceGhost(1)).toBeNull();
    expect(getPaceGhost(2)).toEqual([1, 2]);
  });
});
