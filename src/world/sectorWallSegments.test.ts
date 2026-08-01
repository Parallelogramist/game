import { describe, expect, test } from 'vitest';
import { sectorWallSegments, isOutlineBlocking, sectorImpassableRects } from './sectorWallSegments';
import {
  EdgeKind, SECTOR_TILE_COLS, SECTOR_TILE_ROWS, TILE_SIZE, TileKind, tileIndex,
} from './worldTypes';
import type { EdgeDef, EdgeDirection, SectorDef } from './worldTypes';

const WALL: EdgeDef = { kind: EdgeKind.Wall, apertureStart: 0, apertureEnd: -1 };

function blankSector(edges?: Partial<Record<EdgeDirection, EdgeDef>>): SectorDef {
  return {
    sx: 0, sy: 0, key: '0,0', biomeId: 'stage_deep_void', danger: 1,
    tiles: new Uint8Array(SECTOR_TILE_COLS * SECTOR_TILE_ROWS),
    edges: { north: WALL, east: WALL, south: WALL, west: WALL, ...edges },
    poiSlots: [], isStart: false, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
}

function paint(sector: SectorDef, tileX: number, tileY: number, kind: TileKind): void {
  sector.tiles[tileIndex(tileX, tileY)] = kind;
}

describe('sectorWallSegments', () => {
  test('an all-open sector has no wall segments', () => {
    expect(sectorWallSegments(blankSector()).segments).toHaveLength(0);
  });

  test('a lone solid tile emits its four faces', () => {
    const sector = blankSector();
    paint(sector, 5, 5, TileKind.Solid);
    const { segments } = sectorWallSegments(sector);
    expect(segments).toHaveLength(4);
    expect(segments).toContainEqual({ x1: 200, y1: 200, x2: 240, y2: 200, kind: TileKind.Solid });
    expect(segments).toContainEqual({ x1: 200, y1: 200, x2: 200, y2: 240, kind: TileKind.Solid });
  });

  test('a horizontal run of solid tiles merges into one top face and one bottom face', () => {
    const sector = blankSector();
    paint(sector, 3, 4, TileKind.Solid);
    paint(sector, 4, 4, TileKind.Solid);
    paint(sector, 5, 4, TileKind.Solid);
    const { segments } = sectorWallSegments(sector);
    expect(segments).toContainEqual({ x1: 120, y1: 160, x2: 240, y2: 160, kind: TileKind.Solid });
    expect(segments).toContainEqual({ x1: 120, y1: 200, x2: 240, y2: 200, kind: TileKind.Solid });
    expect(segments).toHaveLength(4);
  });

  test('faces between two touching solid tiles are not emitted', () => {
    const sector = blankSector();
    paint(sector, 3, 4, TileKind.Solid);
    paint(sector, 4, 4, TileKind.Solid);
    const { segments } = sectorWallSegments(sector);
    expect(segments).not.toContainEqual({ x1: 160, y1: 160, x2: 160, y2: 200, kind: TileKind.Solid });
  });

  test('a different tile kind does not merge into the same run', () => {
    const sector = blankSector();
    paint(sector, 3, 4, TileKind.Solid);
    paint(sector, 4, 4, TileKind.Breakable);
    const { segments } = sectorWallSegments(sector);
    expect(segments).toContainEqual({ x1: 120, y1: 160, x2: 160, y2: 160, kind: TileKind.Solid });
    expect(segments).toContainEqual({ x1: 160, y1: 160, x2: 200, y2: 160, kind: TileKind.Breakable });
  });

  test('a border tile does not emit its outward face', () => {
    const sector = blankSector();
    paint(sector, 0, 5, TileKind.Solid);
    const { segments } = sectorWallSegments(sector);
    expect(segments).not.toContainEqual({ x1: 0, y1: 200, x2: 0, y2: 240, kind: TileKind.Solid });
    expect(segments).toContainEqual({ x1: 40, y1: 200, x2: 40, y2: 240, kind: TileKind.Solid });
  });

  test('a north door anchors on the column span, a west door on the row span', () => {
    const sector = blankSector({
      north: { kind: EdgeKind.Open, apertureStart: 4, apertureEnd: 5 },
      west: { kind: EdgeKind.KeyDoor, apertureStart: 8, apertureEnd: 8 },
    });
    const { doors } = sectorWallSegments(sector);
    expect(doors).toHaveLength(2);
    expect(doors).toContainEqual({
      direction: 'north', kind: EdgeKind.Open, localX: 5 * TILE_SIZE, localY: TILE_SIZE / 2,
      outwardX: 0, outwardY: -1,
    });
    expect(doors).toContainEqual({
      direction: 'west', kind: EdgeKind.KeyDoor, localX: TILE_SIZE / 2, localY: 8.5 * TILE_SIZE,
      outwardX: -1, outwardY: 0,
    });
  });

  test('a wall border and an empty aperture produce no door', () => {
    const sector = blankSector({
      east: { kind: EdgeKind.Open, apertureStart: 0, apertureEnd: -1 },
    });
    expect(sectorWallSegments(sector).doors).toHaveLength(0);
    expect(isOutlineBlocking(TileKind.HazardFloor)).toBe(false);
    expect(isOutlineBlocking(TileKind.GateClosed)).toBe(true);
  });
});

describe('sectorImpassableRects', () => {
  function gappedAndFencedSector(): SectorDef {
    const sector = blankSector();
    paint(sector, 2, 3, TileKind.VoidGap);
    paint(sector, 3, 3, TileKind.VoidGap);
    paint(sector, 4, 3, TileKind.VoidGap);
    paint(sector, 7, 6, TileKind.SecurityGrid);
    return sector;
  }

  test('a chasm and a fence both become filled rects, and a run of three merges into one', () => {
    const rects = sectorImpassableRects(gappedAndFencedSector());
    expect(rects.some(rect => rect.kind === TileKind.VoidGap)).toBe(true);
    expect(rects.some(rect => rect.kind === TileKind.SecurityGrid)).toBe(true);
    expect(rects.every(rect => rect.width >= TILE_SIZE && rect.height === TILE_SIZE)).toBe(true);
    expect(rects).toContainEqual({
      x: 2 * TILE_SIZE, y: 3 * TILE_SIZE, width: 3 * TILE_SIZE, height: TILE_SIZE,
      kind: TileKind.VoidGap,
    });
    expect(rects).toContainEqual({
      x: 7 * TILE_SIZE, y: 6 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE,
      kind: TileKind.SecurityGrid,
    });
  });

  test('a gap or a fence never becomes a wall face (widening isOutlineBlocking would erase the outlines that touch it)', () => {
    const { segments } = sectorWallSegments(gappedAndFencedSector());
    expect(segments.every(segment => segment.kind !== TileKind.VoidGap
      && segment.kind !== TileKind.SecurityGrid)).toBe(true);
    expect(isOutlineBlocking(TileKind.VoidGap)).toBe(false);
    expect(isOutlineBlocking(TileKind.SecurityGrid)).toBe(false);
  });
});
