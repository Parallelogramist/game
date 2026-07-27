import { describe, test, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// In-memory stand-in for the encrypted storage, same specifier ('../storage')
// as the production import — mirrors PaceGhostManager.test.ts.
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
import {
  BOSS_ROTATION,
  advanceBossRotation,
  bossIdAtRotation,
  challengeBossRotationIndex,
  getBossRotationIndex,
  getUpcomingBossId,
} from './BossRotationManager';

const STORAGE_KEY = 'survivor-boss-rotation';

describe('BossRotationManager', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('a fresh profile starts at the head of the order', () => {
    expect(BOSS_ROTATION.length).toBeGreaterThan(1);
    expect(getBossRotationIndex()).toBe(0);
    expect(getUpcomingBossId()).toBe(BOSS_ROTATION[0]);
  });

  test('advancing walks the whole order and wraps back to the head', () => {
    const seen: string[] = [];
    for (let step = 0; step < BOSS_ROTATION.length; step++) {
      seen.push(getUpcomingBossId());
      advanceBossRotation();
    }
    expect(seen).toEqual([...BOSS_ROTATION]);
    expect(getUpcomingBossId()).toBe(BOSS_ROTATION[0]);
  });

  test('the advance is persisted, not held in memory', () => {
    advanceBossRotation();
    expect(SecureStorage.getItem(STORAGE_KEY)).toBe('1');
    expect(getBossRotationIndex()).toBe(1);
  });

  test('a corrupt or out-of-range stored index still names a real boss', () => {
    for (const junk of ['"nope"', '-3', 'null', '{}', 'not json', String(BOSS_ROTATION.length + 5)]) {
      SecureStorage.setItem(STORAGE_KEY, junk);
      expect(BOSS_ROTATION).toContain(getUpcomingBossId());
    }
  });

  test('a cursor past the end wraps instead of reading off the array', () => {
    expect(bossIdAtRotation(BOSS_ROTATION.length)).toBe(BOSS_ROTATION[0]);
    expect(bossIdAtRotation(BOSS_ROTATION.length + 1)).toBe(BOSS_ROTATION[1]);
  });

  test('a challenge boss is fixed by its date and varies across dates', () => {
    expect(challengeBossRotationIndex('2026-07-27')).toBe(challengeBossRotationIndex('2026-07-27'));
    const dates = Array.from({ length: 14 }, (_, day) => `2026-07-${String(day + 1).padStart(2, '0')}`);
    const picks = new Set(dates.map((date) => challengeBossRotationIndex(date)));
    expect(picks.size).toBeGreaterThan(1);
    for (const index of picks) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(BOSS_ROTATION.length);
    }
  });
});
