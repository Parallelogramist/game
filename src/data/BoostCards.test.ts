import { describe, test, expect } from 'vitest';
import {
  ALL_BOOST_CARDS,
  FLUX_CACHE_DROP_CHANCE,
  getBoostCardById,
  rollBoostCard,
} from './BoostCards';
import { ICON_MAP } from '../utils/IconMap';

/**
 * Pure boost-card catalog + roll logic behind the one-run consumable system
 * (FEAT-CARDS-3). Core contracts: exactly the 8 spec boosts with their fixed
 * ids and magnitudes, a uniform roll (no rarity table, no dupe exclusion),
 * and icons that resolve through the atlas map.
 */

// Deterministic rng helper: yields the given values in order (repeats last).
function rngSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe('ALL_BOOST_CARDS — catalog structure', () => {
  test('has exactly the 8 spec boost ids', () => {
    expect(ALL_BOOST_CARDS.map((boost) => boost.id).sort()).toEqual([
      'boost_afterburner',
      'boost_datastream',
      'boost_goldrush',
      'boost_headstart',
      'boost_overcharge',
      'boost_plating',
      'boost_spare_dice',
      'boost_widebeam',
    ]);
  });

  test('all ids are unique and boost_ prefixed', () => {
    const ids = ALL_BOOST_CARDS.map((boost) => boost.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^boost_/);
  });

  test('every boost has a non-empty name and description', () => {
    for (const boost of ALL_BOOST_CARDS) {
      expect(boost.name.length).toBeGreaterThan(0);
      expect(boost.description.length).toBeGreaterThan(0);
    }
  });

  test('every icon key resolves through the icon atlas map (no fallback glyphs)', () => {
    for (const boost of ALL_BOOST_CARDS) {
      expect(ICON_MAP[boost.icon], `icon "${boost.icon}" on ${boost.id}`).toBeDefined();
    }
  });

  test('spec magnitudes: each boost grants its single fixed bonus', () => {
    expect(getBoostCardById('boost_overcharge')?.bonus).toEqual({ damageMult: 1.15 });
    expect(getBoostCardById('boost_datastream')?.bonus).toEqual({ xpMult: 1.2 });
    expect(getBoostCardById('boost_goldrush')?.bonus).toEqual({ goldMult: 1.2 });
    expect(getBoostCardById('boost_afterburner')?.bonus).toEqual({ moveSpeedMult: 1.1 });
    expect(getBoostCardById('boost_headstart')?.bonus).toEqual({ startAtLevel: 2 });
    expect(getBoostCardById('boost_widebeam')?.bonus).toEqual({ magnetRadiusMult: 1.25 });
    expect(getBoostCardById('boost_plating')?.bonus).toEqual({ armorAdd: 3 });
    expect(getBoostCardById('boost_spare_dice')?.bonus).toEqual({ rerollsAdd: 2 });
  });

  test('every boost grants exactly one bonus field, all finite numbers', () => {
    for (const boost of ALL_BOOST_CARDS) {
      const entries = Object.entries(boost.bonus);
      expect(entries.length, boost.id).toBe(1);
      for (const [, value] of entries) {
        expect(typeof value).toBe('number');
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  test('flux cache drop chance matches the spec (10%, miniboss only)', () => {
    expect(FLUX_CACHE_DROP_CHANCE).toBe(0.1);
  });

  test('getBoostCardById finds every boost and misses unknown ids', () => {
    for (const boost of ALL_BOOST_CARDS) expect(getBoostCardById(boost.id)).toBe(boost);
    expect(getBoostCardById('boost_totally_fake')).toBeUndefined();
    expect(getBoostCardById('card_hull_patch')).toBeUndefined();
  });
});

describe('rollBoostCard — uniform roll', () => {
  test('walks the whole catalog in order as rng sweeps [0, 1)', () => {
    const count = ALL_BOOST_CARDS.length;
    for (let index = 0; index < count; index++) {
      // Center of each uniform bucket lands squarely on that boost.
      const boost = rollBoostCard(rngSequence((index + 0.5) / count));
      expect(boost).toBe(ALL_BOOST_CARDS[index]);
    }
  });

  test('rng 0 picks the first boost, rng just-below-1 picks the last', () => {
    expect(rollBoostCard(rngSequence(0))).toBe(ALL_BOOST_CARDS[0]);
    expect(rollBoostCard(rngSequence(0.999999))).toBe(
      ALL_BOOST_CARDS[ALL_BOOST_CARDS.length - 1],
    );
  });

  test('an out-of-contract rng returning exactly 1 clamps to the last boost', () => {
    expect(rollBoostCard(rngSequence(1))).toBe(ALL_BOOST_CARDS[ALL_BOOST_CARDS.length - 1]);
  });
});
