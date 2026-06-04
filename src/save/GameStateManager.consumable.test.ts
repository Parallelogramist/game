import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, PlayerTag, Consumable } from '../ecs/components';
import { spawnConsumablePickup, ConsumableKind } from '../ecs/systems/ConsumablePickupSystem';
import type { PlayerStats } from '../data/Upgrades';

// In-memory stand-in for the encrypted storage so save()/load() round-trips
// without touching crypto/localStorage. Same specifier ('../storage') as the
// production import, so Vitest swaps the real module for this one.
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

// Import after the mock is registered so GameStateManager binds to it.
import { getGameStateManager } from './GameStateManager';

/** Minimal save payload — only the entity world matters for these tests. */
function makeSaveData(world: ReturnType<typeof createWorld>, playerId: number) {
  return {
    world,
    playerId,
    playerStats: { level: 1, currentHealth: 100, maxHealth: 100 } as unknown as PlayerStats,
    gameTime: 0,
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
  };
}

function makePlayer(world: ReturnType<typeof createWorld>): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, PlayerTag, playerId);
  Transform.x[playerId] = 640;
  Transform.y[playerId] = 360;
  return playerId;
}

describe('GameStateManager floor-consumable persistence', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('persists a floor consumable across save/load with kind, value and position', () => {
    const world = createWorld();
    const playerId = makePlayer(world);
    spawnConsumablePickup(world, 123, 456, ConsumableKind.GOLD, 50);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    const consumables = loaded!.entities.filter((entity) => entity.tag === 'consumable');
    expect(consumables).toHaveLength(1);
    expect(consumables[0].consumableData).toEqual({
      kind: ConsumableKind.GOLD,
      value: 50,
      magnetized: 0,
    });
    expect(consumables[0].transform.x).toBe(123);
    expect(consumables[0].transform.y).toBe(456);
  });

  test('round-trips a non-gold consumable through save → load → re-spawn', () => {
    // Locks the serialize/restore field mapping together: the data emitted by
    // save() must be exactly what GameScene.restoreConsumable feeds back into
    // spawnConsumablePickup(kind, value), reproducing the live component. A
    // rename on either side breaks this.
    const world = createWorld();
    const playerId = makePlayer(world);
    spawnConsumablePickup(world, 200, 300, ConsumableKind.FREEZE, 0);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();
    const data = loaded!.entities.find((entity) => entity.tag === 'consumable')!;

    const restoreWorld = createWorld();
    const restoredId = spawnConsumablePickup(
      restoreWorld,
      data.transform.x,
      data.transform.y,
      data.consumableData!.kind,
      data.consumableData!.value,
    );

    expect(Consumable.kind[restoredId]).toBe(ConsumableKind.FREEZE);
    expect(Consumable.value[restoredId]).toBe(0);
    expect(Transform.x[restoredId]).toBe(200);
    expect(Transform.y[restoredId]).toBe(300);
  });

  test('saves with no consumables on the floor → none restored', () => {
    const world = createWorld();
    const playerId = makePlayer(world);

    getGameStateManager().save(makeSaveData(world, playerId));
    const loaded = getGameStateManager().load();

    expect(loaded).not.toBeNull();
    expect(loaded!.entities.filter((entity) => entity.tag === 'consumable')).toHaveLength(0);
  });
});
