import { describe, it, expect } from 'vitest';
import {
  PoiKind, SECTOR_TILE_COUNT, TILE_SIZE, TileKind, WALL_EDGE, tileIndex,
} from './worldTypes';
import type { EdgeDirection, EdgeDef, PoiSlot, SectorDef, WorldMap } from './worldTypes';
import { secretShellRingIndices } from './sectorInterior';
import {
  clearSecurityGrid, findGridBreach, isGridFenceIntact, securityGridNearWorld,
} from './securityGrids';

function makeWorld(paint: (tiles: Uint8Array) => void, poiSlots: PoiSlot[] = []): WorldMap {
  const tiles = new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open);
  paint(tiles);
  const edges: Record<EdgeDirection, EdgeDef> = {
    north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE,
  };
  const sector: SectorDef = {
    sx: 0, sy: 0, key: '0,0', biomeId: 'stage_deep_void', danger: 0, tiles, edges,
    poiSlots, isStart: true, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', sector]]), abilityOrder: [], bossArenaKey: '0,0',
  };
}

const centre = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

const fencedAltar = (): PoiSlot => ({
  id: 'poi:0,0:0', kind: PoiKind.Shrine, tileX: 8, tileY: 5, fenced: true,
});

const paintRing = (tiles: Uint8Array) => {
  for (const index of secretShellRingIndices(8, 5)) tiles[index] = TileKind.SecurityGrid;
};

describe('findGridBreach', () => {
  it('passes a one-tile fence and lands in the pocket, naming the slot', () => {
    const world = makeWorld(paintRing, [fencedAltar()]);
    const breach = findGridBreach(world, centre(5), centre(5), 1, 0);
    expect(breach).not.toBeNull();
    expect(breach!.x).toBe(centre(7));
    expect(breach!.y).toBe(centre(5));
    expect(breach!.fenceX).toBe(centre(6));
    expect(breach!.poiId).toBe('poi:0,0:0');
  });

  it('refuses a fence no fenced slot owns', () => {
    const unowned: PoiSlot = { id: 'poi:0,0:0', kind: PoiKind.Shrine, tileX: 8, tileY: 5 };
    const world = makeWorld(paintRing, [unowned]);
    expect(findGridBreach(world, centre(5), centre(5), 1, 0)).toBeNull();
  });

  it('refuses a landing in rock, and a heading that meets rock first', () => {
    const intoRock = makeWorld(tiles => {
      tiles[tileIndex(6, 5)] = TileKind.SecurityGrid;
      tiles[tileIndex(7, 5)] = TileKind.Solid;
    }, [fencedAltar()]);
    expect(findGridBreach(intoRock, centre(5), centre(5), 1, 0)).toBeNull();

    const behindRock = makeWorld(tiles => {
      tiles[tileIndex(6, 5)] = TileKind.Solid;
      tiles[tileIndex(7, 5)] = TileKind.SecurityGrid;
    }, [fencedAltar()]);
    expect(findGridBreach(behindRock, centre(5), centre(5), 1, 0)).toBeNull();
  });

  it('answers nothing with no heading, and finds a fence in the neighbourhood', () => {
    const world = makeWorld(paintRing, [fencedAltar()]);
    expect(findGridBreach(world, centre(5), centre(5), 0, 0)).toBeNull();
    expect(securityGridNearWorld(world, centre(5), centre(5))).toBe(true);
    expect(securityGridNearWorld(world, centre(20), centre(14))).toBe(false);
  });
});

describe('clearSecurityGrid', () => {
  it('trips one kill-switch for good and refuses every repeat', () => {
    const slot = fencedAltar();
    const world = makeWorld(paintRing, [slot]);
    const sector = world.sectors.get('0,0')!;

    expect(clearSecurityGrid(world, 'poi:0,0:0')).toBe(true);
    for (const index of secretShellRingIndices(8, 5)) {
      expect(sector.tiles[index]).toBe(TileKind.Open);
    }
    expect(isGridFenceIntact(sector, slot)).toBe(false);
    expect(clearSecurityGrid(world, 'poi:0,0:0')).toBe(false);
    expect(clearSecurityGrid(world, 'poi:9,9:0')).toBe(false);
  });
});
