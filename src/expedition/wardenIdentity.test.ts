import { describe, expect, it } from 'vitest';
import { TUNING } from '../data/GameTuning';
import { wardenBossIdForWorld, wardenBossNameForWorld } from './wardenIdentity';

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
