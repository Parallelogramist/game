import { describe, test, expect, vi, beforeEach } from 'vitest';
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

// Local mirror of DirectorSystem's DirectorState (kept decoupled from the
// source, matching the sibling persistence tests' EventState/BountyState style).
type DirectorStrategy = 'swarm' | 'elite' | 'balanced' | 'chaos';
type DirectorState = {
  creditBalance: number;
  creditsEarned: number;
  currentStrategy: DirectorStrategy;
  lastGameTime: number;
};

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  directorState?: DirectorState,
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
    directorState,
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager director-state persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips mid-run director state (strategy not re-rolled, credit economy preserved)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const directorState: DirectorState = {
      creditBalance: 42.5,
      creditsEarned: 137.25,
      currentStrategy: 'elite',
      lastGameTime: 5,
    };

    getGameStateManager().save(makeSaveData(world, playerId, directorState));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    // A refresh must keep the rolled strategy + accrued credits, not reset the
    // spawn economy back to a fresh balanced/zero state.
    expect(loaded!.directorState).toEqual(directorState);
  });

  test('round-trips each strategy value faithfully', () => {
    const strategies: DirectorStrategy[] = ['swarm', 'elite', 'balanced', 'chaos'];
    for (const currentStrategy of strategies) {
      getGameStateManager().clearSave();
      const world = createWorld();
      const playerId = makePlayer(world);
      const directorState: DirectorState = {
        creditBalance: 10,
        creditsEarned: 20,
        currentStrategy,
        lastGameTime: 5,
      };

      getGameStateManager().save(makeSaveData(world, playerId, directorState));
      const loaded = getGameStateManager().load();

      expect(loaded!.directorState?.currentStrategy).toBe(currentStrategy);
    }
  });

  test('a save written without director state restores undefined (backward compatible)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.directorState).toBeUndefined();
  });
});
