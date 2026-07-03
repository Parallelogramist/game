import { describe, test, expect } from 'vitest';
import {
  ALL_CARDS,
  CARD_RARITIES,
  CARD_RARITY_DROP_WEIGHTS,
  aggregateCardBonuses,
  getCardById,
  getCardRarityColor,
  pickUndiscoveredCard,
  rollCardRarity,
  type CardBonus,
  type CardRarity,
} from './Cards';
import { ICON_MAP } from '../utils/IconMap';

/**
 * Pure card-catalog + roll logic behind the collection meta system. Core
 * contracts: 24 cards at 10/8/4/2 per rarity, 60/30/9/1 rarity weights, a
 * fallback that never dupes and only returns null on a complete archive, and
 * an aggregate that compounds multipliers / sums adds / maxes startAtLevel
 * with identity defaults so an empty collection is a strict no-op.
 */

// Deterministic rng helper: yields the given values in order (repeats last).
function rngSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function idsOfRarity(rarity: CardRarity): string[] {
  return ALL_CARDS.filter((card) => card.rarity === rarity).map((card) => card.id);
}

describe('ALL_CARDS — catalog structure', () => {
  test('has 24 cards split 10 common / 8 rare / 4 epic / 2 legendary', () => {
    expect(ALL_CARDS).toHaveLength(24);
    expect(idsOfRarity('common')).toHaveLength(10);
    expect(idsOfRarity('rare')).toHaveLength(8);
    expect(idsOfRarity('epic')).toHaveLength(4);
    expect(idsOfRarity('legendary')).toHaveLength(2);
  });

  test('all ids are unique and card_ prefixed', () => {
    const ids = ALL_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^card_/);
  });

  test('every card has a non-empty name and description', () => {
    for (const card of ALL_CARDS) {
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
    }
  });

  test('every icon key resolves through the icon atlas map (no fallback glyphs)', () => {
    for (const card of ALL_CARDS) {
      expect(ICON_MAP[card.icon], `icon "${card.icon}" on ${card.id}`).toBeDefined();
    }
  });

  test('every card grants at least one bonus field, all finite numbers', () => {
    for (const card of ALL_CARDS) {
      const entries = Object.entries(card.bonus);
      expect(entries.length, card.id).toBeGreaterThan(0);
      for (const [, value] of entries) {
        expect(typeof value).toBe('number');
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  test('rarity table: ascending order and 60/30/9/1 weights', () => {
    expect(CARD_RARITIES).toEqual(['common', 'rare', 'epic', 'legendary']);
    expect(CARD_RARITY_DROP_WEIGHTS).toEqual({ common: 60, rare: 30, epic: 9, legendary: 1 });
  });

  test('getCardById finds every card and misses unknown ids', () => {
    for (const card of ALL_CARDS) expect(getCardById(card.id)).toBe(card);
    expect(getCardById('card_nope')).toBeUndefined();
  });

  test('each rarity has a distinct accent color', () => {
    const colors = CARD_RARITIES.map((rarity) => getCardRarityColor(rarity));
    expect(new Set(colors).size).toBe(CARD_RARITIES.length);
  });
});

describe('rollCardRarity', () => {
  // Weights 60/30/9/1 over total 100 → cumulative boundaries at rng values
  // 0.6 / 0.9 / 0.99. Boundary rolls belong to the NEXT tier (the running
  // subtraction only stops when it goes strictly below zero).
  test('maps rng values onto the 60/30/9/1 bands', () => {
    expect(rollCardRarity(() => 0)).toBe('common');
    expect(rollCardRarity(() => 0.599)).toBe('common');
    expect(rollCardRarity(() => 0.6)).toBe('rare');
    expect(rollCardRarity(() => 0.899)).toBe('rare');
    expect(rollCardRarity(() => 0.9)).toBe('epic');
    expect(rollCardRarity(() => 0.989)).toBe('epic');
    expect(rollCardRarity(() => 0.99)).toBe('legendary');
    expect(rollCardRarity(() => 0.9999)).toBe('legendary');
  });

  test('distribution over a deterministic LCG matches the weight ordering', () => {
    // Small LCG so the test is seed-stable across platforms.
    let seed = 12345;
    const lcg = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const counts: Record<CardRarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < 10000; i++) counts[rollCardRarity(lcg)]++;

    expect(counts.common).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.epic);
    expect(counts.epic).toBeGreaterThan(counts.legendary);
    // Rough band checks — generous so a legitimate reseed can't flake this.
    expect(counts.common).toBeGreaterThan(5000);
    expect(counts.legendary).toBeGreaterThan(0);
    expect(counts.legendary).toBeLessThan(500);
  });
});

describe('pickUndiscoveredCard', () => {
  test('returns an undiscovered card of the requested rarity when available', () => {
    const card = pickUndiscoveredCard(new Set(), 'rare', () => 0);
    expect(card).not.toBeNull();
    expect(card!.rarity).toBe('rare');
  });

  test('never returns an already-discovered card', () => {
    const rareIds = idsOfRarity('rare');
    const discovered = new Set(rareIds.slice(0, rareIds.length - 1));
    // Whatever the rng, only one rare remains.
    for (const roll of [0, 0.25, 0.5, 0.999]) {
      const card = pickUndiscoveredCard(discovered, 'rare', () => roll);
      expect(card!.id).toBe(rareIds[rareIds.length - 1]);
    }
  });

  test('rng indexes deterministically into the remaining pool', () => {
    const commons = idsOfRarity('common');
    expect(pickUndiscoveredCard(new Set(), 'common', () => 0)!.id).toBe(commons[0]);
    expect(pickUndiscoveredCard(new Set(), 'common', () => 0.999)!.id).toBe(
      commons[commons.length - 1],
    );
  });

  test('falls back to the nearest rarity — equal distance breaks toward the higher tier', () => {
    // All epics discovered, roll epic: rare and legendary are both distance 1
    // → the higher tier (legendary) must win the tie.
    const card = pickUndiscoveredCard(new Set(idsOfRarity('epic')), 'epic', () => 0);
    expect(card!.rarity).toBe('legendary');
  });

  test('falls back downward when everything above is discovered', () => {
    const discovered = new Set([...idsOfRarity('legendary'), ...idsOfRarity('epic')]);
    // Roll legendary: epic (dist 1) and legendary (dist 0) empty → rare (dist 2).
    expect(pickUndiscoveredCard(discovered, 'legendary', () => 0)!.rarity).toBe('rare');
  });

  test('falls back across the whole table to the last remaining rarity', () => {
    const discovered = new Set([
      ...idsOfRarity('rare'),
      ...idsOfRarity('epic'),
      ...idsOfRarity('legendary'),
    ]);
    expect(pickUndiscoveredCard(discovered, 'legendary', () => 0)!.rarity).toBe('common');
  });

  test('falls back upward when everything below is discovered', () => {
    const discovered = new Set([...idsOfRarity('common'), ...idsOfRarity('rare')]);
    expect(pickUndiscoveredCard(discovered, 'common', () => 0)!.rarity).toBe('epic');
  });

  test('returns null only when the archive is complete', () => {
    const everything = new Set(ALL_CARDS.map((card) => card.id));
    for (const rarity of CARD_RARITIES) {
      expect(pickUndiscoveredCard(everything, rarity, () => 0)).toBeNull();
    }
    // One card short of complete → still never null.
    const almostAll = new Set(ALL_CARDS.slice(1).map((card) => card.id));
    expect(pickUndiscoveredCard(almostAll, 'legendary', () => 0.5)).not.toBeNull();
  });

  test('rng sequence helper sanity (guards the test tooling itself)', () => {
    const rng = rngSequence(0.1, 0.2);
    expect(rng()).toBe(0.1);
    expect(rng()).toBe(0.2);
    expect(rng()).toBe(0.2); // repeats last
  });
});

describe('aggregateCardBonuses', () => {
  const IDENTITY: Required<CardBonus> = {
    damageMult: 1,
    attackSpeedMult: 1,
    goldMult: 1,
    xpMult: 1,
    magnetRadiusMult: 1,
    moveSpeedMult: 1,
    ultChargeRateMult: 1,
    maxHealthAdd: 0,
    critChanceAdd: 0,
    armorAdd: 0,
    luckAdd: 0,
    rerollsAdd: 0,
    banishesAdd: 0,
    startAtLevel: 1,
  };

  test('empty collection aggregates to the exact identity block', () => {
    expect(aggregateCardBonuses(new Set())).toEqual(IDENTITY);
  });

  test('unknown ids in the set contribute nothing', () => {
    expect(aggregateCardBonuses(new Set(['card_nope', 'junk']))).toEqual(IDENTITY);
  });

  test('a single card contributes exactly its own bonus over the identity', () => {
    // card_void_capacitor: +5% damage.
    const aggregated = aggregateCardBonuses(new Set(['card_void_capacitor']));
    expect(aggregated.damageMult).toBeCloseTo(1.05, 10);
    expect({ ...aggregated, damageMult: 1 }).toEqual(IDENTITY);
  });

  test('multipliers COMPOUND multiplicatively across cards', () => {
    // +2% and +5% and +4% damage → 1.02 × 1.05 × 1.04, not 1.11.
    const aggregated = aggregateCardBonuses(
      new Set(['card_overtuned_coils', 'card_void_capacitor', 'card_twin_reactor']),
    );
    expect(aggregated.damageMult).toBeCloseTo(1.02 * 1.05 * 1.04, 10);
    expect(aggregated.attackSpeedMult).toBeCloseTo(1.04, 10); // twin reactor's other half
  });

  test('additive fields sum across cards', () => {
    const aggregated = aggregateCardBonuses(new Set(['card_hull_patch', 'card_emergency_foam']));
    expect(aggregated.maxHealthAdd).toBe(20);
  });

  test('luck adds stack additively across rarities', () => {
    const aggregated = aggregateCardBonuses(new Set(['card_lucky_debris', 'card_golden_compass']));
    expect(aggregated.luckAdd).toBeCloseTo(0.05 + 0.08, 10);
    expect(aggregated.goldMult).toBeCloseTo(1.12, 10);
  });

  test('startAtLevel takes the max, never sums', () => {
    expect(aggregateCardBonuses(new Set(['card_head_start'])).startAtLevel).toBe(2);
    // With everything discovered it is still the single best card's level.
    const everything = new Set(ALL_CARDS.map((card) => card.id));
    expect(aggregateCardBonuses(everything).startAtLevel).toBe(2);
  });

  test('full archive stays "one shop tier" small (feel-checklist guard)', () => {
    const aggregated = aggregateCardBonuses(new Set(ALL_CARDS.map((card) => card.id)));
    // Every multiplier bounded well below runaway territory and every value finite.
    for (const [key, value] of Object.entries(aggregated)) {
      expect(Number.isFinite(value), key).toBe(true);
    }
    expect(aggregated.damageMult).toBeLessThan(1.25);
    expect(aggregated.goldMult).toBeLessThan(1.35);
    expect(aggregated.maxHealthAdd).toBeLessThanOrEqual(30);
  });

  test('does not mutate the input set', () => {
    const discovered = new Set(['card_hull_patch']);
    aggregateCardBonuses(discovered);
    expect([...discovered]).toEqual(['card_hull_patch']);
  });
});
