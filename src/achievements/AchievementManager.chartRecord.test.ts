import { describe, test, expect, beforeEach } from 'vitest';

// Same in-memory stand-in for encrypted storage as AchievementManager.corruption.test.ts:
// the specifier matches the production import, so Vitest swaps the real module for this one.
import { vi } from 'vitest';
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import { AchievementManager } from './AchievementManager';

const STORAGE_KEY = 'survivor-achievements';

// The mocked store is module-level, so a manager built in one test would otherwise load the
// previous test's persisted payload.
beforeEach(() => {
  SecureStorage.removeItem(STORAGE_KEY);
});

describe('AchievementManager.recordWorldCompletionPercent', () => {
  test('keeps the highest percent the profile has ever charted', () => {
    const manager = new AchievementManager();
    manager.recordWorldCompletionPercent(34);
    manager.recordWorldCompletionPercent(78);
    expect(manager.getLifetimeStats().bestWorldCompletionPercent).toBe(78);
  });

  test('survives the season re-roll that drops the live chart to nothing', () => {
    const manager = new AchievementManager();
    manager.recordWorldCompletionPercent(78);
    manager.recordWorldCompletionPercent(0);
    expect(manager.getLifetimeStats().bestWorldCompletionPercent).toBe(78);
  });

  test('refuses junk and cannot record more than a full chart', () => {
    const manager = new AchievementManager();
    manager.recordWorldCompletionPercent(Number.NaN);
    expect(manager.getLifetimeStats().bestWorldCompletionPercent).toBe(0);
    manager.recordWorldCompletionPercent(140);
    expect(manager.getLifetimeStats().bestWorldCompletionPercent).toBe(100);
  });
});
