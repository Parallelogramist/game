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

describe('GameStateManager save dialects', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  // An arena run silently promoted to version 2 would be rejected wholesale by an older
  // client's validator ceiling, orphaning a mid-run save on any rollback. Nothing in the
  // type system or in play can catch that, which is why it is pinned here.
  test('an arena run still writes version 1 and carries no expedition keys', () => {
    const world = createWorld();
    getGameStateManager().save(makeSaveData(world, makePlayer(world)));

    const loaded = getGameStateManager().load();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.version).toBe(1);
    expect('runMode' in loaded).toBe(false);
    expect('expedition' in loaded).toBe(false);
  });

  test('an expedition run writes version 2 and round-trips the view state', () => {
    const world = createWorld();
    const expedition: SerializedExpeditionState = {
      cameraScrollX: 2560,
      cameraScrollY: 1440,
      sectorLockKey: '2,2',
    };
    getGameStateManager().save(makeSaveData(world, makePlayer(world), expedition));

    const loaded = getGameStateManager().load();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.version).toBe(2);
    expect(loaded.runMode).toBe('expedition');
    expect(loaded.expedition).toEqual(expedition);
  });
});
