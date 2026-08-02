import { describe, test, expect } from 'vitest';
import { addComponent, addEntity, createWorld, type IWorld } from 'bitecs';
import {
  Destructible,
  EnemyAffix,
  EnemyTag,
  EnemyType,
  Health,
  Transform,
} from '../../ecs/components';
import { updateFrameCache } from '../../ecs/FrameCache';
import type { MinimapEntry } from '../../visual/MinimapManager';
import {
  MINIMAP_WORLD_RANGE,
  SECRET_PING_RADIUS,
  secretPingIntensity,
} from '../../visual/minimapProjection';
import { MinimapFeed, type MinimapFeedOptions } from './MinimapFeed';

class StubRadar {
  enabled = true;
  secretPing = 0;
  contacts: MinimapEntry[] = [];
  isEnabled(): boolean { return this.enabled; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  setSectorUnderlay(): void {}
  setSecretPing(intensity: number): void { this.secretPing = intensity; }
  setWaypoints(): void {}
  update(
    _playerX: number,
    _playerY: number,
    entries: ReadonlyArray<MinimapEntry>,
    entryCount: number,
  ): void {
    this.contacts = entries.slice(0, entryCount).map((entry) => ({ ...entry }));
  }
}

function buildFeed(world: IWorld, playerId: number, overrides: Partial<MinimapFeedOptions> = {}) {
  const radar = new StubRadar();
  const feed = new MinimapFeed(radar, {
    world: () => world,
    playerId: () => playerId,
    minimapEnabled: () => true,
    // A null map short-circuits the underlay and the bearings, which are already tested where
    // their pure builders live. These tests are about the contact pass.
    worldMap: () => null,
    biomeTint: () => 0,
    chests: () => [],
    vaults: () => [],
    questBoards: () => [],
    ambushNests: () => [],
    nemesisLairs: () => [],
    secretCaches: () => [],
    decryptorOwned: () => false,
    spentNestSectorKeys: () => [],
    markedSectorKeys: () => [],
    holdsAbility: () => false,
    ...overrides,
  });
  return { radar, feed };
}

function spawnPlayer(world: IWorld): number {
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  Transform.x[playerId] = 0;
  Transform.y[playerId] = 0;
  return playerId;
}

function spawnEnemy(
  world: IWorld,
  x: number,
  xpValue: number,
  traits: { elite?: boolean; crate?: boolean } = {},
): void {
  const entityId = addEntity(world);
  addComponent(world, Transform, entityId);
  addComponent(world, Health, entityId);
  addComponent(world, EnemyTag, entityId);
  addComponent(world, EnemyType, entityId);
  Transform.x[entityId] = x;
  Transform.y[entityId] = 0;
  EnemyType.xpValue[entityId] = xpValue;
  if (traits.elite) addComponent(world, EnemyAffix, entityId);
  if (traits.crate) addComponent(world, Destructible, entityId);
}

describe('MinimapFeed contact gathering', () => {
  test('samples regular enemies to the blip cap, passes every high-value threat, drops crates', () => {
    const world = createWorld();
    const playerId = spawnPlayer(world);
    for (let i = 0; i < 200; i++) spawnEnemy(world, i, 1);
    spawnEnemy(world, 500, 1, { elite: true });
    spawnEnemy(world, 510, 30);
    spawnEnemy(world, 520, 1000);
    spawnEnemy(world, 530, 1, { crate: true });
    updateFrameCache(world);

    const { radar, feed } = buildFeed(world, playerId);
    feed.update(0.016);

    const kinds = radar.contacts.map((contact) => contact.kind);
    const regulars = kinds.filter((kind) => kind === 'enemy').length;
    expect(regulars).toBeGreaterThan(0);
    expect(regulars).toBeLessThanOrEqual(48);
    expect(kinds.filter((kind) => kind === 'elite')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'miniboss')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'boss')).toHaveLength(1);
    // Nothing else got through: the crate is not a contact.
    expect(radar.contacts).toHaveLength(regulars + 3);
  });

  test('draws a risk room only while it is dormant and inside radar range', () => {
    const world = createWorld();
    const playerId = spawnPlayer(world);
    updateFrameCache(world);

    const { radar, feed } = buildFeed(world, playerId, {
      ambushNests: () => [
        { x: 100, y: 0, awake: false },
        { x: 120, y: 0, awake: true },
        { x: MINIMAP_WORLD_RANGE + 10, y: 0, awake: false },
      ],
      nemesisLairs: () => [
        { x: 200, y: 0, awake: false },
        { x: 220, y: 0, awake: true },
      ],
    });
    feed.update(0.016);

    expect(radar.contacts).toEqual([
      { worldX: 100, worldY: 0, kind: 'nest' },
      { worldX: 200, worldY: 0, kind: 'lair' },
    ]);
  });

  test('only a decryptor owner gets cache positions, and the shimmer fires either way', () => {
    const world = createWorld();
    const playerId = spawnPlayer(world);
    updateFrameCache(world);
    const secretCaches = () => [{ x: 300, y: 0 }];

    const withoutDecryptor = buildFeed(world, playerId, { secretCaches });
    withoutDecryptor.feed.update(0.016);
    expect(withoutDecryptor.radar.contacts).toHaveLength(0);
    expect(withoutDecryptor.radar.secretPing)
      .toBeCloseTo(secretPingIntensity(300, SECRET_PING_RADIUS));

    const withDecryptor = buildFeed(world, playerId, { secretCaches, decryptorOwned: () => true });
    withDecryptor.feed.update(0.016);
    expect(withDecryptor.radar.contacts).toEqual([{ worldX: 300, worldY: 0, kind: 'secret' }]);
  });

  test('the shimmer follows the nearest unfound cache and stops when the sector holds none', () => {
    const world = createWorld();
    const playerId = spawnPlayer(world);
    updateFrameCache(world);

    const nearest = buildFeed(world, playerId, {
      secretCaches: () => [{ x: 600, y: 0 }, { x: 0, y: 200 }, { x: 400, y: 0 }],
    });
    nearest.feed.update(0.016);
    expect(nearest.radar.secretPing).toBeCloseTo(secretPingIntensity(200, SECRET_PING_RADIUS));

    const none = buildFeed(world, playerId);
    none.feed.update(0.016);
    expect(none.radar.secretPing).toBe(0);
  });
});
