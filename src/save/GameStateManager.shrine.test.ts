import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag } from '../ecs/components';
import type { PlayerStats } from '../data/Upgrades';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage (mirrors the bounty persistence test).
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

type ShrineState = {
  shrines: { type: string; x: number; y: number }[];
  spawnTimer: number;
};

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  shrineState?: ShrineState,
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
    shrineState,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager shrine persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips on-field shrines + spawn timer across save/load', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const shrineState: ShrineState = {
      shrines: [
        { type: 'power', x: 300, y: 200 },
        { type: 'fortune', x: 640, y: 360 },
      ],
      spawnTimer: 18.5,
    };

    getGameStateManager().save(makeSaveData(world, playerId, shrineState));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    // On-field shrines (positions + types) and the pacing timer must survive a
    // refresh, not despawn and restart the spawn clock.
    expect(loaded!.shrineState).toEqual(shrineState);
  });

  test('round-trips an empty field with a mid-cooldown spawn timer', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const shrineState: ShrineState = { shrines: [], spawnTimer: 12.25 };

    getGameStateManager().save(makeSaveData(world, playerId, shrineState));
    const loaded = getGameStateManager().load();

    expect(loaded!.shrineState).toEqual(shrineState);
  });

  test('a save written without shrine state restores undefined (backward compatible)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.shrineState).toBeUndefined();
  });
});
