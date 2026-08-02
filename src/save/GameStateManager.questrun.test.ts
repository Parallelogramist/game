import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag } from '../ecs/components';
import type { PlayerStats } from '../data/Upgrades';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage (mirrors the other persistence tests).
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
import type { SerializedExpeditionState } from '../game/world/WorldModeAdapter';

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  expedition?: SerializedExpeditionState,
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
    expedition,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('quest run state persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips the dwell stamp, the siege cadence and the escort drone', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    getGameStateManager().save({
      ...makeSaveData(world, playerId, { cameraScrollX: 0, cameraScrollY: 0 }),
      questRunState: {
        dwellSectorKey: '3,4',
        dwellStartSeconds: 2,
        siegeSectorKey: '3,4',
        siegeNextWaveAtSeconds: 19,
        escortDrone: { questId: 'q_escort_01', x: 640, y: 480, health: 31 },
      },
    });

    const loaded = getGameStateManager().load();
    expect(loaded?.questRunState).toEqual({
      dwellSectorKey: '3,4',
      dwellStartSeconds: 2,
      siegeSectorKey: '3,4',
      siegeNextWaveAtSeconds: 19,
      escortDrone: { questId: 'q_escort_01', x: 640, y: 480, health: 31 },
    });
  });

  test('an arena save carries no quest run block', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    getGameStateManager().save(makeSaveData(world, playerId));

    expect(getGameStateManager().load()?.questRunState).toBeUndefined();
  });
});
