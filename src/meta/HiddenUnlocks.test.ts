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
  orderVaultEntries,
  type HiddenUnlockCondition,
  type UnlockEvaluationContext,
} from './HiddenUnlocks';
import type { LifetimeStats } from '../achievements/AchievementTypes';
import { LORE_FRAGMENTS } from '../data/LoreFragments';

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
    secretsFoundTotal: 0,
    hiddenSectorsFoundTotal: 0,
    loreFragmentsFound: 0,
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

describe('orderVaultEntries — unlock vault ordering', () => {
  test('earned entries come first, newest first, then locked in definition order', () => {
    const firstId = HIDDEN_UNLOCKS[0].id;
    const thirdId = HIDDEN_UNLOCKS[2].id;
    const ordered = orderVaultEntries({
      [firstId]: { unlockedAt: 1000 },
      [thirdId]: { unlockedAt: 5000 },
    });

    expect(ordered).toHaveLength(HIDDEN_UNLOCKS.length);
    expect(ordered[0].condition.id).toBe(thirdId);
    expect(ordered[0].unlockedAt).toBe(5000);
    expect(ordered[1].condition.id).toBe(firstId);
    expect(ordered.slice(2).every((entry) => entry.unlockedAt === null)).toBe(true);
    // Locked tail keeps definition order.
    const lockedIds = ordered.slice(2).map((entry) => entry.condition.id);
    const expectedLockedIds = HIDDEN_UNLOCKS
      .map((condition) => condition.id)
      .filter((id) => id !== firstId && id !== thirdId);
    expect(lockedIds).toEqual(expectedLockedIds);
  });

  test('a saved id for a retired condition is ignored, not rendered', () => {
    const ordered = orderVaultEntries({ unlock_no_longer_exists: { unlockedAt: 9000 } });
    expect(ordered).toHaveLength(HIDDEN_UNLOCKS.length);
    expect(ordered.every((entry) => entry.unlockedAt === null)).toBe(true);
  });
});

describe('hidden-sector lifetime unlocks', () => {
  const breakerPredicate = (context: UnlockEvaluationContext) =>
    conditionById('unlock_wall_breaker').predicate(context);
  const masonPredicate = (context: UnlockEvaluationContext) =>
    conditionById('unlock_void_mason').predicate(context);

  test('found caches alone never earn a hidden-sector unlock', () => {
    const context = makeContext({ lifetime: { secretsFoundTotal: 40, hiddenSectorsFoundTotal: 0 } });
    expect(breakerPredicate(context)).toBe(false);
    expect(masonPredicate(context)).toBe(false);
  });

  test('hidden sectors alone never earn a cache unlock', () => {
    const context = makeContext({ lifetime: { secretsFoundTotal: 0, hiddenSectorsFoundTotal: 40 } });
    expect(conditionById('unlock_secret_seeker').predicate(context)).toBe(false);
    expect(conditionById('unlock_secret_archivist').predicate(context)).toBe(false);
  });

  test('each threshold fires on its own counter and not one short of it', () => {
    expect(breakerPredicate(makeContext({ lifetime: { hiddenSectorsFoundTotal: 2 } }))).toBe(false);
    expect(breakerPredicate(makeContext({ lifetime: { hiddenSectorsFoundTotal: 3 } }))).toBe(true);
    expect(masonPredicate(makeContext({ lifetime: { hiddenSectorsFoundTotal: 14 } }))).toBe(false);
    expect(masonPredicate(makeContext({ lifetime: { hiddenSectorsFoundTotal: 15 } }))).toBe(true);
  });

  test('lore unlocks fire on their own counter at their own thresholds', () => {
    const keeper = conditionById('unlock_lore_keeper').predicate;
    const complete = conditionById('unlock_lore_complete').predicate;
    expect(keeper(makeContext({ lifetime: { loreFragmentsFound: 4 } }))).toBe(false);
    expect(keeper(makeContext({ lifetime: { loreFragmentsFound: 5 } }))).toBe(true);
    expect(complete(makeContext({
      lifetime: { loreFragmentsFound: LORE_FRAGMENTS.length - 1 },
    }))).toBe(false);
    expect(complete(makeContext({
      lifetime: { loreFragmentsFound: LORE_FRAGMENTS.length },
    }))).toBe(true);
    expect(keeper(makeContext({ lifetime: { secretsFoundTotal: 40 } }))).toBe(false);
  });
});
