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

type ChestState = { x: number; y: number; isSpecial: boolean }[];

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  chestState?: ChestState,
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
    chestState,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager treasure-chest persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips on-field treasure chests (positions + special flag)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const chestState: ChestState = [
      { x: 300, y: 200, isSpecial: false },
      { x: 640, y: 360, isSpecial: true },
    ];

    getGameStateManager().save(makeSaveData(world, playerId, chestState));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    // On-field chests (their positions + the rare "special" 3x-reward flag) must
    // survive a refresh so a relic/XP cache the player earned isn't silently lost.
    expect(loaded!.chestState).toEqual(chestState);
  });

  test('round-trips an empty chest field', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const chestState: ChestState = [];

    getGameStateManager().save(makeSaveData(world, playerId, chestState));
    const loaded = getGameStateManager().load();

    expect(loaded!.chestState).toEqual(chestState);
  });

  test('a save written without chest state restores undefined (backward compatible)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.chestState).toBeUndefined();
  });
});
