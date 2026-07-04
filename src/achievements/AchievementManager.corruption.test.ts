import { describe, test, expect, beforeEach } from 'vitest';

// In-memory stand-in for the encrypted storage so state round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one. The raw map is exposed
// so tests can inject corrupt/tampered payloads and inspect persistence.
import { vi } from 'vitest';
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import { AchievementManager } from './AchievementManager';
import type { RunEndData } from './AchievementTypes';

const STORAGE_KEY = 'survivor-achievements';

/**
 * Seed the store with a RAW string, then construct a fresh manager so it loads
 * that payload. Raw (not JSON.stringify) because the interesting tamper vectors
 * are exactly the values JSON.stringify mangles: it turns NaN/Infinity into
 * `null`, so a literal `1e999` (which JSON.parse reads back as Infinity) or a
 * non-numeric field must be injected by hand to reach the load path.
 */
function loadFrom(raw: string): AchievementManager {
  SecureStorage.setItem(STORAGE_KEY, raw);
  return new AchievementManager();
}

/** Minimal valid RunEndData; override only the fields a test cares about. */
function makeRunEnd(overrides: Partial<RunEndData> = {}): RunEndData {
  return {
    wasVictory: false,
    killCount: 0,
    levelReached: 1,
    survivalTimeSeconds: 10,
    worldLevel: 1,
    damageDealt: 0,
    damageTaken: 5,
    goldEarned: 0,
    ...overrides,
  };
}

