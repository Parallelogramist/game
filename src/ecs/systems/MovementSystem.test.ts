import { describe, test, expect } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { EnemyAI, Transform, Velocity } from '../components';
import { clampPlayerToRect, movementSystem } from './MovementSystem';
import { rectFromScreen } from '../../world/worldSpace';
import { EnemyAIType } from '../../enemies/EnemyTypes';
import {
  SECTOR_TILE_COUNT, SECTOR_TILE_ROWS, TILE_SIZE, TileKind, WALL_EDGE, tileIndex,
} from '../../world/worldTypes';
import type { SectorDef, WorldMap } from '../../world/worldTypes';

/**
 * FEAT-WORLD-SPACE-2 replaced a screen-literal clamp with a rect clamp on the live
 * arena game. The property worth pinning is not "the new formula is correct" but
 * "the new formula IS the old formula" over the screen rect: a one-pixel drift in
 * where the ship stops is invisible in a diff and unfalsifiable without a browser.
 */
const legacyClamp = (value: number, extent: number, padding: number): number =>
  Math.max(padding, Math.min(extent - padding, value));

describe('clampPlayerToRect', () => {
  const screenRect = rectFromScreen(1280, 720);
  const world = createWorld();
  const playerId = addEntity(world);

  test.each([
    [-500, -500],
    [0, 0],
    [15.5, 15.5],
    [16, 16],
    [640, 360],
    [1264, 704],
    [1265, 705],
    [1280, 720],
    [9999, 9999],
  ])('matches the legacy screen clamp at (%s, %s)', (x, y) => {
    Transform.x[playerId] = x;
    Transform.y[playerId] = y;

    clampPlayerToRect(world, playerId, screenRect);

    expect(Transform.x[playerId]).toBe(legacyClamp(x, 1280, 16));
    expect(Transform.y[playerId]).toBe(legacyClamp(y, 720, 16));
  });

  test('an offset rect shifts the clamp with it', () => {
    Transform.x[playerId] = 0;
    Transform.y[playerId] = 0;

    clampPlayerToRect(world, playerId, { minX: 1280, minY: 720, maxX: 2560, maxY: 1440 });

    expect(Transform.x[playerId]).toBe(1296);
    expect(Transform.y[playerId]).toBe(736);
  });
});

const WALL_TILE_X = 5;
const WALL_LEFT_EDGE = WALL_TILE_X * TILE_SIZE;
const ENEMY_RADIUS = 12;

/** One open sector with a floor-to-ceiling solid column, the smallest world that can tell a
 *  ghost from an enemy. Same literal shape staticCollision.test.ts builds. */
function worldWithWallColumn(): WorldMap {
  const tiles = new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open);
  for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) {
    tiles[tileIndex(WALL_TILE_X, tileY)] = TileKind.Solid;
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

describe('movementSystem — the ghost rule', () => {
  const flyAtTheWall = (state: number): number => {
    const world = createWorld();
    const wraithId = addEntity(world);
    addComponent(world, Transform, wraithId);
    addComponent(world, Velocity, wraithId);
    addComponent(world, EnemyAI, wraithId);
    Transform.x[wraithId] = WALL_LEFT_EDGE - 60;
    Transform.y[wraithId] = 100;
    Velocity.x[wraithId] = 160;
    Velocity.y[wraithId] = 0;
    EnemyAI.aiType[wraithId] = EnemyAIType.Wraith;
    EnemyAI.state[wraithId] = state;

    movementSystem(world, 1, {
      worldMap: worldWithWallColumn(), playerId: -1,
      playerRadius: 16, enemyRadius: ENEMY_RADIUS,
    });
    return Transform.x[wraithId];
  };

  test('a corporeal wraith is stopped by the wall', () => {
    expect(flyAtTheWall(0)).toBeLessThanOrEqual(WALL_LEFT_EDGE - ENEMY_RADIUS);
  });

  test('a phased wraith passes through it', () => {
    expect(flyAtTheWall(1)).toBe(WALL_LEFT_EDGE + 100);
  });
});
