import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag } from '../ecs/components';
import type { PlayerStats } from '../data/Upgrades';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage (mirrors the hazard persistence test).
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
  ultimateCharge?: number,
) {
  return {
    world,
    playerId,
    playerStats: { level: 1, currentHealth: 100, maxHealth: 100 } as unknown as PlayerStats,
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
    ultimateCharge,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager ultimate-charge persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips a partial ultimate charge across save/load', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    // Regression lock: save() previously accepted ultimateCharge as a param but
    // never wrote it into the serialized state, so the Overdrive meter silently
    // emptied on every refresh despite restoreUltimateState reading the field.
    getGameStateManager().save(makeSaveData(world, playerId, 73));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.ultimateCharge).toBe(73);
  });

  test('round-trips a full ultimate charge across save/load', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId, 100));
    const loaded = getGameStateManager().load();

    expect(loaded!.ultimateCharge).toBe(100);
  });

  test('round-trips an empty meter as 0 (not collapsed to undefined)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId, 0));
    const loaded = getGameStateManager().load();

    expect(loaded!.ultimateCharge).toBe(0);
  });

  test('a save written without an ultimate charge restores undefined (legacy)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.ultimateCharge).toBeUndefined();
  });
});