describe('AchievementManager — corruption / tamper resilience', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  // SecureStorage is the anti-cheat layer, so a corrupt/tampered payload is the
  // threat model. The un-hardened load() spread `...parsed.lifetimeStats` /
  // `...parsed.achievements` straight over defaults: a non-numeric field leaked
  // through, and since recordRunEnd does `stats.totalKills += ...`, a NaN/string
  // value poisons the persisted total FOREVER (string-concat or NaN), and every
  // `currentValue >= targetValue` comparison goes false → achievements bricked.
  // The same totals feed HiddenUnlocks predicates (spurious or dead unlocks) and
  // the Achievement/Leaderboard UI (renders "NaN").

  // ── lifetimeStats: numeric coercion ──

  test('a non-numeric string lifetime stat is coerced to 0 (finite, not a string)', () => {
    const manager = loadFrom('{"lifetimeStats":{"totalKills":"abc","totalBossesKilled":"xyz"}}');
    const stats = manager.getLifetimeStats();
    expect(stats.totalKills).toBe(0);
    expect(stats.totalBossesKilled).toBe(0);
    expect(Number.isFinite(stats.totalKills)).toBe(true);
    expect(typeof stats.totalKills).toBe('number');
  });

  test('an object / array lifetime stat value is coerced to its default', () => {
    const manager = loadFrom('{"lifetimeStats":{"totalKills":{},"totalVictories":[1,2]}}');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
    expect(manager.getLifetimeStats().totalVictories).toBe(0);
  });

  test('an Infinity (1e999) counter is rejected to 0, not granted as a huge total', () => {
    // JSON.parse reads 1e999 back as Infinity — a real overflow tamper vector
    // that would spuriously satisfy every lifetime HiddenUnlock predicate.
    const manager = loadFrom('{"lifetimeStats":{"totalKills":1e999,"totalDamageDealt":1e999}}');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
    expect(manager.getLifetimeStats().totalDamageDealt).toBe(0);
  });

  test('a negative lifetime counter is clamped to 0', () => {
    const manager = loadFrom('{"lifetimeStats":{"totalKills":-5,"totalVictories":-1}}');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
    expect(manager.getLifetimeStats().totalVictories).toBe(0);
  });

  test('a null lifetime field falls back to its default', () => {
    const manager = loadFrom('{"lifetimeStats":{"totalKills":null,"highestLevel":null}}');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
    expect(manager.getLifetimeStats().highestLevel).toBe(0);
  });

  test('a fractional counter is floored; a fractional non-counter (damage/time) is preserved', () => {
    const manager = loadFrom(
      '{"lifetimeStats":{"totalKills":3.9,"totalDamageDealt":1234.5,"totalTimePlayedSeconds":61.25}}'
    );
    expect(manager.getLifetimeStats().totalKills).toBe(3); // counter floored
    expect(manager.getLifetimeStats().totalDamageDealt).toBe(1234.5); // fractional preserved
    expect(manager.getLifetimeStats().totalTimePlayedSeconds).toBe(61.25);
  });

  test('fastestVictorySeconds keeps Infinity as its "no victory yet" sentinel and a real time', () => {
    // Infinity is the legitimate default; a real fastest time must survive, while
    // garbage / -Infinity must fall back to Infinity (not 0, which would wrongly
    // read as "fastest = 0s" and block all future fastest records).
    expect(loadFrom('{"lifetimeStats":{"fastestVictorySeconds":1e999}}').getLifetimeStats().fastestVictorySeconds).toBe(Infinity);
    expect(loadFrom('{"lifetimeStats":{"fastestVictorySeconds":123.5}}').getLifetimeStats().fastestVictorySeconds).toBe(123.5);
    expect(loadFrom('{"lifetimeStats":{"fastestVictorySeconds":"abc"}}').getLifetimeStats().fastestVictorySeconds).toBe(Infinity);
    expect(loadFrom('{"lifetimeStats":{"fastestVictorySeconds":-1e999}}').getLifetimeStats().fastestVictorySeconds).toBe(Infinity);
  });

  test('a non-object lifetimeStats payload degrades to all defaults (finite)', () => {
    for (const raw of ['{"lifetimeStats":"abcdef"}', '{"lifetimeStats":[1,2,3]}', '{"lifetimeStats":42}']) {
      const stats = loadFrom(raw).getLifetimeStats();
      expect(stats.totalKills).toBe(0);
      expect(stats.fastestVictorySeconds).toBe(Infinity);
      expect(Number.isFinite(stats.totalDamageDealt)).toBe(true);
    }
  });

  test('an unknown injected lifetime key is dropped (rebuilt from known fields only)', () => {
    const stats = loadFrom('{"lifetimeStats":{"__junk":999999,"totalKills":3}}').getLifetimeStats();
    expect('__junk' in stats).toBe(false);
    expect(stats.totalKills).toBe(3);
  });

  // ── achievements: boolean / key hardening ──

  test('a truthy non-boolean isUnlocked ("yes") does NOT count as unlocked', () => {
    // Old code filtered by truthiness, so a tampered string faked an unlock and
    // inflated completion % (and could re-deliver the reward).
    const manager = loadFrom(
      '{"achievements":{"lifetime_kills_100":{"id":"lifetime_kills_100","currentValue":0,"isUnlocked":"yes","rewardClaimed":true}}}'
    );
    expect(manager.getAchievementProgress('lifetime_kills_100')?.isUnlocked).toBe(false);
    expect(manager.getUnlockedAchievements().some((a) => a.id === 'lifetime_kills_100')).toBe(false);
    expect(manager.getAchievementCompletionPercent()).toBe(0);
  });

  test('a junk achievement id is dropped, not retained or counted', () => {
    const manager = loadFrom(
      '{"achievements":{"__hack":{"id":"__hack","isUnlocked":true,"rewardClaimed":true},"lifetime_kills_100":{"id":"lifetime_kills_100","currentValue":0,"isUnlocked":false,"rewardClaimed":false}}}'
    );
    expect(manager.getAchievementProgress('__hack')).toBeUndefined();
    expect(manager.getAchievementCompletionPercent()).toBe(0);
  });

  test('a non-object achievements payload degrades to defaults without throwing', () => {
    expect(() => loadFrom('{"achievements":"abcdef"}')).not.toThrow();
    const manager = loadFrom('{"achievements":[1,2,3]}');
    expect(manager.getAchievementCompletionPercent()).toBe(0);
    expect(manager.getAchievementProgress('lifetime_kills_100')?.currentValue).toBe(0);
    expect(manager.getAchievementProgress('lifetime_kills_100')?.isUnlocked).toBe(false);
  });

  test('a non-numeric achievement currentValue is coerced to 0', () => {
    const manager = loadFrom(
      '{"achievements":{"lifetime_kills_100":{"id":"lifetime_kills_100","currentValue":"NaN-ish","isUnlocked":false,"rewardClaimed":false}}}'
    );
    expect(manager.getAchievementProgress('lifetime_kills_100')?.currentValue).toBe(0);
  });

  // ── top-level payload guards ──

  test('a "null" payload loads defaults without throwing', () => {
    expect(() => loadFrom('null')).not.toThrow();
    const manager = loadFrom('null');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
    expect(manager.getAchievementCompletionPercent()).toBe(0);
  });

  test('an array payload loads defaults without throwing', () => {
    const manager = loadFrom('[1,2,3]');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
    expect(manager.getLifetimeStats().fastestVictorySeconds).toBe(Infinity);
  });

  test('a primitive (number) payload loads defaults', () => {
    const manager = loadFrom('42');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
  });

  test('non-JSON garbage loads defaults without throwing', () => {
    expect(() => loadFrom('{not valid json')).not.toThrow();
    expect(loadFrom('{not valid json').getLifetimeStats().totalKills).toBe(0);
  });

  test('an empty object loads defaults', () => {
    const manager = loadFrom('{}');
    expect(manager.getLifetimeStats().totalKills).toBe(0);
    expect(manager.getLifetimeStats().fastestVictorySeconds).toBe(Infinity);
  });

  // ── regression: the brick the hardening prevents ──

  test('a tampered string totalKills no longer bricks kill achievements (un-brick)', () => {
    // Pre-fix: loaded totalKills = "abc", then recordRunEnd does
    // `"abc" += 100` → "abc100" (string), and `"abc100" >= 100` is false, so the
    // kill achievement could never unlock and the UI showed a garbage total.
    const manager = loadFrom('{"lifetimeStats":{"totalKills":"abc"}}');
    for (let i = 0; i < 100; i++) manager.recordKill();
    manager.recordRunEnd(makeRunEnd({ killCount: 100 }));
    expect(manager.getLifetimeStats().totalKills).toBe(100);
    expect(manager.getAchievementProgress('lifetime_kills_100')?.isUnlocked).toBe(true);
  });
});

