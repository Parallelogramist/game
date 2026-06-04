import { describe, test, expect } from 'vitest';
import { expireTimedDamageBuffs, type TimedDamageBuff } from './TimedDamageBuffs';

describe('expireTimedDamageBuffs', () => {
  test('keeps every buff and reverts nothing when none have expired', () => {
    const buffs: TimedDamageBuff[] = [{ magnitude: 2, expiresAt: 10 }];

    const { active, revertDivisor } = expireTimedDamageBuffs(buffs, 5);

    expect(active).toEqual(buffs);
    expect(revertDivisor).toBe(1);
  });

  test('reverts a buff exactly at its expiry time (gameTime >= expiresAt)', () => {
    const buffs: TimedDamageBuff[] = [{ magnitude: 2, expiresAt: 8 }];

    const { active, revertDivisor } = expireTimedDamageBuffs(buffs, 8);

    expect(active).toEqual([]);
    expect(revertDivisor).toBe(2);
  });

  test('multiplies the divisors of all simultaneously-expired buffs', () => {
    const buffs: TimedDamageBuff[] = [
      { magnitude: 2, expiresAt: 8 },
      { magnitude: 3, expiresAt: 9 },
    ];

    const { active, revertDivisor } = expireTimedDamageBuffs(buffs, 9);

    expect(active).toEqual([]);
    expect(revertDivisor).toBe(6);
  });

  test('expires only the elapsed buff and leaves the rest active', () => {
    const buffs: TimedDamageBuff[] = [
      { magnitude: 2, expiresAt: 8 },
      { magnitude: 2, expiresAt: 20 },
    ];

    const { active, revertDivisor } = expireTimedDamageBuffs(buffs, 10);

    expect(active).toEqual([{ magnitude: 2, expiresAt: 20 }]);
    expect(revertDivisor).toBe(2);
  });

  test('returns an identity divisor for an empty buff list', () => {
    const { active, revertDivisor } = expireTimedDamageBuffs([], 100);

    expect(active).toEqual([]);
    expect(revertDivisor).toBe(1);
  });
});
