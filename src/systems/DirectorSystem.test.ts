import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEnemyCost,
  updateDirector,
  pickDirectorStrategy,
  getCurrentStrategy,
  pickEnemyFromDirector,
  resetDirectorSystem,
  setDirectorEnabled,
  getDirectorState,
  restoreDirectorState,
  type DirectorStrategy,
} from './DirectorSystem';
import {
  ENEMY_TYPES,
  EnemyCategory,
  EnemyAIType,
  type EnemyTypeDefinition,
} from '../enemies/EnemyTypes';

/**
 * DirectorSystem is the credit-budget spawn director that paces EVERY run, yet
 * only its save round-trip was covered (`GameStateManager.director.test.ts`). The
 * credit-accrual math, the per-enemy spawn-cost formula, the per-strategy biasing,
 * and the affordability/fallback branches that actually decide what spawns were
 * entirely untested — a typo'd coefficient or sign would ship as a silent,
 * impossible-to-spot balance bug. These lock the pure economy + selection contract.
 *
 * All strategy state is forced (`pickDirectorStrategy('balanced')`) and Math.random
 * is mocked where a branch depends on it, so the suite is deterministic against the
 * real RNG. `setDirectorEnabled(true)` is re-asserted each test because the enabled
 * flag is module state that `vi.restoreAllMocks()` does not reset.
 */

const ALL_STRATEGIES: DirectorStrategy[] = ['swarm', 'elite', 'balanced', 'chaos'];

/** Synthetic enemy def so cost-formula assertions don't couple to live tuning. */
function makeEnemy(props: Partial<EnemyTypeDefinition> & { id: string }): EnemyTypeDefinition {
  return {
    name: props.id,
    aiType: EnemyAIType.Chase,
    category: EnemyCategory.Basic,
    baseHealth: 0,
    baseSpeed: 50,
    baseDamage: 0,
    size: 1,
    color: 0,
    shape: 'circle',
    xpValue: 1,
    minSpawnTime: 0,
    spawnWeight: 10,
    ...props,
  };
}

