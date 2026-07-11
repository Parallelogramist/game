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

type EndlessState = {
  active: boolean;
  time: number;
  minibossTimer: number;
  bossTimer: number;
  cycleNumber: number;
  bossIntervalSeconds: number;
  mutator?: number;
};

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  extra?: { hasWon?: boolean; endlessState?: EndlessState },
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
    hasWon: extra?.hasWon,
    endlessState: extra?.endlessState,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager endless-mode persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips an active endless run (cycle + timers + ramped interval) and the won flag', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    // A deep post-victory endless run: 3 boss waves cleared, the boss interval
    // tightened to 165s, mid-countdown timers. Without persistence, a refresh
    // reverts to plain spawns (losing the wave cadence + escalation) and drops
    // the won flag (risking a victory miscount on a later death).
    const endlessState: EndlessState = {
      active: true,
      time: 742.5,
      minibossTimer: 12.25,
      bossTimer: 88.5,
      cycleNumber: 3,
      bossIntervalSeconds: 165,
      mutator: 4,
    };

    getGameStateManager().save(makeSaveData(world, playerId, { hasWon: true, endlessState }));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.endlessState).toEqual(endlessState);
    expect(loaded!.hasWon).toBe(true);
  });

  test('round-trips an inactive endless state (pre-continue won run)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const endlessState: EndlessState = {
      active: false,
      time: 0,
      minibossTimer: 45,
      bossTimer: 300,
      cycleNumber: 0,
      bossIntervalSeconds: 300,
    };

    getGameStateManager().save(makeSaveData(world, playerId, { hasWon: true, endlessState }));
    const loaded = getGameStateManager().load();

    expect(loaded!.endlessState).toEqual(endlessState);
    expect(loaded!.hasWon).toBe(true);
  });

  test('a save written without endless/won state restores undefined (legacy + normal mid-run)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.endlessState).toBeUndefined();
    expect(loaded!.hasWon).toBeUndefined();
  });
});
