import { describe, test, expect, afterEach, vi } from 'vitest';
import { RelicManager } from './RelicManager';
import { rarityAtLeast } from '../data/Relics';
import { PlayerStats } from '../data/Upgrades';

// Minimal PlayerStats stub: rollAndEquipRandomRelic only reads `luck` and hands
// `stats` to relic.apply(), which mutates arbitrary stat fields. These tests
// assert only the RARITY of granted relics, so the apply-side arithmetic (NaN
// on absent fields) is irrelevant to the assertions.
function makeStats(luck = 0): PlayerStats {
  return { luck } as unknown as PlayerStats;
}

describe('RelicManager pity (bad-luck protection)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('forces an epic-or-better relic after a sub-floor streak', () => {
    // Math.random ~0 makes the weighted pick always take the first eligible
    // relic; RELICS lists commons first, so the early grants are sub-epic and
    // the streak climbs until the pity floor kicks in on the 4th grant
    // (RELIC_PITY_THRESHOLD = 3).
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    const manager = new RelicManager();
    manager.reset();

    const stats = makeStats(0);
    const granted = [];
    for (let i = 0; i < 4; i++) {
      const relic = manager.rollAndEquipRandomRelic(stats);
      if (relic) granted.push(relic);
    }

    // First grant is a normal sub-epic roll (pity has not fired yet)...
    expect(rarityAtLeast(granted[0].rarity, 'epic')).toBe(false);
    // ...and the 4th grant is forced to the epic floor by pity.
    expect(rarityAtLeast(granted[3].rarity, 'epic')).toBe(true);
  });

  test('reset() clears the streak so a new run starts fresh', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    const manager = new RelicManager();
    manager.reset();
    const stats = makeStats(0);
    manager.rollAndEquipRandomRelic(stats);
    manager.rollAndEquipRandomRelic(stats);
    manager.rollAndEquipRandomRelic(stats);
    manager.reset();
    // After reset the streak is 0, so the next grant is a normal sub-epic roll,
    // not a pity-forced epic.
    const first = manager.rollAndEquipRandomRelic(stats);
    expect(first).not.toBeNull();
    expect(rarityAtLeast(first!.rarity, 'epic')).toBe(false);
  });
});
