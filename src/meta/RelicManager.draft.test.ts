import { describe, test, expect, afterEach, vi } from 'vitest';
import { RelicManager } from './RelicManager';
import { rarityAtLeast } from '../data/Relics';
import { PlayerStats } from '../data/Upgrades';

// Minimal PlayerStats stub: the draft methods only read `luck` and hand `stats`
// to relic.apply(); these tests assert only relic identity/rarity, so the
// apply-side arithmetic on absent fields is irrelevant to the assertions.
function makeStats(luck = 0): PlayerStats {
  return { luck } as unknown as PlayerStats;
}

describe('RelicManager relic draft (FEAT-RELIC-DRAFT)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rollRelicChoices returns the requested count of DISTINCT relics', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const manager = new RelicManager();
    manager.reset();
    const choices = manager.rollRelicChoices(makeStats(0), 3);
    expect(choices).toHaveLength(3);
    const ids = choices.map((relic) => relic.id);
    expect(new Set(ids).size).toBe(3);
  });

  test('rollRelicChoices never offers an already-equipped relic', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    const manager = new RelicManager();
    manager.reset();
    const stats = makeStats(0);
    const firstChoice = manager.rollRelicChoices(stats, 1)[0];
    manager.equipDraftedRelic(firstChoice, stats);
    for (let i = 0; i < 20; i++) {
      const choices = manager.rollRelicChoices(stats, 3);
      expect(choices.every((relic) => relic.id !== firstChoice.id)).toBe(true);
    }
  });

  test('after a sub-floor streak, every draft choice is epic-or-better (pity)', () => {
    // Math.random ~0 makes each weighted pick take the first eligible relic;
    // RELICS lists commons first, so the first three drafted+equipped relics are
    // sub-epic and the streak reaches RELIC_PITY_THRESHOLD (3).
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    const manager = new RelicManager();
    manager.reset();
    const stats = makeStats(0);
    for (let i = 0; i < 3; i++) {
      const pick = manager.rollRelicChoices(stats, 1)[0];
      manager.equipDraftedRelic(pick, stats);
    }
    const flooredChoices = manager.rollRelicChoices(stats, 3);
    expect(flooredChoices.length).toBeGreaterThan(0);
    expect(flooredChoices.every((relic) => rarityAtLeast(relic.rarity, 'epic'))).toBe(true);
  });

  test('equipDraftedRelic equips the chosen relic and resets pity on an epic+ pick', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    const manager = new RelicManager();
    manager.reset();
    const stats = makeStats(0);
    // Build a sub-floor streak of 3 so the next choices are pity-floored to epic+.
    for (let i = 0; i < 3; i++) {
      manager.equipDraftedRelic(manager.rollRelicChoices(stats, 1)[0], stats);
    }
    const epicChoice = manager.rollRelicChoices(stats, 1)[0];
    const equipped = manager.equipDraftedRelic(epicChoice, stats);
    expect(equipped).not.toBeNull();
    expect(rarityAtLeast(equipped!.rarity, 'epic')).toBe(true);
    expect(manager.hasRelic(epicChoice.id)).toBe(true);
    // Streak reset by the epic pick: the next draft is NOT floored, so a
    // Math.random~0 roll yields the first eligible (sub-epic) relic again.
    const afterReset = manager.rollRelicChoices(stats, 1)[0];
    expect(rarityAtLeast(afterReset.rarity, 'epic')).toBe(false);
  });
});
