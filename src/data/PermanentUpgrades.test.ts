import { describe, test, expect } from 'vitest';
import managerSource from '../meta/MetaProgressionManager.ts?raw';
import {
  PERMANENT_UPGRADES,
  UPGRADE_CATEGORIES,
  calculateUpgradeCost,
  calculateAccountLevel,
  getUpgradesByCategory,
  getPermanentUpgradeById,
  type PermanentUpgrade,
  type UpgradeCategory,
} from './PermanentUpgrades';
import { ICON_MAP, isValidFrameName } from '../utils/IconMap';

const VALID_CATEGORY_IDS = UPGRADE_CATEGORIES.map((category) => category.id);

describe('PERMANENT_UPGRADES data integrity', () => {
  test('the table is non-empty', () => {
    expect(PERMANENT_UPGRADES.length).toBeGreaterThan(0);
  });

  test('every upgrade id is a unique non-empty string', () => {
    const ids = PERMANENT_UPGRADES.map((upgrade) => upgrade.id);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every upgrade has a non-empty name and description', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      expect(upgrade.name.trim().length, upgrade.id).toBeGreaterThan(0);
      expect(upgrade.description.trim().length, upgrade.id).toBeGreaterThan(0);
    }
  });

  test('every upgrade belongs to a declared category', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      expect(VALID_CATEGORY_IDS, `${upgrade.id} category "${upgrade.category}"`).toContain(
        upgrade.category
      );
    }
  });

  test('every unlockLevel is a non-negative integer', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      expect(Number.isInteger(upgrade.unlockLevel), upgrade.id).toBe(true);
      expect(upgrade.unlockLevel, upgrade.id).toBeGreaterThanOrEqual(0);
    }
  });

  test('every maxLevel is an integer of at least 1', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      expect(Number.isInteger(upgrade.maxLevel), upgrade.id).toBe(true);
      expect(upgrade.maxLevel, upgrade.id).toBeGreaterThanOrEqual(1);
    }
  });

  test('every baseCost is a positive integer', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      expect(Number.isInteger(upgrade.baseCost), upgrade.id).toBe(true);
      expect(upgrade.baseCost, upgrade.id).toBeGreaterThan(0);
    }
  });

  // costScaling must be strictly above 1 or repeated purchases stop getting more
  // expensive and the gold economy collapses; it must be finite or every cost
  // after level 0 becomes Infinity/NaN.
  test('every costScaling is finite and greater than 1', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      expect(Number.isFinite(upgrade.costScaling), upgrade.id).toBe(true);
      expect(upgrade.costScaling, upgrade.id).toBeGreaterThan(1);
    }
  });

  // getEffect feeds the shop card text directly; a thrown exception or empty
  // string at any reachable level (0 = unpurchased through maxLevel) breaks the
  // shop UI for that upgrade.
  test('getEffect returns a non-empty string for every reachable level', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      for (let level = 0; level <= upgrade.maxLevel; level++) {
        const effect = upgrade.getEffect(level);
        expect(typeof effect, `${upgrade.id} @ ${level}`).toBe('string');
        expect(effect.trim().length, `${upgrade.id} @ ${level}`).toBeGreaterThan(0);
      }
    }
  });

  // ShopScene renders upgrade.icon through getIconFrame, which falls back to a
  // cross-mark and console.warns on an unknown key — a typo'd icon ships
  // silently. Lock that every icon resolves without the fallback path.
  test('every icon resolves to an atlas frame without the fallback', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      const resolves =
        ICON_MAP[upgrade.icon] !== undefined || isValidFrameName(upgrade.icon);
      expect(resolves, `${upgrade.id} icon "${upgrade.icon}"`).toBe(true);
    }
  });
});

describe('UPGRADE_CATEGORIES', () => {
  test('category ids are unique', () => {
    const ids = UPGRADE_CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every category has a non-empty display name and icon', () => {
    for (const category of UPGRADE_CATEGORIES) {
      expect(category.name.trim().length, category.id).toBeGreaterThan(0);
      expect(category.icon.trim().length, category.id).toBeGreaterThan(0);
    }
  });

  test('every declared category contains at least one upgrade', () => {
    for (const category of UPGRADE_CATEGORIES) {
      expect(getUpgradesByCategory(category.id).length, category.id).toBeGreaterThan(0);
    }
  });
});

describe('getUpgradesByCategory', () => {
  test('the categories partition the full table (totality, no overlap)', () => {
    const seen = new Map<string, UpgradeCategory>();
    for (const category of UPGRADE_CATEGORIES) {
      for (const upgrade of getUpgradesByCategory(category.id)) {
        expect(seen.has(upgrade.id), `${upgrade.id} in two categories`).toBe(false);
        seen.set(upgrade.id, category.id);
      }
    }
    expect(seen.size).toBe(PERMANENT_UPGRADES.length);
  });

  test('returns only upgrades of the requested category', () => {
    for (const category of UPGRADE_CATEGORIES) {
      for (const upgrade of getUpgradesByCategory(category.id)) {
        expect(upgrade.category).toBe(category.id);
      }
    }
  });
});