describe('AchievementManager — characterization (existing contract)', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('a fresh manager with no storage starts at default lifetime stats', () => {
    const manager = new AchievementManager();
    const stats = manager.getLifetimeStats();
    expect(stats.totalKills).toBe(0);
    expect(stats.totalVictories).toBe(0);
    expect(stats.fastestVictorySeconds).toBe(Infinity);
    expect(manager.getAchievementCompletionPercent()).toBe(0);
    expect(manager.getUnlockedAchievements()).toHaveLength(0);
  });

  test('a valid unlocked achievement round-trips unchanged (incl. pending reward)', () => {
    const manager = loadFrom(
      '{"achievements":{"lifetime_kills_100":{"id":"lifetime_kills_100","currentValue":150,"isUnlocked":true,"unlockedAt":12345,"rewardClaimed":false}}}'
    );
    const progress = manager.getAchievementProgress('lifetime_kills_100');
    expect(progress?.isUnlocked).toBe(true);
    expect(progress?.currentValue).toBe(150);
    expect(progress?.unlockedAt).toBe(12345);
    expect(progress?.rewardClaimed).toBe(false);
    // A genuinely-unlocked but unclaimed achievement is still claimable.
    expect(manager.getUnclaimedRewards().some((a) => a.id === 'lifetime_kills_100')).toBe(true);
    expect(manager.getAchievementCompletionPercent()).toBeGreaterThan(0);
  });

  test('lifetime stats persist across a reload (save → load round-trip)', () => {
    const manager = new AchievementManager();
    for (let i = 0; i < 100; i++) manager.recordKill();
    manager.recordRunEnd(makeRunEnd({ killCount: 100 }));
    const reloaded = new AchievementManager();
    expect(reloaded.getLifetimeStats().totalKills).toBe(100);
    expect(reloaded.getAchievementProgress('lifetime_kills_100')?.isUnlocked).toBe(true);
  });

  test('fastestVictorySeconds survives a loss-then-reload (null sentinel → Infinity) so a later victory still records', () => {
    // JSON.stringify(Infinity) === "null"; the sanitizer restores Infinity, so a
    // saved loss does not wrongly bake fastest = 0/null and block future records.
    const first = new AchievementManager();
    first.recordRunEnd(makeRunEnd({ wasVictory: false, survivalTimeSeconds: 60 }));
    const reloaded = new AchievementManager();
    expect(reloaded.getLifetimeStats().fastestVictorySeconds).toBe(Infinity);
    reloaded.recordRunEnd(makeRunEnd({ wasVictory: true, survivalTimeSeconds: 120, damageTaken: 1 }));
    expect(reloaded.getLifetimeStats().fastestVictorySeconds).toBe(120);
  });

  test('getLifetimeStats returns a copy — mutating it does not corrupt internal state', () => {
    const manager = new AchievementManager();
    const stats = manager.getLifetimeStats();
    stats.totalKills = 999999;
    expect(manager.getLifetimeStats().totalKills).toBe(0);
  });
});

