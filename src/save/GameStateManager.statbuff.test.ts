import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag } from '../ecs/components';
import type { PlayerStats } from '../data/Upgrades';
import type { SerializedTimedStatBuff } from '../systems/TimedStatBuffs';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage (mirrors the consumable persistence test).
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

import { getGameStateManager } from './GameStateManager';

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  timedDamageBuffs?: SerializedTimedStatBuff[],
) {
  return {
    world,
    playerId,
    playerStats: { level: 1, currentHealth: 100, maxHealth: 100, damageMultiplier: 2 } as unknown as PlayerStats,
    gameTime: 5,
    killCount: 0,
    enemyCount: 0,
    spawnTimer: 0,
    spawnInterval: 1,
    magnetSpawnTimer: 0,
    treasureSpawnTimer: 0,
    gemMagnetTimer: 0,
    dashCooldownTimer: 0,
    damageCooldown: 0,
    bossSpawned: false,
    bossWarningPhase: 0,
    minibossSpawnTimes: [],
    banishedUpgradeIds: new Set<string>(),
    isAutoBuyEnabled: false,
    worldLevel: 0,
    worldLevelHealthMult: 1,
    worldLevelDamageMult: 1,
    worldLevelSpawnReduction: 0,
    worldLevelXPMult: 1,
    weapons: [],
    upgrades: [],
    twinLinks: [] as [number, number][],
    timedDamageBuffs,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager timed-stat-buff persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips a stat-keyed timed buff (xp / gem / damage) across save/load', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    const buffs: SerializedTimedStatBuff[] = [
      { stat: 'xpMultiplier', magnitude: 2, expiresAt: 14 },
      { stat: 'gemValueMultiplier', magnitude: 3, expiresAt: 14 },
      { stat: 'damageMultiplier', magnitude: 2, expiresAt: 12 },
    ];
    getGameStateManager().save(makeSaveData(world, playerId, buffs));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.timedDamageBuffs).toEqual(buffs);
  });

  test('round-trips a legacy damage buff entry that has no stat field', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    // Saves written before the system was generalised omit `stat`; the manager
    // passes the array through verbatim — GameScene's normalizer defaults the
    // missing stat to damageMultiplier on restore.
    getGameStateManager().save(makeSaveData(world, playerId, [{ magnitude: 2, expiresAt: 8 }]));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.timedDamageBuffs).toEqual([{ magnitude: 2, expiresAt: 8 }]);
  });

  test('a save with no timed buffs restores none (backward compatible)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.timedDamageBuffs).toBeUndefined();
  });
});