beforeEach(() => {
  resetDirectorSystem();
  pickDirectorStrategy('balanced'); // pin strategy (reset re-rolls randomly)
  setDirectorEnabled(true); // module flag; not reset by restoreAllMocks
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getEnemyCost — spawn cost formula
// ---------------------------------------------------------------------------

describe('DirectorSystem getEnemyCost (cost formula)', () => {
  test('weights health/1.5×damage/sqrt(xp) and sums them', () => {
    // raw = baseHealth/15 + (baseDamage/10)*1.5 + sqrt(max(1,xp))
    expect(getEnemyCost(makeEnemy({ id: 'c-health', baseHealth: 150 }))).toBe(11); // 10 + 0 + 1
    expect(getEnemyCost(makeEnemy({ id: 'c-damage', baseDamage: 100 }))).toBe(16); // 0 + 15 + 1
    expect(getEnemyCost(makeEnemy({ id: 'c-xp', xpValue: 16 }))).toBe(4); // 0 + 0 + sqrt(16)
    expect(
      getEnemyCost(makeEnemy({ id: 'c-all', baseHealth: 150, baseDamage: 100, xpValue: 16 })),
    ).toBe(29); // 10 + 15 + 4
  });

  test('applies the category multipliers (Elite ×2, Miniboss ×8, Boss ×30)', () => {
    // Same base stats (raw cost 11), one id per category so the cache can't collide.
    const stats = { baseHealth: 150, baseDamage: 0, xpValue: 1 };
    expect(getEnemyCost(makeEnemy({ id: 'm-basic', category: EnemyCategory.Basic, ...stats }))).toBe(11);
    expect(getEnemyCost(makeEnemy({ id: 'm-elite', category: EnemyCategory.Elite, ...stats }))).toBe(22);
    expect(getEnemyCost(makeEnemy({ id: 'm-mini', category: EnemyCategory.Miniboss, ...stats }))).toBe(88);
    expect(getEnemyCost(makeEnemy({ id: 'm-boss', category: EnemyCategory.Boss, ...stats }))).toBe(330);
  });

  test('xp component floors at sqrt(1) so cost never drops below the 1-credit minimum', () => {
    // Math.max(1, xpValue) inside the sqrt — zero/negative xp still contributes 1.
    expect(getEnemyCost(makeEnemy({ id: 'x-zero', xpValue: 0 }))).toBe(1);
    expect(getEnemyCost(makeEnemy({ id: 'x-neg', xpValue: -5 }))).toBe(1);
    // Math.max(1, round(...)) floor: a near-zero raw still returns 1, never 0.
    expect(getEnemyCost(makeEnemy({ id: 'x-tiny', baseHealth: 1, xpValue: 0 }))).toBe(1);
  });

  test('always returns a finite integer ≥ 1', () => {
    const samples = [
      makeEnemy({ id: 's1', baseHealth: 37, baseDamage: 13, xpValue: 7 }),
      makeEnemy({ id: 's2', baseHealth: 0, baseDamage: 0, xpValue: 0 }),
      makeEnemy({ id: 's3', baseHealth: 5000, baseDamage: 999, xpValue: 200, category: EnemyCategory.Boss }),
    ];
    for (const def of samples) {
      const cost = getEnemyCost(def);
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(cost)).toBe(true);
    }
  });

  test('caches by enemy id; resetDirectorSystem clears the cache', () => {
    const first = getEnemyCost(makeEnemy({ id: 'cache-x', baseHealth: 150 })); // 11
    expect(first).toBe(11);
    // Same id, different stats → cached value returned (proves the id-keyed cache).
    expect(getEnemyCost(makeEnemy({ id: 'cache-x', baseHealth: 0, xpValue: 1 }))).toBe(11);
    // After a reset the cache is cleared → the new stats are recomputed.
    resetDirectorSystem();
    expect(getEnemyCost(makeEnemy({ id: 'cache-x', baseHealth: 0, xpValue: 1 }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Credit accrual — updateDirector + getDirectorState
// ---------------------------------------------------------------------------

describe('DirectorSystem credit accrual', () => {
  test('accrues rate(gameTime,worldLevel) × delta over one frame', () => {
    // rate@10s,wl1 = (2 + 10*0.025) * (1 + (1-1)*0.15) = 2.25; × 10s delta = 22.5
    updateDirector(10, 1);
    const state = getDirectorState();
    expect(state.creditBalance).toBeCloseTo(22.5);
    expect(state.creditsEarned).toBeCloseTo(22.5);
    expect(state.lastGameTime).toBe(10);
  });

  test('world level scales the credit rate (+15% per level, <1 below level 1)', () => {
    resetDirectorSystem();
    updateDirector(10, 1);
    const atOne = getDirectorState().creditBalance; // 22.5

    resetDirectorSystem();
    updateDirector(10, 6);
    const atSix = getDirectorState().creditBalance; // 2.25 * 1.75 * 10 = 39.375

    resetDirectorSystem();
    updateDirector(10, 0);
    const atZero = getDirectorState().creditBalance; // 2.25 * 0.85 * 10 = 19.125

    expect(atOne).toBeCloseTo(22.5);
    expect(atSix).toBeCloseTo(39.375);
    expect(atZero).toBeCloseTo(19.125);
    expect(atSix).toBeGreaterThan(atOne);
    expect(atZero).toBeLessThan(atOne);
    expect(atZero).toBeGreaterThan(0); // never goes negative even below world level 1
  });

  test('credit rate rises with game time (later seconds earn more)', () => {
    updateDirector(10, 1);
    const first = getDirectorState().creditBalance; // 22.5 over [0,10]
    updateDirector(20, 1);
    const second = getDirectorState().creditBalance - first; // rate@20 * 10 = 25 over [10,20]
    expect(first).toBeCloseTo(22.5);
    expect(second).toBeCloseTo(25);
    expect(second).toBeGreaterThan(first);
  });

  test('a non-advancing / backward game time accrues nothing and never goes negative', () => {
    updateDirector(10, 1);
    const balance = getDirectorState().creditBalance;
    updateDirector(5, 1); // gameTime < lastGameTime → delta clamps to 0
    const state = getDirectorState();
    expect(state.creditBalance).toBeCloseTo(balance); // unchanged, not negative
    expect(state.lastGameTime).toBe(5); // lastGameTime still advances to the new value
  });

  test('a disabled director accrues no credits', () => {
    setDirectorEnabled(false);
    updateDirector(100, 5);
    expect(getDirectorState().creditBalance).toBe(0);
    expect(getDirectorState().creditsEarned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Strategy selection
// ---------------------------------------------------------------------------

describe('DirectorSystem strategy selection', () => {
  test('a forced strategy is set and returned', () => {
    for (const strategy of ALL_STRATEGIES) {
      expect(pickDirectorStrategy(strategy)).toBe(strategy);
      expect(getCurrentStrategy()).toBe(strategy);
    }
  });

  test('an unforced pick maps the RNG onto the four strategies', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // floor(0 * 4) = 0 → 'swarm'
    expect(pickDirectorStrategy()).toBe('swarm');
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // floor(0.99 * 4) = 3 → 'chaos'
    expect(pickDirectorStrategy()).toBe('chaos');
    expect(getCurrentStrategy()).toBe('chaos');
  });

  test('resetDirectorSystem re-rolls to a valid strategy', () => {
    pickDirectorStrategy('elite');
    vi.spyOn(Math, 'random').mockReturnValue(0); // re-roll → 'swarm'
    resetDirectorSystem();
    expect(getCurrentStrategy()).toBe('swarm');
  });
});

// ---------------------------------------------------------------------------
// pickEnemyFromDirector — selection + spend branches
// ---------------------------------------------------------------------------

describe('DirectorSystem pickEnemyFromDirector', () => {
  test('delegates to the weighted fallback when disabled', () => {
    setDirectorEnabled(false);
    const picked = pickEnemyFromDirector(100, 0, 1);
    expect(picked).not.toBeNull();
    expect(ENEMY_TYPES[picked!.id]).toBeDefined();
  });

  test('returns null when the strategy chooses to save', () => {
    pickDirectorStrategy('elite'); // saveChance 0.35
    vi.spyOn(Math, 'random').mockReturnValue(0); // 0 < 0.35 → save this tick
    expect(pickEnemyFromDirector(100, 0, 1)).toBeNull();
  });

  test('spends exactly the picked enemy cost from the balance', () => {
    restoreDirectorState({ creditBalance: 1000, creditsEarned: 1000, currentStrategy: 'balanced', lastGameTime: 0 });
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // skip save, weighted branch
    const before = getDirectorState().creditBalance;
    const picked = pickEnemyFromDirector(100, 0, 1);
    expect(picked).not.toBeNull();
    const spent = before - getDirectorState().creditBalance;
    expect(spent).toBeCloseTo(getEnemyCost(picked!));
  });

  test('when nothing is affordable it spawns the cheapest and floors the balance at 0', () => {
    restoreDirectorState({ creditBalance: 0.5, creditsEarned: 0.5, currentStrategy: 'balanced', lastGameTime: 0 });
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // skip save
    const picked = pickEnemyFromDirector(100, 0, 1);
    expect(picked).not.toBeNull();
    // Cheapest real cost is ≥ 1 > 0.5, so the spend clamps the balance to exactly 0.
    expect(getDirectorState().creditBalance).toBe(0);
  });

  test('returns the basic Shambler (no deduction) when no candidate is eligible', () => {
    restoreDirectorState({ creditBalance: 1000, creditsEarned: 1000, currentStrategy: 'balanced', lastGameTime: 0 });
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // skip save
    // Negative effective game time → nothing has minSpawnTime ≤ it → empty candidate set.
    const picked = pickEnemyFromDirector(-100, 0, 1);
    expect(picked).toBe(ENEMY_TYPES.basic);
    expect(getDirectorState().creditBalance).toBe(1000); // returned before any spend
  });
});

// ---------------------------------------------------------------------------
// State get/restore/reset (direct module API)
// ---------------------------------------------------------------------------

describe('DirectorSystem state round-trip', () => {
  test('getDirectorState reflects a restored snapshot, including the strategy', () => {
    const snapshot = {
      creditBalance: 42.5,
      creditsEarned: 137.25,
      currentStrategy: 'elite' as DirectorStrategy,
      lastGameTime: 5,
    };
    restoreDirectorState(snapshot);
    expect(getDirectorState()).toEqual(snapshot);
    expect(getCurrentStrategy()).toBe('elite');
  });

  test('resetDirectorSystem zeroes the economy and re-rolls a valid strategy', () => {
    restoreDirectorState({ creditBalance: 100, creditsEarned: 200, currentStrategy: 'chaos', lastGameTime: 50 });
    resetDirectorSystem();
    const state = getDirectorState();
    expect(state.creditBalance).toBe(0);
    expect(state.creditsEarned).toBe(0);
    expect(state.lastGameTime).toBe(0);
    expect(ALL_STRATEGIES).toContain(state.currentStrategy);
  });
});

// ---------------------------------------------------------------------------
// Real-data integrity — the formula stays sane across the live roster
// ---------------------------------------------------------------------------

describe('DirectorSystem cost integrity over ENEMY_TYPES', () => {
  test('every real enemy has a finite integer cost ≥ 1', () => {
    for (const def of Object.values(ENEMY_TYPES)) {
      const cost = getEnemyCost(def);
      expect(Number.isFinite(cost)).toBe(true);
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(1);
    }
  });

  test('category multipliers keep the tiers cost-ordered (boss > elite, miniboss > basic)', () => {
    const costsFor = (category: EnemyCategory) =>
      Object.values(ENEMY_TYPES)
        .filter((def) => def.category === category)
        .map(getEnemyCost);

    const basics = costsFor(EnemyCategory.Basic);
    const elites = costsFor(EnemyCategory.Elite);
    const minibosses = costsFor(EnemyCategory.Miniboss);
    const bosses = costsFor(EnemyCategory.Boss);

    expect(basics.length).toBeGreaterThan(0);
    expect(elites.length).toBeGreaterThan(0);
    expect(minibosses.length).toBeGreaterThan(0);
    expect(bosses.length).toBeGreaterThan(0);

    expect(Math.min(...minibosses)).toBeGreaterThan(Math.max(...basics));
    expect(Math.min(...bosses)).toBeGreaterThan(Math.max(...elites));
  });
});
