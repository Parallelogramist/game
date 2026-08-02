import { describe, test, expect } from 'vitest';
import {
  expireTimedStatBuffs,
  normalizeTimedStatBuffs,
  applyFieldBoost,
  buildTimedBuffRows,
  type TimedStatBuff,
  type TimedStatField,
} from './TimedStatBuffs';

describe('expireTimedStatBuffs', () => {
  test('keeps every buff and reverts nothing when none have expired', () => {
    const buffs: TimedStatBuff[] = [{ stat: 'damageMultiplier', magnitude: 2, expiresAt: 10 }];

    const { active, revertByStat } = expireTimedStatBuffs(buffs, 5);

    expect(active).toEqual(buffs);
    expect(revertByStat).toEqual({});
  });

  test('reverts a buff exactly at its expiry time (gameTime >= expiresAt)', () => {
    const buffs: TimedStatBuff[] = [{ stat: 'damageMultiplier', magnitude: 2, expiresAt: 8 }];

    const { active, revertByStat } = expireTimedStatBuffs(buffs, 8);

    expect(active).toEqual([]);
    expect(revertByStat).toEqual({ damageMultiplier: 2 });
  });

  test('groups the revert divisor per stat field', () => {
    const buffs: TimedStatBuff[] = [
      { stat: 'xpMultiplier', magnitude: 2, expiresAt: 8 },
      { stat: 'gemValueMultiplier', magnitude: 3, expiresAt: 9 },
    ];

    const { active, revertByStat } = expireTimedStatBuffs(buffs, 9);

    expect(active).toEqual([]);
    expect(revertByStat).toEqual({ xpMultiplier: 2, gemValueMultiplier: 3 });
  });

  test('multiplies the divisors of same-stat buffs that expire together', () => {
    const buffs: TimedStatBuff[] = [
      { stat: 'damageMultiplier', magnitude: 2, expiresAt: 8 },
      { stat: 'damageMultiplier', magnitude: 3, expiresAt: 9 },
    ];

    const { active, revertByStat } = expireTimedStatBuffs(buffs, 9);

    expect(active).toEqual([]);
    expect(revertByStat).toEqual({ damageMultiplier: 6 });
  });

  test('expires only the elapsed buff and leaves the rest active', () => {
    const buffs: TimedStatBuff[] = [
      { stat: 'xpMultiplier', magnitude: 2, expiresAt: 8 },
      { stat: 'gemValueMultiplier', magnitude: 3, expiresAt: 20 },
    ];

    const { active, revertByStat } = expireTimedStatBuffs(buffs, 10);

    expect(active).toEqual([{ stat: 'gemValueMultiplier', magnitude: 3, expiresAt: 20 }]);
    expect(revertByStat).toEqual({ xpMultiplier: 2 });
  });

  test('returns an empty revert map for an empty buff list', () => {
    const { active, revertByStat } = expireTimedStatBuffs([], 100);

    expect(active).toEqual([]);
    expect(revertByStat).toEqual({});
  });
});

describe('normalizeTimedStatBuffs', () => {
  test('defaults a missing stat to damageMultiplier (legacy save compat)', () => {
    const restored = normalizeTimedStatBuffs([{ magnitude: 2, expiresAt: 8 }]);

    expect(restored).toEqual([{ stat: 'damageMultiplier', magnitude: 2, expiresAt: 8 }]);
  });

  test('preserves an explicit stat field', () => {
    const restored = normalizeTimedStatBuffs([{ stat: 'xpMultiplier', magnitude: 2, expiresAt: 8 }]);

    expect(restored).toEqual([{ stat: 'xpMultiplier', magnitude: 2, expiresAt: 8 }]);
  });

  test('returns an empty list for undefined input', () => {
    expect(normalizeTimedStatBuffs(undefined)).toEqual([]);
  });
});