describe('AchievementManager — collection milestones + menu-context delivery', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('recordCardsDiscovered unlocks the crossed tiers from an absolute count', () => {
    const manager = new AchievementManager();
    manager.recordCardsDiscovered(1);
    expect(manager.getAchievementProgress('cards_discovered_1')?.isUnlocked).toBe(true);
    expect(manager.getAchievementProgress('cards_discovered_6')?.isUnlocked).toBe(false);

    // Jumping past several tiers (entry sync after a pre-milestone collection)
    // unlocks everything crossed.
    manager.recordCardsDiscovered(12);
    expect(manager.getAchievementProgress('cards_discovered_6')?.isUnlocked).toBe(true);
    expect(manager.getAchievementProgress('cards_discovered_12')?.isUnlocked).toBe(true);
    expect(manager.getAchievementProgress('cards_discovered_24')?.isUnlocked).toBe(false);
  });

  test('collection progress persists across a reload', () => {
    const manager = new AchievementManager();
    manager.recordCardsDiscovered(3);
    const reloaded = new AchievementManager();
    expect(reloaded.getAchievementProgress('cards_discovered_1')?.isUnlocked).toBe(true);
    expect(reloaded.getAchievementProgress('cards_discovered_6')?.currentValue).toBe(3);
  });

  test('an unlock with NO callback wired banks the reward as unclaimed', () => {
    // Menu-context safety: with no delivery callback the gold must not be
    // auto-claimed into the void — AchievementScene retro-claims it later.
    const manager = new AchievementManager();
    manager.recordCardsDiscovered(1);
    expect(manager.getUnclaimedRewards().some((a) => a.id === 'cards_discovered_1')).toBe(true);
  });

  test('an unlock WITH a callback wired auto-claims (callback delivers)', () => {
    const manager = new AchievementManager();
    const delivered: string[] = [];
    manager.setAchievementUnlockCallback((achievement) => delivered.push(achievement.id));
    manager.recordCardsDiscovered(1);
    expect(delivered).toEqual(['cards_discovered_1']);
    expect(manager.getUnclaimedRewards().some((a) => a.id === 'cards_discovered_1')).toBe(false);

    // Detaching restores the banking behavior for later unlocks.
    manager.setAchievementUnlockCallback(null);
    manager.recordCardsDiscovered(6);
    expect(manager.getUnclaimedRewards().some((a) => a.id === 'cards_discovered_6')).toBe(true);
  });
});
