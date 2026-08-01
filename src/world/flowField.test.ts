/**
 * The flow field is the one piece of this chunk with no live-scene dependency and the one
 * whose failure mode is silent: a wrong descent still produces plausible motion, just not
 * motion that arrives. These six pin arrival, not implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  SECTOR_TILE_COLS, SECTOR_TILE_COUNT, TILE_SIZE,
  TileKind, WALL_EDGE, tileIndex,
} from './worldTypes';
import type { EdgeDef, EdgeDirection, SectorDef, WorldMap } from './worldTypes';
import { computeFlowField, createFlowField, flowReachable, flowStepPoint } from './flowField';

function makeSector(
  sx: number, sy: number,
  paint: (tiles: Uint8Array) => void,
  edges: Partial<Record<EdgeDirection, EdgeDef>> = {},
): SectorDef {
  const tiles = new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open);
  paint(tiles);
  return {
    sx, sy, key: `${sx},${sy}`, biomeId: 'stage_deep_void', danger: 0, tiles,
    edges: {
      north: edges.north ?? WALL_EDGE, east: edges.east ?? WALL_EDGE,
      south: edges.south ?? WALL_EDGE, west: edges.west ?? WALL_EDGE,
    },
    poiSlots: [], isStart: true, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
}

function makeWorld(paint: (tiles: Uint8Array) => void): WorldMap {
  const sector = makeSector(0, 0, paint);
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', sector]]), abilityOrder: [], bossArenaKey: '0,0',
  };
}

function tileCentre(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

function paintRect(
  tiles: Uint8Array, fromTileX: number, fromTileY: number,
  toTileX: number, toTileY: number, kind: TileKind,
): void {
  for (let tileY = fromTileY; tileY <= toTileY; tileY++) {
    for (let tileX = fromTileX; tileX <= toTileX; tileX++) tiles[tileIndex(tileX, tileY)] = kind;
  }
}

function paintCup(tiles: Uint8Array): void {
  paintRect(tiles, 8, 6, 8, 12, TileKind.Solid);
  paintRect(tiles, 8, 6, 12, 6, TileKind.Solid);
  paintRect(tiles, 8, 12, 12, 12, TileKind.Solid);
}

function fieldFor(world: WorldMap, targetTileX: number, targetTileY: number) {
  const field = createFlowField();
  const target = tileCentre(targetTileX, targetTileY);
  computeFlowField(world, target.x, target.y, field);
  return field;
}

describe('flowField', () => {
  it('points straight at the target across open ground', () => {
    const field = fieldFor(makeWorld(() => {}), 10, 9);
    const start = tileCentre(14, 9);
    const step = { x: 0, y: 0 };

    expect(flowStepPoint(field, start.x, start.y, step)).toBe(true);
    expect(step.x).toBe(tileCentre(13, 9).x);
    expect(step.y).toBe(tileCentre(13, 9).y);
  });

  it('routes around a U-shaped wall instead of through it', () => {
    const field = fieldFor(makeWorld(paintCup), 6, 9);
    const step = { x: 0, y: 0 };
    let x = tileCentre(10, 9).x;
    let y = tileCentre(10, 9).y;
    let reachedTarget = false;
    let leftTheRow = false;

    for (let walked = 0; walked < 200; walked++) {
      if (!flowStepPoint(field, x, y, step)) break;
      x = step.x;
      y = step.y;
      const tileX = Math.floor(x / TILE_SIZE);
      const tileY = Math.floor(y / TILE_SIZE);
      if (tileY !== 9) leftTheRow = true;
      if (tileX === 6 && tileY === 9) {
        reachedTarget = true;
        break;
      }
    }

    expect(reachedTarget).toBe(true);
    expect(leftTheRow).toBe(true);
  });

  it('marks a walled-off pocket unreachable', () => {
    const world = makeWorld(tiles => {
      paintRect(tiles, 19, 3, 21, 5, TileKind.Solid);
      tiles[tileIndex(20, 4)] = TileKind.Open;
    });
    const field = fieldFor(world, 10, 9);
    const pocket = tileCentre(20, 4);
    const step = { x: -1, y: -1 };

    expect(flowStepPoint(field, pocket.x, pocket.y, step)).toBe(false);
    expect(step.x).toBe(-1);
    expect(step.y).toBe(-1);
  });

  it('marks solid tiles unreachable', () => {
    const field = fieldFor(makeWorld(paintCup), 6, 9);
    const wall = tileCentre(8, 9);
    const step = { x: 0, y: 0 };

    expect(flowStepPoint(field, wall.x, wall.y, step)).toBe(false);
  });

  it('rejects a point outside the block', () => {
    const field = fieldFor(makeWorld(() => {}), 10, 9);
    const step = { x: 0, y: 0 };

    expect(flowStepPoint(field, -3 * SECTOR_TILE_COLS * TILE_SIZE, 0, step)).toBe(false);
  });

  it('reads open connected ground as reachable and a sealed pocket as not', () => {
    // A 1-tile pocket at (10,9) fully ringed by wall: open floor, no route.
    const world = makeWorld(tiles => {
      paintRect(tiles, 9, 8, 11, 10, TileKind.Solid);
      tiles[tileIndex(10, 9)] = TileKind.Open;
    });
    const field = fieldFor(world, 5, 9);
    const openGround = tileCentre(14, 9);
    const pocket = tileCentre(10, 9);
    const insideWall = tileCentre(9, 8);

    expect(flowReachable(field, openGround.x, openGround.y)).toBe(true);
    expect(flowReachable(field, pocket.x, pocket.y)).toBe(false);
    expect(flowReachable(field, insideWall.x, insideWall.y)).toBe(false);
  });

  it('reads a point beyond the block as unreachable', () => {
    const field = fieldFor(makeWorld(() => {}), 10, 9);
    const farOutside = tileCentre(SECTOR_TILE_COLS * 5, 9);

    expect(flowReachable(field, farOutside.x, farOutside.y)).toBe(false);
  });

  it('never cuts a diagonal between two walls', () => {
    const world = makeWorld(tiles => {
      tiles[tileIndex(11, 9)] = TileKind.Solid;
      tiles[tileIndex(10, 8)] = TileKind.Solid;
    });
    const field = fieldFor(world, 5, 9);
    const start = tileCentre(11, 8);
    const cornerCut = tileCentre(10, 9);
    const step = { x: 0, y: 0 };

    if (flowStepPoint(field, start.x, start.y, step)) {
      expect(step.x === cornerCut.x && step.y === cornerCut.y).toBe(false);
      const stepTileX = Math.floor(step.x / TILE_SIZE);
      const stepTileY = Math.floor(step.y / TILE_SIZE);
      expect(Math.abs(stepTileX - 11) + Math.abs(stepTileY - 8)).toBe(1);
    }
  });

  it('covers the whole enemy leash from a player standing on a sector corner tile', () => {
    const sectors = new Map<string, SectorDef>();
    for (let sy = -3; sy <= 3; sy++) {
      for (let sx = -3; sx <= 3; sx++) {
        sectors.set(`${sx},${sy}`, makeSector(sx, sy, () => {}));
      }
    }
    const world: WorldMap = {
      worldGenVersion: 1, seed: 1, startKey: '0,0', sectors,
      abilityOrder: [], bossArenaKey: '0,0',
    };
    const field = createFlowField();
    const player = tileCentre(0, 0);
    computeFlowField(world, player.x, player.y, field);

    const leash = 1600;
    const diagonalLeash = Math.round(leash * Math.SQRT1_2);
    for (const [offsetX, offsetY] of [
      [-leash, 0], [leash, 0], [0, -leash], [0, leash],
      [-diagonalLeash, -diagonalLeash], [diagonalLeash, diagonalLeash],
    ]) {
      expect(flowReachable(field, player.x + offsetX, player.y + offsetY)).toBe(true);
    }
  });
});
