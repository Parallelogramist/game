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

type EventState = {
  eventTimer: number;
  nextEventInterval: number;
  lastEventId: string;
  activeEvent?: { id: string; remainingTime: number } | null;
};

function makeSaveData(
  world: ReturnType<typeof createWorld>,
  playerId: number,
  eventState?: EventState,
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
    eventState,
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
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  return playerId;
}

describe('GameStateManager event-state persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('round-trips a live timed event (the active boon survives a refresh)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const eventState: EventState = {
      eventTimer: 30,
      nextEventInterval: 55,
      lastEventId: 'golden_tide',
      activeEvent: { id: 'golden_tide', remainingTime: 6 },
    };

    getGameStateManager().save(makeSaveData(world, playerId, eventState));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.eventState).toEqual(eventState);
  });

  test('round-trips an event state with no active event', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    const eventState: EventState = {
      eventTimer: 10,
      nextEventInterval: 60,
      lastEventId: '',
      activeEvent: null,
    };

    getGameStateManager().save(makeSaveData(world, playerId, eventState));
    const loaded = getGameStateManager().load();

    expect(loaded!.eventState).toEqual(eventState);
  });

  test('a save written without event state restores undefined (backward compatible)', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.eventState).toBeUndefined();
  });
});
