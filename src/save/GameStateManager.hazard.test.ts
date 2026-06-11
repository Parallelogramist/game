import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag } from '../ecs/components';
import type { PlayerStats } from '../data/Upgrades';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage (mirrors the shrine persistence test).
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

type HazardState = {
  zones: {
    type: string;
    x: number;
    y: number;
    radius: number;
    duration: number;
    maxDuration: number;
  }[];
  spawnTimer: number;
  nextSpawnInterval: number;
};

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  hazardState?: HazardState,
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
    hazardState,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager hazard persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips active hazard zones + spawner pacing across save/load', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const hazardState: HazardState = {
      zones: [
        { type: 'burn', x: 300, y: 200, radius: 70, duration: 3.5, maxDuration: 6 },
        { type: 'ice', x: 640, y: 360, radius: 65, duration: 7, maxDuration: 7 },
        { type: 'energy', x: 900, y: 500, radius: 55, duration: 1.2, maxDuration: 10 },
      ],
      spawnTimer: 4.25,
      nextSpawnInterval: 9.5,
    };

    getGameStateManager().save(makeSaveData(world, playerId, hazardState));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    // Active zones (type, position, size, remaining/max lifetime) and the
    // spawner pacing must survive a refresh, not despawn and restart the clock.
    expect(loaded!.hazardState).toEqual(hazardState);
  });

  test('round-trips an empty field with a mid-cooldown spawn timer', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const hazardState: HazardState = { zones: [], spawnTimer: 2.75, nextSpawnInterval: 11 };

    getGameStateManager().save(makeSaveData(world, playerId, hazardState));
    const loaded = getGameStateManager().load();

    expect(loaded!.hazardState).toEqual(hazardState);
  });

  test('a save written without hazard state restores undefined (backward compatible)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.hazardState).toBeUndefined();
  });
});
