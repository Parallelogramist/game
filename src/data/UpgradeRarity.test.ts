import { describe, test, expect } from 'vitest';
import {
  UPGRADE_RARITIES,
  UPGRADE_LUCK_RARITY_BONUS,
  luckBiasedUpgradeWeight,
  weightedOrder,
  getUpgradeRarityCardStyle,
  type UpgradeRarity,
} from './UpgradeRarity';

/**
 * Pure rarity/roll module behind the rarity-tiered level-up offers. The core
 * contract: at luck 0 every rarity weighs exactly 1, so the offer engine is
 * distribution-identical to the pre-rarity uniform shuffle; luck only ever
 * boosts rare/epic, never penalizes common.
 */

describe('UPGRADE_RARITIES / UPGRADE_LUCK_RARITY_BONUS — structure', () => {
  test('three tiers in ascending quality order', () => {
    expect(UPGRADE_RARITIES).toEqual(['common', 'rare', 'epic']);
  });

  test('common has zero luck bonus so luck never shifts its weight', () => {
    expect(UPGRADE_LUCK_RARITY_BONUS.common).toBe(0);
  });

  test('luck bonus strictly grows with rarity', () => {
    expect(UPGRADE_LUCK_RARITY_BONUS.rare).toBeGreaterThan(UPGRADE_LUCK_RARITY_BONUS.common);
    expect(UPGRADE_LUCK_RARITY_BONUS.epic).toBeGreaterThan(UPGRADE_LUCK_RARITY_BONUS.rare);
  });
});

describe('luckBiasedUpgradeWeight', () => {
  test('every rarity weighs exactly 1 at luck 0 (the no-bias invariant)', () => {
    for (const rarity of UPGRADE_RARITIES) {
      expect(luckBiasedUpgradeWeight(rarity, 0)).toBe(1);
    }
  });

  test('common stays at weight 1 regardless of luck', () => {
    expect(luckBiasedUpgradeWeight('common', 0.5)).toBe(1);
    expect(luckBiasedUpgradeWeight('common', 1)).toBe(1);
  });

  test('rare and epic weights grow with luck, epic fastest', () => {
    const rareLow = luckBiasedUpgradeWeight('rare', 0.25);
    const rareHigh = luckBiasedUpgradeWeight('rare', 0.75);
    expect(rareLow).toBeGreaterThan(1);
    expect(rareHigh).toBeGreaterThan(rareLow);
    expect(luckBiasedUpgradeWeight('epic', 0.5)).toBeGreaterThan(luckBiasedUpgradeWeight('rare', 0.5));
  });

  test('matches the documented formula 1 + luck × bonus', () => {
    for (const rarity of UPGRADE_RARITIES) {
      expect(luckBiasedUpgradeWeight(rarity, 0.5)).toBeCloseTo(
        1 + 0.5 * UPGRADE_LUCK_RARITY_BONUS[rarity],
      );
    }
  });

  test('clamps luck to [0, 1]', () => {
    expect(luckBiasedUpgradeWeight('epic', 5)).toBe(luckBiasedUpgradeWeight('epic', 1));
    expect(luckBiasedUpgradeWeight('epic', -2)).toBe(1);
  });

  test('non-finite luck is treated as 0', () => {
    expect(luckBiasedUpgradeWeight('epic', Number.NaN)).toBe(1);
    expect(luckBiasedUpgradeWeight('epic', Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('weightedOrder — weighted sampling without replacement', () => {
  test('returns a permutation of the input (same items, same length)', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const ordered = weightedOrder(items, () => 1);
    expect(ordered).toHaveLength(items.length);
    expect([...ordered].sort()).toEqual([...items].sort());
  });

  test('does not mutate the input array', () => {
    const items = ['a', 'b', 'c'];
    weightedOrder(items, () => 1);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  test('empty input yields empty output', () => {
    expect(weightedOrder([], () => 1)).toEqual([]);
  });

  test('rng at 0 always picks the first remaining item (identity order)', () => {
    const items = ['a', 'b', 'c'];
    expect(weightedOrder(items, () => 1, () => 0)).toEqual(['a', 'b', 'c']);
  });

  test('rng just below 1 always picks the last remaining item (reversed order)', () => {
    const items = ['a', 'b', 'c'];
    expect(weightedOrder(items, () => 1, () => 0.999999)).toEqual(['c', 'b', 'a']);
  });

  test('equal weights with a midpoint rng walk deterministically', () => {
    // total 3, roll 1.5 → skips a (0.5 left), lands on b; then total 2,
    // roll 1.0 → lands exactly on a; c remains.
    expect(weightedOrder(['a', 'b', 'c'], () => 1, () => 0.5)).toEqual(['b', 'a', 'c']);
  });

  test('a heavily weighted item is pulled forward', () => {
    // total 10, roll 5 → skips common (4 left), lands on epic.
    const weightFor = (item: string) => (item === 'epic' ? 9 : 1);
    expect(weightedOrder(['common', 'epic'], weightFor, () => 0.5)).toEqual(['epic', 'common']);
  });
});

describe('getUpgradeRarityCardStyle', () => {
  test('common (and missing) rarity gets no special styling', () => {
    expect(getUpgradeRarityCardStyle('common')).toBeNull();
    expect(getUpgradeRarityCardStyle(undefined)).toBeNull();
  });

  test('rare and epic get full card style with a label naming the tier', () => {
    for (const rarity of ['rare', 'epic'] as UpgradeRarity[]) {
      const style = getUpgradeRarityCardStyle(rarity);
      expect(style).not.toBeNull();
      expect(Number.isInteger(style!.body)).toBe(true);
      expect(Number.isInteger(style!.accent)).toBe(true);
      expect(style!.accentStr).toMatch(/^#[0-9a-f]{6}$/i);
      expect(style!.label.toLowerCase()).toContain(rarity);
    }
  });

  test('rare and epic styles are visually distinct from each other', () => {
    const rare = getUpgradeRarityCardStyle('rare')!;
    const epic = getUpgradeRarityCardStyle('epic')!;
    expect(rare.accent).not.toBe(epic.accent);
    expect(rare.body).not.toBe(epic.body);
  });
});
