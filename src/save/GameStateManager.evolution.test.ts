import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag } from '../ecs/components';
import type { PlayerStats } from '../data/Upgrades';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage (mirrors the shrine/bounty tests).
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

type WeaponSave = { id: string; level: number; evolved?: boolean };

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  weapons: WeaponSave[],
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
    weapons,
    upgrades: [],
    twinLinks: [] as [number, number][],
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager weapon evolution persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips the evolved flag so an evolved weapon survives a refresh', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    // Mirror what GameScene writes: every weapon carries an explicit boolean.
    const weapons: WeaponSave[] = [
      { id: 'katana', level: 7, evolved: true },
      { id: 'aura', level: 5, evolved: false },
    ];

    getGameStateManager().save(makeSaveData(world, playerId, weapons));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    // The evolved flag must survive so restore can re-apply evolve()'s permanent
    // base-stat multipliers instead of reverting the weapon to its base form.
    expect(loaded!.weapons).toEqual(weapons);
    expect(loaded!.weapons[0].evolved).toBe(true);
    expect(loaded!.weapons[1].evolved).toBe(false);
  });

  test('a legacy save written without an evolved field restores without it', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    // Legacy saves predate evolution persistence — `evolved` is simply absent,
    // which restore must treat as "not evolved" (backward-compatible).
    const weapons: WeaponSave[] = [{ id: 'projectile', level: 3 }];

    getGameStateManager().save(makeSaveData(world, playerId, weapons));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.weapons).toEqual([{ id: 'projectile', level: 3 }]);
    expect(loaded!.weapons[0].evolved).toBeUndefined();
  });
});
