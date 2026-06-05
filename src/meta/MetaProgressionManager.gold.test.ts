import { describe, test, expect, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so the manager constructs and
// reads/writes without touching crypto/localStorage. Same specifier ('../storage')
// as the production import, so Vitest swaps the real module for this one. Returns
// null for every key → the manager (and AscensionManager) boot with default state
// (no upgrades, world level 0, no streak, fresh newcomer counter).
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

// Import after the mock is registered so the manager binds to it.
import {
  computeRunGold,
  newcomerMultiplierForRuns,
  getMetaProgressionManager,
} from './MetaProgressionManager';

/** Neutral multipliers (every modifier off) — isolates the base formula. */
function neutralGoldParams(overrides: Partial<Parameters<typeof computeRunGold>[0]> = {}) {
  return {
    killCount: 0,
    gameTimeSeconds: 0,
    playerLevel: 0,
    hasWon: false,
    runGoldMultiplier: 1,
    goldUpgradeMultiplier: 1,
    worldLevelMultiplier: 1,
    streakMultiplier: 1,
    achievementGoldBonusPercent: 0,
    ascensionMultiplier: 1,
    newcomerMultiplier: 1,
    ...overrides,
  };
}

describe('computeRunGold — pure run-gold formula', () => {
  test('sums kills×2.5 + seconds÷10 + level×10 with neutral multipliers', () => {
    // 100 kills → floor(250), 300s → 30, level 10 → 100 = 380.
    expect(
      computeRunGold(neutralGoldParams({ killCount: 100, gameTimeSeconds: 300, playerLevel: 10 })),
    ).toBe(380);
  });

  test('floors the kill and time components independently', () => {
    // 1 kill → floor(2.5) = 2; 5s → floor(0.5) = 0; level 0 → 0. Below the floor → 50.
    expect(
      computeRunGold(neutralGoldParams({ killCount: 1, gameTimeSeconds: 5, playerLevel: 0 })),
    ).toBe(50);
  });

  test('applies a 50-gold minimum floor to near-zero runs', () => {
    expect(computeRunGold(neutralGoldParams())).toBe(50);
  });

  test('victory grants a ×1.5 bonus', () => {
    // base 380 → ×1.5 = 570.
    expect(
      computeRunGold(neutralGoldParams({ killCount: 100, gameTimeSeconds: 300, playerLevel: 10, hasWon: true })),
    ).toBe(570);
  });

  test('applies the run-level gold multiplier (ship/stage/pact)', () => {
    // base 380 → ×2 = 760.
    expect(
      computeRunGold(neutralGoldParams({ killCount: 100, gameTimeSeconds: 300, playerLevel: 10, runGoldMultiplier: 2 })),
    ).toBe(760);
  });

  test('applies the newcomer multiplier', () => {
    // base 380 → ×3 = 1140.
    expect(
      computeRunGold(neutralGoldParams({ killCount: 100, gameTimeSeconds: 300, playerLevel: 10, newcomerMultiplier: 3 })),
    ).toBe(1140);
  });

  test('stacks every multiplier with flooring after each step', () => {
    // base 380 → win ×1.5 = 570 → goldUpgrade ×1.5 = 855 → worldLevel ×1.2 = 1026
    //  → streak ×1.1 = floor(1128.6) = 1128 → achievement +10% = floor(1240.8) = 1240
    //  → newcomer ×2 = 2480 (ascension 1.0 is a no-op).
    expect(
      computeRunGold({
        killCount: 100,
        gameTimeSeconds: 300,
        playerLevel: 10,
        hasWon: true,
        runGoldMultiplier: 1,
        goldUpgradeMultiplier: 1.5,
        worldLevelMultiplier: 1.2,
        streakMultiplier: 1.1,
        achievementGoldBonusPercent: 10,
        ascensionMultiplier: 1,
        newcomerMultiplier: 2,
      }),
    ).toBe(2480);
  });

  test('applies the ascension multiplier only when above 1', () => {
    // base 380 → ascension ×1.25 = 475.
    expect(
      computeRunGold(neutralGoldParams({ killCount: 100, gameTimeSeconds: 300, playerLevel: 10, ascensionMultiplier: 1.25 })),
    ).toBe(475);
  });
});

describe('newcomerMultiplierForRuns — first-runs gold taper', () => {
  test('tapers 3.0 → 1.5 across the first five runs', () => {
    expect(newcomerMultiplierForRuns(0)).toBe(3.0);
    expect(newcomerMultiplierForRuns(1)).toBe(2.5);
    expect(newcomerMultiplierForRuns(2)).toBe(2.0);
    expect(newcomerMultiplierForRuns(3)).toBe(1.75);
    expect(newcomerMultiplierForRuns(4)).toBe(1.5);
  });

  test('runs 5–9 keep a reduced 1.25 bonus', () => {
    expect(newcomerMultiplierForRuns(5)).toBe(1.25);
    expect(newcomerMultiplierForRuns(9)).toBe(1.25);
  });

  test('runs 10+ have no newcomer bonus', () => {
    expect(newcomerMultiplierForRuns(10)).toBe(1);
    expect(newcomerMultiplierForRuns(50)).toBe(1);
  });
});

describe('calculateRunGold is a pure read — no run-counter side effect', () => {
  test('calling it repeatedly does not advance the newcomer counter', () => {
    const manager = getMetaProgressionManager();
    const before = manager.getRunsCompleted();

    manager.calculateRunGold(100, 300, 10, false);
    manager.calculateRunGold(100, 300, 10, false);

    // A "calculate" must not mutate state — otherwise a win that shows a gold
    // preview and then dies in endless mode burns the newcomer taper twice.
    expect(manager.getRunsCompleted()).toBe(before);
  });
});

describe('recordRunCompleted — the explicit run-counter advance', () => {
  test('advances the newcomer counter by exactly one per call', () => {
    const manager = getMetaProgressionManager();
    const before = manager.getRunsCompleted();

    manager.recordRunCompleted();

    expect(manager.getRunsCompleted()).toBe(before + 1);
  });

  test('shifts the displayed newcomer multiplier down one tier', () => {
    const manager = getMetaProgressionManager();
    const runsBefore = manager.getRunsCompleted();
    const expectedBefore = newcomerMultiplierForRuns(runsBefore);
    const expectedAfter = newcomerMultiplierForRuns(runsBefore + 1);

    expect(manager.getNewcomerMultiplier()).toBe(expectedBefore);
    manager.recordRunCompleted();
    expect(manager.getNewcomerMultiplier()).toBe(expectedAfter);
  });
});