describe('applyFieldBoost', () => {
  test('adds a new buff and tells the caller to multiply the stat', () => {
    const { buffs, applied } = applyFieldBoost([], 'moveSpeed', 1.4, 12, 100);

    expect(applied).toBe(true);
    expect(buffs).toEqual([{ stat: 'moveSpeed', magnitude: 1.4, expiresAt: 112 }]);
  });

  test('refreshes an identical boost instead of stacking a second multiply', () => {
    const existing: TimedStatBuff[] = [{ stat: 'moveSpeed', magnitude: 1.4, expiresAt: 112 }];

    const { buffs, applied } = applyFieldBoost(existing, 'moveSpeed', 1.4, 12, 108);

    expect(applied).toBe(false);
    expect(buffs).toEqual([{ stat: 'moveSpeed', magnitude: 1.4, expiresAt: 120 }]);
  });

  test('does not refresh a same-stat buff of a different magnitude', () => {
    const shrineBuff: TimedStatBuff[] = [{ stat: 'damageMultiplier', magnitude: 2, expiresAt: 108 }];

    const { buffs, applied } = applyFieldBoost(shrineBuff, 'damageMultiplier', 1.5, 20, 100);

    expect(applied).toBe(true);
    expect(buffs).toEqual([
      { stat: 'damageMultiplier', magnitude: 2, expiresAt: 108 },
      { stat: 'damageMultiplier', magnitude: 1.5, expiresAt: 120 },
    ]);
  });

  test('stacks boosts on different stats', () => {
    const existing: TimedStatBuff[] = [{ stat: 'xpMultiplier', magnitude: 2, expiresAt: 115 }];

    const { buffs, applied } = applyFieldBoost(existing, 'gemValueMultiplier', 2, 15, 100);

    expect(applied).toBe(true);
    expect(buffs).toHaveLength(2);
  });

  test('never mutates the list it was given', () => {
    const existing: TimedStatBuff[] = [{ stat: 'moveSpeed', magnitude: 1.4, expiresAt: 112 }];

    applyFieldBoost(existing, 'moveSpeed', 1.4, 12, 108);

    expect(existing).toEqual([{ stat: 'moveSpeed', magnitude: 1.4, expiresAt: 112 }]);
  });
});

describe('buildTimedBuffRows', () => {
  test('folds every live buff on one stat into a single combined row', () => {
    const buffs: TimedStatBuff[] = [
      { stat: 'damageMultiplier', magnitude: 2, expiresAt: 110 },
      { stat: 'damageMultiplier', magnitude: 1.5, expiresAt: 120 },
    ];
    const rows = buildTimedBuffRows(buffs, 100, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].stat).toBe('damageMultiplier');
    expect(rows[0].magnitude).toBe(3);
    expect(rows[0].secondsRemaining).toBe(10);
  });

  test('orders rows by the fixed strip order, not by expiry', () => {
    const buffs: TimedStatBuff[] = [
      { stat: 'gemValueMultiplier', magnitude: 2, expiresAt: 105 },
      { stat: 'damageMultiplier', magnitude: 2, expiresAt: 130 },
    ];
    const rows = buildTimedBuffRows(buffs, 100, {});
    expect(rows.map((row) => row.stat)).toEqual(['damageMultiplier', 'gemValueMultiplier']);
  });

  test('drops a stat whose buffs have all expired and forgets its peak', () => {
    const peaks: Partial<Record<TimedStatField, number>> = {};
    const buffs: TimedStatBuff[] = [{ stat: 'xpMultiplier', magnitude: 2, expiresAt: 110 }];
    expect(buildTimedBuffRows(buffs, 100, peaks)).toHaveLength(1);
    expect(peaks.xpMultiplier).toBe(10);
    expect(buildTimedBuffRows(buffs, 110, peaks)).toEqual([]);
    expect(peaks.xpMultiplier).toBeUndefined();
  });

  test('the bar drains from full and never exceeds full', () => {
    const peaks: Partial<Record<TimedStatField, number>> = {};
    const buffs: TimedStatBuff[] = [{ stat: 'moveSpeed', magnitude: 1.4, expiresAt: 112 }];
    expect(buildTimedBuffRows(buffs, 100, peaks)[0].remainingFraction).toBe(1);
    expect(buildTimedBuffRows(buffs, 106, peaks)[0].remainingFraction).toBe(0.5);
  });

  test('a refreshed buff re-widens the bar instead of pinning it below full', () => {
    const peaks: Partial<Record<TimedStatField, number>> = {};
    const held: TimedStatBuff[] = [{ stat: 'moveSpeed', magnitude: 1.4, expiresAt: 112 }];
    buildTimedBuffRows(held, 100, peaks);
    expect(buildTimedBuffRows(held, 108, peaks)[0].remainingFraction).toBeCloseTo(1 / 3, 5);
    const refreshed = applyFieldBoost(held, 'moveSpeed', 1.4, 12, 108).buffs;
    expect(buildTimedBuffRows(refreshed, 108, peaks)[0].remainingFraction).toBe(1);
  });

  test('an empty buff list clears every remembered peak', () => {
    const peaks: Partial<Record<TimedStatField, number>> = { damageMultiplier: 20 };
    expect(buildTimedBuffRows([], 100, peaks)).toEqual([]);
    expect(peaks.damageMultiplier).toBeUndefined();
  });
});
