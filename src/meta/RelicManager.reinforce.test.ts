import { describe, test, expect, afterEach, vi } from 'vitest';
import { RelicManager, MAX_RELIC_RANK, relicRankNumeral } from './RelicManager';
import { RELICS } from '../data/Relics';
import { createDefaultPlayerStats } from '../data/Upgrades';

const LUCKY_CHARM = RELICS.find((relic) => relic.id === 'relic_lucky_charm')!;

describe('RelicManager reinforce (FEAT-RELIC-REINFORCE)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('equipRelic seeds rank 1 and reinforceRelic raises it', () => {
    const manager = new RelicManager();
    manager.reset();
    const stats = createDefaultPlayerStats();
    manager.equipRelic(LUCKY_CHARM, stats);
    expect(manager.getRelicRank(LUCKY_CHARM.id)).toBe(1);
    expect(manager.reinforceRelic(LUCKY_CHARM, stats)).toBe(2);
    expect(manager.getRelicRank(LUCKY_CHARM.id)).toBe(2);
    expect(relicRankNumeral(2)).toBe('II');
  });

  test('reinforceRelic re-applies the relic effect', () => {
    const manager = new RelicManager();
    manager.reset();
    const stats = createDefaultPlayerStats();
    const luckBefore = stats.luck;
    manager.equipRelic(LUCKY_CHARM, stats);
    manager.reinforceRelic(LUCKY_CHARM, stats);
    expect(stats.luck).toBeCloseTo(luckBefore + 0.2, 5);
  });

  test('reinforceRelic refuses past MAX_RELIC_RANK', () => {
    const manager = new RelicManager();
    manager.reset();
    const stats = createDefaultPlayerStats();
    manager.equipRelic(LUCKY_CHARM, stats);
    for (let rank = 1; rank < MAX_RELIC_RANK; rank++) {
      expect(manager.reinforceRelic(LUCKY_CHARM, stats)).toBe(rank + 1);
    }
    expect(manager.reinforceRelic(LUCKY_CHARM, stats)).toBeNull();
    expect(manager.getRelicRank(LUCKY_CHARM.id)).toBe(MAX_RELIC_RANK);
  });

  test('reinforceRelic refuses a relic that is not equipped', () => {
    const manager = new RelicManager();
    manager.reset();
    const stats = createDefaultPlayerStats();
    const luckBefore = stats.luck;
    expect(manager.reinforceRelic(LUCKY_CHARM, stats)).toBeNull();
    expect(manager.getRelicRank(LUCKY_CHARM.id)).toBe(0);
    expect(stats.luck).toBe(luckBefore);
  });

  test('reinforceChoices only offers uncapped equipped relics, capped at the choice count', () => {
    const manager = new RelicManager();
    manager.reset();
    const stats = createDefaultPlayerStats();
    const equipped = RELICS.slice(0, 6);
    for (const relic of equipped) manager.equipRelic(relic, stats);
    const maxedRelic = equipped[0];
    for (let rank = 1; rank < MAX_RELIC_RANK; rank++) {
      manager.reinforceRelic(maxedRelic, stats);
    }

    const choices = manager.reinforceChoices();
    expect(choices.length).toBeLessThanOrEqual(3);
    expect(choices.length).toBeGreaterThan(0);
    expect(new Set(choices.map((relic) => relic.id)).size).toBe(choices.length);
    for (const choice of choices) {
      expect(manager.hasRelic(choice.id)).toBe(true);
      expect(choice.id).not.toBe(maxedRelic.id);
      expect(manager.getRelicRank(choice.id)).toBeLessThan(MAX_RELIC_RANK);
    }

    for (const relic of equipped) {
      while (manager.reinforceRelic(relic, stats) !== null) { /* raise to cap */ }
    }
    expect(manager.reinforceChoices()).toEqual([]);
    expect(manager.hasReinforceCandidates()).toBe(false);
  });

  test('restoreFromSave clamps a tampered rank', () => {
    const manager = new RelicManager();
    manager.reset();
    manager.restoreFromSave([LUCKY_CHARM.id], { [LUCKY_CHARM.id]: 99 });
    expect(manager.getRelicRank(LUCKY_CHARM.id)).toBe(MAX_RELIC_RANK);
    manager.restoreFromSave([LUCKY_CHARM.id], { [LUCKY_CHARM.id]: 0 });
    expect(manager.getRelicRank(LUCKY_CHARM.id)).toBe(1);
  });
});