describe('calculateUpgradeCost', () => {
  const sample = (overrides: Partial<PermanentUpgrade> = {}): PermanentUpgrade => ({
    id: 'sample',
    name: 'Sample',
    description: 'Sample upgrade',
    icon: 'sword',
    category: 'offense',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 75,
    costScaling: 1.25,
    getEffect: () => 'effect',
    ...overrides,
  });

  test('level 0 costs exactly baseCost', () => {
    expect(calculateUpgradeCost(sample(), 0)).toBe(75);
  });

  test('applies baseCost × costScaling^level with floor rounding', () => {
    // 75 × 1.25^1 = 93.75 → 93; 75 × 1.25^2 = 117.1875 → 117
    expect(calculateUpgradeCost(sample(), 1)).toBe(93);
    expect(calculateUpgradeCost(sample(), 2)).toBe(117);
    // 300 × 2.5^2 = 1875 exactly (no rounding loss)
    expect(calculateUpgradeCost(sample({ baseCost: 300, costScaling: 2.5 }), 2)).toBe(1875);
  });

  test('returns Infinity at and beyond maxLevel', () => {
    expect(calculateUpgradeCost(sample({ maxLevel: 3 }), 3)).toBe(Infinity);
    expect(calculateUpgradeCost(sample({ maxLevel: 3 }), 4)).toBe(Infinity);
  });

  test('the last purchasable level is still finite', () => {
    expect(Number.isFinite(calculateUpgradeCost(sample({ maxLevel: 3 }), 2))).toBe(true);
  });

  // Sweep the real shop: every reachable price must be a positive integer and
  // prices must never go down as the level rises (the player can never be
  // rewarded for buying in a weird order).
  test('every real upgrade has finite, positive-integer, non-decreasing prices', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      let previousCost = 0;
      for (let level = 0; level < upgrade.maxLevel; level++) {
        const cost = calculateUpgradeCost(upgrade, level);
        expect(Number.isInteger(cost), `${upgrade.id} @ ${level}`).toBe(true);
        expect(cost, `${upgrade.id} @ ${level}`).toBeGreaterThan(0);
        expect(cost, `${upgrade.id} @ ${level}`).toBeGreaterThanOrEqual(previousCost);
        previousCost = cost;
      }
      expect(calculateUpgradeCost(upgrade, upgrade.maxLevel)).toBe(Infinity);
    }
  });
});

describe('calculateAccountLevel', () => {
  test('returns 0 for an empty state', () => {
    expect(calculateAccountLevel({})).toBe(0);
  });

  test('sums all upgrade levels', () => {
    expect(calculateAccountLevel({ damageLevel: 3, healthLevel: 2, luckLevel: 0 })).toBe(5);
  });

  test('a fully-zero default state is account level 0', () => {
    const state: Record<string, number> = {};
    for (const upgrade of PERMANENT_UPGRADES) {
      state[upgrade.id] = 0;
    }
    expect(calculateAccountLevel(state)).toBe(0);
  });
});

describe('getPermanentUpgradeById', () => {
  test('round-trips every id in the table', () => {
    for (const upgrade of PERMANENT_UPGRADES) {
      expect(getPermanentUpgradeById(upgrade.id)).toBe(upgrade);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(getPermanentUpgradeById('definitelyNotAnUpgrade')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-file consistency: every upgrade sold in the shop must be consumed by
// MetaProgressionManager (otherwise gold buys a no-op), and every upgrade id the
// manager reads must exist in the shop table (otherwise the bonus is forever 0).
// PermanentUpgradeState is Record<string, number>, so the type system cannot
// enforce this — extract the consumed ids from the manager source instead.
// ─────────────────────────────────────────────────────────────────────────────

describe('MetaProgressionManager consumption consistency', () => {
  const consumedIds = new Set(
    [...managerSource.matchAll(
      /this\.(?:level|tieredBonus|getUpgradeLevel)\('([a-zA-Z]+)'/g
    )].map((match) => match[1])
  );

  // Guard the extraction itself: if the manager's accessor helpers are renamed,
  // this fails loudly instead of letting the set-equality tests pass vacuously.
  test('source extraction finds a plausible number of consumed ids', () => {
    expect(consumedIds.size).toBeGreaterThan(50);
  });

  test('every upgrade sold in the shop is consumed by the manager', () => {
    const orphaned = PERMANENT_UPGRADES.map((upgrade) => upgrade.id).filter(
      (id) => !consumedIds.has(id)
    );
    expect(orphaned, 'shop upgrades nothing reads (gold buys a no-op)').toEqual([]);
  });

  test('every id the manager consumes exists in the shop table', () => {
    const definedIds = new Set(PERMANENT_UPGRADES.map((upgrade) => upgrade.id));
    const phantom = [...consumedIds].filter((id) => !definedIds.has(id));
    expect(phantom, 'manager reads ids the shop never sells (bonus stuck at 0)').toEqual([]);
  });
});
