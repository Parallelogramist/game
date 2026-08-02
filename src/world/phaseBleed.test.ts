import { describe, test, expect } from 'vitest';
import {
  SECTOR_TILE_COUNT, TILE_SIZE, TileKind, WALL_EDGE, tileIndex,
} from './worldTypes';
import type { WorldMap } from './worldTypes';
import { PHASE_BLEED_MARGIN, collectPhaseBleedTiles } from './phaseBleed';

const ENEMY_RADIUS = 12;

function makeWorld(paint: (tiles: Uint8Array) => void): WorldMap {
  const tiles = new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open);
  paint(tiles);
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', {
      sx: 0, sy: 0, key: '0,0', biomeId: 'stage_deep_void', danger: 0, tiles,
      edges: { north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE },
      poiSlots: [], isStart: true, isBossArena: false, depth: 0,
      entryTiles: {}, breakables: [],
    }]]),
    abilityOrder: [], bossArenaKey: '0,0',
  };
}

function collect(world: WorldMap, movers: { x: number; y: number }[]) {
  const seen = new Set<number>();
  const out: { x: number; y: number }[] = [];
  let count = 0;
  for (const mover of movers) {
    count = collectPhaseBleedTiles(world, mover.x, mover.y, ENEMY_RADIUS, seen, out, count);
  }
  return out.slice(0, count).map(tile => `${tile.x},${tile.y}`).sort();
}

describe('collectPhaseBleedTiles', () => {
  test('lights the wall tile a phased mover is standing in', () => {
    const world = makeWorld(tiles => { tiles[tileIndex(4, 4)] = TileKind.Solid; });
    const centre = { x: 4 * TILE_SIZE + TILE_SIZE / 2, y: 4 * TILE_SIZE + TILE_SIZE / 2 };
    expect(collect(world, [centre])).toEqual([`${4 * TILE_SIZE},${4 * TILE_SIZE}`]);
  });

  test('lights breakable and gate tiles but never a gap, a fence or open floor', () => {
    const world = makeWorld(tiles => {
      tiles[tileIndex(4, 4)] = TileKind.Breakable;
      tiles[tileIndex(5, 4)] = TileKind.GateClosed;
      tiles[tileIndex(8, 4)] = TileKind.VoidGap;
      tiles[tileIndex(9, 4)] = TileKind.SecurityGrid;
    });
    const row = 4 * TILE_SIZE;
    const at = (tileX: number) => ({ x: tileX * TILE_SIZE + TILE_SIZE / 2, y: row + TILE_SIZE / 2 });
    expect(collect(world, [at(4), at(5)]))
      .toEqual([`${4 * TILE_SIZE},${row}`, `${5 * TILE_SIZE},${row}`].sort());
    expect(collect(world, [at(8), at(9), at(10)])).toEqual([]);
  });

  test('reaches a wall the body has not entered yet, but no further than the margin', () => {
    const world = makeWorld(tiles => { tiles[tileIndex(4, 4)] = TileKind.Solid; });
    const wallLeft = 4 * TILE_SIZE;
    const row = 4 * TILE_SIZE + TILE_SIZE / 2;
    const justInside = { x: wallLeft - (ENEMY_RADIUS + PHASE_BLEED_MARGIN) + 1, y: row };
    const justOutside = { x: wallLeft - (ENEMY_RADIUS + PHASE_BLEED_MARGIN) - 1, y: row };
    expect(collect(world, [justInside])).toEqual([`${wallLeft},${4 * TILE_SIZE}`]);
    expect(collect(world, [justOutside])).toEqual([]);
  });

  test('two movers inside one wall light it once', () => {
    const world = makeWorld(tiles => { tiles[tileIndex(4, 4)] = TileKind.Solid; });
    const centre = 4 * TILE_SIZE + TILE_SIZE / 2;
    expect(collect(world, [
      { x: centre - 4, y: centre },
      { x: centre + 4, y: centre },
    ])).toEqual([`${4 * TILE_SIZE},${4 * TILE_SIZE}`]);
  });
});
