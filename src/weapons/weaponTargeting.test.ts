/**
 * FEAT-TARGETING-LOS: the shared visible-target scans. The probe cap and the arena
 * short-circuit both fail silently in play (a weapon that gives up one candidate too early
 * just looks like it did not fire), so they are pinned here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash, resetEnemySpatialHash } from '../utils/SpatialHash';
import {
  SECTOR_TILE_ROWS, SECTOR_TILE_COUNT, TileKind, WALL_EDGE, tileIndex,
} from '../world/worldTypes';
import type { SectorDef, WorldMap } from '../world/worldTypes';
import {
  findNearestVisibleEnemy, findNearestVisibleInHash, pickVisibleRandomEnemy,
} from './WeaponUtils';
import type { WeaponContext } from './BaseWeapon';

const world = createWorld();

function makeWorldMap(solidTileX: number): WorldMap {
  const tiles = new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open);
  for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) {
    tiles[tileIndex(solidTileX, tileY)] = TileKind.Solid;
  }
  const sector: SectorDef = {
    sx: 0, sy: 0, key: '0,0', biomeId: 'stage_deep_void', danger: 0, tiles,
    edges: { north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE },
    poiSlots: [], isStart: true, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', sector]]), abilityOrder: [], bossArenaKey: '0,0',
  };
}

function makeEnemy(x: number, y: number): number {
  const entityId = addEntity(world);
  addComponent(world, Transform, entityId);
  addComponent(world, Health, entityId);
  Transform.x[entityId] = x;
  Transform.y[entityId] = y;
  Health.current[entityId] = 10;
  return entityId;
}

function makeContext(ids: readonly number[], worldMap: WorldMap | null): WeaponContext {
  return { playerX: 100, playerY: 100, worldMap, getEnemies: () => ids } as unknown as WeaponContext;
}

const walledWorld = makeWorldMap(10);
let occludedNear = 0;   // (600, 100), 500px out, behind the column
let occludedFar = 0;    // (620, 100), 520px out, behind the column
let visible = 0;        // (100, 650), 550px out, clear vertical line

beforeEach(() => {
  occludedNear = makeEnemy(600, 100);
  occludedFar = makeEnemy(620, 100);
  visible = makeEnemy(100, 650);
  resetEnemySpatialHash();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findNearestVisibleEnemy', () => {
  it('takes the plain nearest enemy in a mode with no geometry', () => {
    const ctx = makeContext([occludedNear, occludedFar, visible], null);
    expect(findNearestVisibleEnemy(ctx, 100, 100)).toBe(occludedNear);
  });

  it('walks past a nearer target behind rock to one it can see', () => {
    const ctx = makeContext([occludedNear, occludedFar, visible], walledWorld);
    expect(findNearestVisibleEnemy(ctx, 100, 100)).toBe(visible);
  });

  it('returns -1 when every candidate is behind rock', () => {
    const ctx = makeContext([occludedNear, occludedFar], walledWorld);
    expect(findNearestVisibleEnemy(ctx, 100, 100)).toBe(-1);
  });

  it('gives up once maxProbes candidates have been cast', () => {
    const ctx = makeContext([occludedNear, occludedFar, visible], walledWorld);
    expect(findNearestVisibleEnemy(ctx, 100, 100, undefined, 2)).toBe(-1);
    expect(findNearestVisibleEnemy(ctx, 100, 100, undefined, 3)).toBe(visible);
  });

  it('skips an enemy that died earlier in the same frame', () => {
    Health.current[occludedNear] = 0;
    const ctx = makeContext([occludedNear, occludedFar, visible], null);
    expect(findNearestVisibleEnemy(ctx, 100, 100)).toBe(occludedFar);
  });

  it('honors maxRange the way findNearestEnemy does', () => {
    const ctx = makeContext([occludedNear, occludedFar, visible], null);
    expect(findNearestVisibleEnemy(ctx, 100, 100, 400)).toBe(-1);
  });
});

describe('pickVisibleRandomEnemy', () => {
  it('returns -1 when the only candidates are behind rock', () => {
    const ctx = makeContext([], walledWorld);
    expect(pickVisibleRandomEnemy(ctx, 100, 100, [occludedNear, occludedFar])).toBe(-1);
  });

  it('re-rolls past an occluded draw onto a visible one', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    const ctx = makeContext([], walledWorld);
    expect(pickVisibleRandomEnemy(ctx, 100, 100, [occludedNear, visible])).toBe(visible);
  });

  it('returns -1 for an empty candidate list without casting', () => {
    const ctx = makeContext([], walledWorld);
    expect(pickVisibleRandomEnemy(ctx, 100, 100, [])).toBe(-1);
  });
});

describe('findNearestVisibleInHash', () => {
  function fillHash(): void {
    const hash = getEnemySpatialHash();
    hash.insert(occludedNear, 600, 100);
    hash.insert(occludedFar, 620, 100);
    hash.insert(visible, 100, 650);
  }

  it('takes the plain nearest enemy in a mode with no geometry', () => {
    fillHash();
    expect(findNearestVisibleInHash(makeContext([], null), 100, 100, 800)).toBe(occludedNear);
  });

  it('walks past a nearer target behind rock to one it can see', () => {
    fillHash();
    expect(findNearestVisibleInHash(makeContext([], walledWorld), 100, 100, 800)).toBe(visible);
  });

  it('honors the exclude set, and returns -1 when it empties the visible candidates', () => {
    fillHash();
    const ctx = makeContext([], walledWorld);
    expect(findNearestVisibleInHash(ctx, 100, 100, 800, 8, new Set([visible]))).toBe(-1);
  });
});
