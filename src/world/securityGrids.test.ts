import { describe, it, expect } from 'vitest';
import {
  PoiKind, SECTOR_TILE_COLS, SECTOR_TILE_COUNT, SECTOR_TILE_ROWS, TILE_SIZE, TileKind,
  WALL_EDGE, tileIndex,
} from './worldTypes';
import type { EdgeDirection, EdgeDef, PoiSlot, SectorDef, WorldMap } from './worldTypes';
import { STAGES } from '../data/Stages';
import { generateWorld } from './generateWorld';
import { secretShellRingIndices } from './sectorInterior';
import {
  applyDownedSecurityGrids, clearSecurityGrid, findGridBreach, isGridFenceIntact,
  securityGridNearWorld,
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
    expect(breach!.gridId).toBe('poi:0,0:0');
    expect(breach!.kind).toBe('altar');
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

const BAND_INPUTS = {
  abilityGateOrder: ['blink_drive', 'breach_charges', 'magno_tether',
    'phase_cloak', 'thermal_ward', 'signal_decryptor'],
  availableBiomeIds: STAGES.map(stage => stage.id),
};

interface FoundBand {
  world: WorldMap;
  seed: number;
  bandId: string;
  tileIndices: number[];
  /** World-space centre of the tile west of the band's first cell. */
  approachX: number;
  approachY: number;
}

/** The first vertical corridor band across a handful of seeds: vertical so the approach is a
 *  plain +X probe, which is what findGridBreach snaps a heading to. */
function firstVerticalBand(): FoundBand {
  for (let index = 0; index < 12; index++) {
    const seed = index * 7919 + 12345;
    const world = generateWorld(seed, BAND_INPUTS);
    for (const sector of world.sectors.values()) {
      for (const band of sector.gridBands ?? []) {
        const column = band.tileIndices[0] % SECTOR_TILE_COLS;
        const vertical = band.tileIndices
          .every(tile => tile % SECTOR_TILE_COLS === column);
        if (!vertical) continue;
        const row = Math.floor(band.tileIndices[0] / SECTOR_TILE_COLS);
        const globalTileX = sector.sx * SECTOR_TILE_COLS + column;
        const globalTileY = sector.sy * SECTOR_TILE_ROWS + row;
        return {
          world, seed, bandId: band.id, tileIndices: [...band.tileIndices],
          approachX: (globalTileX - 1) * TILE_SIZE + TILE_SIZE / 2,
          approachY: globalTileY * TILE_SIZE + TILE_SIZE / 2,
        };
      }
    }
  }
  throw new Error('no vertical corridor band in the first 12 seeds');
}

describe('corridor band breaches', () => {
  it('names the band a cloaked ship crosses and clears it for good', () => {
    const found = firstVerticalBand();
    const sector = found.world.sectors.get(
      `${Math.floor(found.approachX / TILE_SIZE / SECTOR_TILE_COLS)},`
      + `${Math.floor(found.approachY / TILE_SIZE / SECTOR_TILE_ROWS)}`,
    );
    expect(sector).toBeDefined();

    const breach = findGridBreach(found.world, found.approachX, found.approachY, 1, 0);
    expect(breach).not.toBeNull();
    expect(breach!.gridId).toBe(found.bandId);
    expect(breach!.kind).toBe('corridor');

    expect(clearSecurityGrid(found.world, found.bandId)).toBe(true);
    for (const index of found.tileIndices) {
      expect(sector!.tiles[index]).toBe(TileKind.Open);
    }
    // Already dark: the second call must refuse, or a profile would remember one fence twice.
    expect(clearSecurityGrid(found.world, found.bandId)).toBe(false);
  });

  it('replays a remembered band onto a freshly generated world', () => {
    const found = firstVerticalBand();
    const rebuilt = generateWorld(found.seed, BAND_INPUTS);
    expect(applyDownedSecurityGrids(rebuilt, [found.bandId])).toBe(1);
    for (const [key, sector] of rebuilt.sectors) {
      if (!found.bandId.startsWith(`band:${key}:`)) continue;
      for (const index of found.tileIndices) {
        expect(sector.tiles[index]).toBe(TileKind.Open);
      }
    }
  });
});
