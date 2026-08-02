import { describe, expect, it } from 'vitest';
import { TUNING } from '../data/GameTuning';
import {
  countFelledWardens, describeWardenRoster, isWardenFelled, WARDEN_MASK_ALL, WARDEN_ROSTER_SIZE,
  wardenBossIdForWorld, wardenBossNameForWorld, wardenFelledBit,
} from './wardenIdentity';

describe('wardenBossIdForWorld', () => {
  it('is stable for a world and always names a boss in the rotation order', () => {
    for (let seed = 20260727; seed < 20260727 + 200; seed++) {
      const first = wardenBossIdForWorld(seed, 1);
      expect(TUNING.bosses.order).toContain(first);
      expect(wardenBossIdForWorld(seed, 1)).toBe(first);
    }
  });

  it('spreads across the whole roster rather than favouring one boss', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) seen.add(wardenBossIdForWorld(seed, 1));
    expect(seen.size).toBe(TUNING.bosses.order.length);
  });

  it('names the boss it picked', () => {
    const name = wardenBossNameForWorld(20260727, 1);
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe('undefined');
  });
});

describe('the warden roster mask', () => {
  it('gives every boss in the rotation its own bit and an unknown id none', () => {
    const bits = TUNING.bosses.order.map(wardenFelledBit);
    expect(new Set(bits).size).toBe(TUNING.bosses.order.length);
    expect(bits.every(bit => bit !== 0)).toBe(true);
    expect(wardenFelledBit('not_a_boss')).toBe(0);
    expect(isWardenFelled(WARDEN_MASK_ALL, 'not_a_boss')).toBe(false);
  });

  it('counts only the twelve roster bits, whatever else a stored mask carries', () => {
    expect(countFelledWardens(0)).toBe(0);
    expect(countFelledWardens(WARDEN_MASK_ALL)).toBe(WARDEN_ROSTER_SIZE);
    expect(countFelledWardens(WARDEN_MASK_ALL | (1 << 20))).toBe(WARDEN_ROSTER_SIZE);
    expect(countFelledWardens(wardenFelledBit(TUNING.bosses.order[3]))).toBe(1);
  });

  it('describes all twelve and marks exactly the felled one', () => {
    const rows = describeWardenRoster(wardenFelledBit(TUNING.bosses.order[5]));
    expect(rows).toHaveLength(WARDEN_ROSTER_SIZE);
    expect(rows.filter(row => row.felled).map(row => row.bossTypeId))
      .toEqual([TUNING.bosses.order[5]]);
    expect(rows.every(row => row.name.length > 0)).toBe(true);
  });
});
