import { describe, it, expect } from 'vitest';
import {
  SECTOR_TILE_COUNT, TILE_SIZE, TileKind, WALL_EDGE, tileIndex,
} from './worldTypes';
import type { EdgeDirection, EdgeDef, SectorDef, WorldMap } from './worldTypes';
import { findTetherCrossing, voidGapNearWorld } from './voidGaps';

function makeWorld(paint: (tiles: Uint8Array) => void): WorldMap {
  const tiles = new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open);
  paint(tiles);
  const edges: Record<EdgeDirection, EdgeDef> = {
    north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE,
  };
  const sector: SectorDef = {
    sx: 0, sy: 0, key: '0,0', biomeId: 'stage_deep_void', danger: 0, tiles, edges,
    poiSlots: [], isStart: true, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', sector]]), abilityOrder: [], bossArenaKey: '0,0',
  };
}

const centre = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

describe('findTetherCrossing', () => {
  it('reels across a one-tile gap and lands on the far rim', () => {
    const world = makeWorld(tiles => { tiles[tileIndex(6, 5)] = TileKind.VoidGap; });
    const crossing = findTetherCrossing(world, centre(5), centre(5), 1, 0);
    expect(crossing).not.toBeNull();
    expect(crossing!.x).toBe(centre(7));
    expect(crossing!.y).toBe(centre(5));
    expect(crossing!.anchorX).toBe(centre(6));
    expect(crossing!.spanTiles).toBe(1);
  });

  it('crosses back the way it came', () => {
    const world = makeWorld(tiles => { tiles[tileIndex(6, 5)] = TileKind.VoidGap; });
    const crossing = findTetherCrossing(world, centre(7), centre(5), -1, 0);
    expect(crossing!.x).toBe(centre(5));
  });

  it('refuses a run wider than the tether spans', () => {
    const world = makeWorld(tiles => {
      for (let tileX = 6; tileX <= 9; tileX++) tiles[tileIndex(tileX, 5)] = TileKind.VoidGap;
    });
    expect(findTetherCrossing(world, centre(5), centre(5), 1, 0)).toBeNull();
  });

  it('refuses a landing in rock, and a heading that meets rock first', () => {
    const intoRock = makeWorld(tiles => {
      tiles[tileIndex(6, 5)] = TileKind.VoidGap;
      tiles[tileIndex(7, 5)] = TileKind.Solid;
    });
    expect(findTetherCrossing(intoRock, centre(5), centre(5), 1, 0)).toBeNull();

    const behindRock = makeWorld(tiles => {
      tiles[tileIndex(6, 5)] = TileKind.Solid;
      tiles[tileIndex(7, 5)] = TileKind.VoidGap;
    });
    expect(findTetherCrossing(behindRock, centre(5), centre(5), 1, 0)).toBeNull();
  });

  it('answers nothing with no heading, and finds a gap in the neighbourhood', () => {
    const world = makeWorld(tiles => { tiles[tileIndex(6, 5)] = TileKind.VoidGap; });
    expect(findTetherCrossing(world, centre(5), centre(5), 0, 0)).toBeNull();
    expect(voidGapNearWorld(world, centre(5), centre(5))).toBe(true);
    expect(voidGapNearWorld(world, centre(12), centre(12))).toBe(false);
  });
});
