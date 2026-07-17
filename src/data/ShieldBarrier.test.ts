import { describe, test, expect } from 'vitest';
import { createDefaultPlayerStats, createUpgrades, type PlayerStats } from './Upgrades';

/** The real shieldBarrier upgrade, levelled 1..level the way GameScene does it. */
function applyToLevel(level: number, paidCapacity = 0): PlayerStats {
  const stats = createDefaultPlayerStats();
  stats.maxShieldCharges += paidCapacity;  // GameScene.ts:854 — Barrier Capacity
  const barrier = createUpgrades().find((upgrade) => upgrade.id === 'shieldBarrier');
  if (!barrier) throw new Error('no such upgrade: shieldBarrier');
  for (let current = 1; current <= level; current++) barrier.apply(stats, current);
  return stats;
}

describe('shieldBarrier charge progression', () => {
  // The balance this upgrade has always had. apply() is additive now, so an
  // off-by-one here would silently inflate every barrier in the game.
  test.each([
    [1, 1], [2, 1], [3, 1], [4, 1], [5, 1],
    [6, 2], [7, 3], [8, 4], [9, 5], [10, 6],
  ])('level %i grants %i charges with no Barrier Capacity', (level, expected) => {
    expect(applyToLevel(level).maxShieldCharges).toBe(expected);
  });

  test('levels 1-5 buy recharge speed, not charges', () => {
    expect(applyToLevel(1).shieldRechargeTime).toBe(8.0);
    expect(applyToLevel(5).shieldRechargeTime).toBe(3.0);
    expect(applyToLevel(10).shieldRechargeTime).toBe(3.0);
  });
});

describe('BUG-META-BARRIER-CAPACITY-DEAD', () => {
  // Math.max used to clamp the total to the level's own count, so a maxed Barrier
  // Capacity bought nothing at all from level 8 up.
  test('Barrier Capacity adds to the levelled barrier instead of being swallowed', () => {
    expect(applyToLevel(1, 4).maxShieldCharges).toBe(5);
    expect(applyToLevel(10, 4).maxShieldCharges).toBe(10);
  });

  test('a paid barrier is filled, not left empty', () => {
    expect(applyToLevel(1, 4).shieldCharges).toBe(5);
  });

  test('Barrier Capacity alone leaves the levelled progression untouched', () => {
    expect(applyToLevel(10, 0).maxShieldCharges).toBe(6);
  });
});
