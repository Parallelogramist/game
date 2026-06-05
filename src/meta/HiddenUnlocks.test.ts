import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so the manager round-trips without
// touching crypto/localStorage. Same specifier ('../storage/SecureStorage') as the
// production import, so Vitest swaps the real module for this one.
vi.mock('../storage/SecureStorage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

import { SecureStorage } from '../storage/SecureStorage';
import {
  HIDDEN_UNLOCKS,
  HiddenUnlockManager,
  type HiddenUnlockCondition,
  type UnlockEvaluationContext,
} from './HiddenUnlocks';
import type { LifetimeStats } from '../achievements/AchievementTypes';

const STORAGE_KEY = 'hiddenUnlocksV1';

function makeLifetime(overrides: Partial<LifetimeStats> = {}): LifetimeStats {
  return {
    totalKills: 0,
    totalDamageDealt: 0,
    totalCriticalHits: 0,
    totalTimePlayedSeconds: 0,
    totalRunsStarted: 0,
    totalRunsCompleted: 0,
    totalVictories: 0,
    totalBossesKilled: 0,
    totalGoldEarned: 0,
    highestLevel: 0,
    highestWorldLevel: 0,
    longestSurvivalSeconds: 0,
    fastestVictorySeconds: 0,
    perfectRuns: 0,
    speedRuns: 0,
    mostKillsInRun: 0,
    highestComboInRun: 0,
    ...overrides,
  };
}

function makeContext(
  overrides: {
    run?: Partial<UnlockEvaluationContext['run']>;
    lifetime?: Partial<LifetimeStats>;
  } = {},
): UnlockEvaluationContext {
  return {
    run: {
      wasVictory: false,
      killCount: 0,
      levelReached: 1,
      survivalTimeSeconds: 600, // long enough to avoid the under-8-min speed unlock by default
      highestCombo: 0,
      damageTaken: 0,
      damageDealt: 0,
      weaponIdsUsed: [],
      worldLevel: 1,
      noDamageTaken: false,
      winStreak: 0,
      ...overrides.run,
    },
    lifetime: makeLifetime(overrides.lifetime),
  };
}

function conditionById(id: string): HiddenUnlockCondition {
  const condition = HIDDEN_UNLOCKS.find((candidate) => candidate.id === id);
  if (!condition) throw new Error(`unlock condition not found: ${id}`);
  return condition;
}

describe('unlock_streaker — "Win 5 runs in a row"', () => {
  const predicate = (context: UnlockEvaluationContext) =>
    conditionById('unlock_streaker').predicate(context);

  test('fires on a victory that completes a 5-win streak', () => {
    expect(predicate(makeContext({ run: { wasVictory: true, winStreak: 5 } }))).toBe(true);
  });

  test('does not fire at a 4-win streak (off-by-one guard)', () => {
    expect(predicate(makeContext({ run: { wasVictory: true, winStreak: 4 } }))).toBe(false);
  });

  test('still satisfied by streaks longer than 5', () => {
    expect(predicate(makeContext({ run: { wasVictory: true, winStreak: 9 } }))).toBe(true);
  });

  test('does not fire on a loss even if a streak value leaks through', () => {
    expect(predicate(makeContext({ run: { wasVictory: false, winStreak: 7 } }))).toBe(false);
  });

  test('is NOT earned by total lifetime victories alone (regression on the old %5 bug)', () => {
    // The old predicate unlocked on totalVictories % 5 === 0 — i.e. 5 wins ever,
    // not 5 in a row. A scattered set of wins (streak reset between them) must not
    // earn the streak cosmetic.
    expect(
      predicate(makeContext({ run: { wasVictory: true, winStreak: 1 }, lifetime: { totalVictories: 10 } })),
    ).toBe(false);
  });
});

describe('HiddenUnlockManager.evaluatePostRun', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('unlocks the streak-flame cosmetic on a qualifying 5-win victory', () => {
    const manager = new HiddenUnlockManager();
    const newly = manager.evaluatePostRun(makeContext({ run: { wasVictory: true, winStreak: 5 } }));
    expect(newly.map((condition) => condition.id)).toContain('unlock_streaker');
    expect(manager.isUnlocked('cosmetic_streak_flame')).toBe(true);
  });

  test('does not unlock streak flame below the threshold', () => {
    const manager = new HiddenUnlockManager();
    manager.evaluatePostRun(makeContext({ run: { wasVictory: true, winStreak: 3 } }));
    expect(manager.isUnlocked('cosmetic_streak_flame')).toBe(false);
  });

  test('fires each unlock only once (dedupe across runs)', () => {
    const manager = new HiddenUnlockManager();
    const first = manager.evaluatePostRun(makeContext({ run: { wasVictory: true, winStreak: 5 } }));
    expect(first.map((condition) => condition.id)).toContain('unlock_streaker');
    const second = manager.evaluatePostRun(makeContext({ run: { wasVictory: true, winStreak: 6 } }));
    expect(second.map((condition) => condition.id)).not.toContain('unlock_streaker');
  });

  test('invokes the new-unlock callback for each newly earned condition', () => {
    const manager = new HiddenUnlockManager();
    const seen: string[] = [];
    manager.setOnNewUnlock((condition) => seen.push(condition.id));
    manager.evaluatePostRun(makeContext({ run: { wasVictory: true, winStreak: 5 } }));
    expect(seen).toContain('unlock_streaker');
  });

  test('first-survivor unlock fires once a run is completed', () => {
    const manager = new HiddenUnlockManager();
    const newly = manager.evaluatePostRun(makeContext({ lifetime: { totalRunsCompleted: 1 } }));
    expect(newly.map((condition) => condition.id)).toContain('unlock_first_survivor');
  });

  test('combo-king unlock respects its 100-combo threshold', () => {
    const below = new HiddenUnlockManager();
    below.evaluatePostRun(makeContext({ run: { highestCombo: 99 } }));
    expect(below.isUnlocked('cosmetic_inferno_trail')).toBe(false);

    SecureStorage.removeItem(STORAGE_KEY);
    const at = new HiddenUnlockManager();
    at.evaluatePostRun(makeContext({ run: { highestCombo: 100 } }));
    expect(at.isUnlocked('cosmetic_inferno_trail')).toBe(true);
  });
});

describe('HiddenUnlockManager.getTopProgress', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('excludes boolean-only unlocks like the streaker (no progress metric)', () => {
    const manager = new HiddenUnlockManager();
    const entries = manager.getTopProgress(
      makeContext({ run: { wasVictory: true, winStreak: 4, killCount: 10 } }),
      20,
    );
    expect(entries.map((entry) => entry.condition.id)).not.toContain('unlock_streaker');
  });

  test('sorts by progress ratio descending and respects the limit', () => {
    const manager = new HiddenUnlockManager();
    // killCount 750/1500 = 0.5 (annihilator); highestCombo 50/100 = 0.5 (combo_king);
    // levelReached 5/5 already unlocked elsewhere — use values giving distinct ratios.
    const entries = manager.getTopProgress(
      makeContext({ run: { killCount: 1500, highestCombo: 50 } }),
      2,
    );
    expect(entries.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].ratio).toBeGreaterThanOrEqual(entries[i].ratio);
    }
  });

  test('skips zero-progress entries', () => {
    const manager = new HiddenUnlockManager();
    const entries = manager.getTopProgress(makeContext(), 20);
    for (const entry of entries) {
      expect(entry.ratio).toBeGreaterThan(0);
    }
  });
});
