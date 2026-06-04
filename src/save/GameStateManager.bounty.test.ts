import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag } from '../ecs/components';
import type { PlayerStats } from '../data/Upgrades';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage (mirrors the powerbuff persistence test).
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

type BountyState = {
  bounty: { kind: string; target: number; progress: number; timeLeft: number } | null;
  cooldown: number;
  flawlessBroken: boolean;
};

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  bountyState?: BountyState,
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
    bountyState,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager bounty persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips an in-progress bounty across save/load', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const bountyState: BountyState = {
      bounty: { kind: 'elites', target: 3, progress: 2, timeLeft: 30.5 },
      cooldown: 20,
      flawlessBroken: false,
    };

    getGameStateManager().save(makeSaveData(world, playerId, bountyState));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    // The mid-bounty progress (2/3) must survive a refresh, not reset to none.
    expect(loaded!.bountyState).toEqual(bountyState);
  });

  test('round-trips the cooldown phase (no active bounty)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const bountyState: BountyState = { bounty: null, cooldown: 7.25, flawlessBroken: false };

    getGameStateManager().save(makeSaveData(world, playerId, bountyState));
    const loaded = getGameStateManager().load();

    expect(loaded!.bountyState).toEqual(bountyState);
  });

  test('a save written without bounty state restores undefined (backward compatible)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.bountyState).toBeUndefined();
  });
});
