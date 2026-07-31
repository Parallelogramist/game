/**
 * worldTypes — the shared vocabulary for the expedition world.
 *
 * The tile grid is derived from worldSpace's sector size rather than restated:
 * a second copy of those constants is a silent way for the tile grid and the
 * world plane to drift apart, so TILE_SIZE is the only new number here and the
 * column/row counts fall out of it.
 *
 * Phaser-free like the rest of src/world/: nothing under this directory may
 * import Phaser, src/game/, src/systems/ or the ECS.
 */

import { SECTOR_WIDTH, SECTOR_HEIGHT } from './worldSpace';
import type { WorldRect } from './worldSpace';

/** Bump when generator output would change for a given seed. */
export const WORLDGEN_VERSION = 3;

export const TILE_SIZE = 40;
export const SECTOR_TILE_COLS = SECTOR_WIDTH / TILE_SIZE;
export const SECTOR_TILE_ROWS = SECTOR_HEIGHT / TILE_SIZE;
export const SECTOR_TILE_COUNT = SECTOR_TILE_COLS * SECTOR_TILE_ROWS;

export const DEFAULT_SECTOR_BUDGET = 48;

export enum TileKind {
  Open = 0,
  Solid = 1,
  Breakable = 2,
  GateClosed = 3,
  HazardFloor = 4,
}

export enum EdgeKind {
  Wall = 0,
  Open = 1,
  AbilityDoor = 2,
  KeyDoor = 3,
  Breakable = 4,
  OneWay = 5,
}

export enum PoiKind {
  AbilityPowerUp = 0,
  QuestGiver = 1,
  Secret = 2,
  Treasure = 3,
  Shrine = 4,
}

export type SectorKey = string;
export type EdgeDirection = 'north' | 'east' | 'south' | 'west';

export const EDGE_DIRECTIONS: readonly EdgeDirection[] = ['north', 'east', 'south', 'west'];

export interface TileCoord { tileX: number; tileY: number }

export interface EdgeDef {
  kind: EdgeKind;
  /** Inclusive tile span of the aperture along the shared border's axis:
   *  columns for north/south, rows for east/west. Empty span is [0, -1]. */
  apertureStart: number;
  apertureEnd: number;
  /** AbilityDoor/KeyDoor: the id the profile must hold to pass. */
  requiredId?: string;
  /** OneWay: an ABSOLUTE lattice direction, identical on both sides of the edge. */
  passDirection?: EdgeDirection;
}

export interface PoiSlot {
  id: string;
  kind: PoiKind;
  tileX: number;
  tileY: number;
  grantsAbilityId?: string;
}

export interface BreakableRect {
  id: string;
  tileX: number; tileY: number; tileW: number; tileH: number;
}

export interface SectorDef {
  sx: number;
  sy: number;
  key: SectorKey;
  biomeId: string;
  danger: number;
  tiles: Uint8Array;
  edges: Record<EdgeDirection, EdgeDef>;
  poiSlots: PoiSlot[];
  isStart: boolean;
  isBossArena: boolean;
  /** Absent from the map and from the completion denominator until the ship has been
   *  inside it. Optional so the SectorDef literals in six test files stay valid. */
  hidden?: boolean;
  depth: number;
  entryTiles: Partial<Record<EdgeDirection, TileCoord>>;
  breakables: BreakableRect[];
}

export interface WorldMap {
  worldGenVersion: number;
  seed: number;
  startKey: SectorKey;
  sectors: Map<SectorKey, SectorDef>;
  /** Ability ids actually gated by this world, in unlock order. */
  abilityOrder: string[];
  bossArenaKey: SectorKey;
}

export interface WorldGenInputs {
  abilityGateOrder: string[];
  /** Quest key ids to seal optional regions behind, in order. Omitted means no quest doors,
   *  which is what every non-expedition caller and the invariant suite want. */
  questKeyOrder?: string[];
  /** How many dead-end leaf sectors to conceal behind a breakable wall. Omitted or 0 means
   *  none, which is what every non-expedition caller and the invariant suite want. */
  hiddenSectorCount?: number;
  availableBiomeIds: string[];
  sectorBudget?: number;
}

export function tileIndex(tileX: number, tileY: number): number {
  return tileY * SECTOR_TILE_COLS + tileX;
}

export function isTileInBounds(tileX: number, tileY: number): boolean {
  return tileX >= 0 && tileX < SECTOR_TILE_COLS && tileY >= 0 && tileY < SECTOR_TILE_ROWS;
}

export function oppositeDirection(direction: EdgeDirection): EdgeDirection {
  switch (direction) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east': return 'west';
    case 'west': return 'east';
  }
}

export function directionDelta(direction: EdgeDirection): { dsx: number; dsy: number } {
  switch (direction) {
    case 'north': return { dsx: 0, dsy: -1 };
    case 'south': return { dsx: 0, dsy: 1 };
    case 'east': return { dsx: 1, dsy: 0 };
    case 'west': return { dsx: -1, dsy: 0 };
  }
}

/** Canonical edge id. The lexicographically smaller sector key names the edge,
 *  so both sectors produce the identical string (README section 3.1). */
export function edgeIdFor(sx: number, sy: number, direction: EdgeDirection): string {
  const { dsx, dsy } = directionDelta(direction);
  const here = `${sx},${sy}`;
  const there = `${sx + dsx},${sy + dsy}`;
  return here < there
    ? `edge:${here}:${direction}`
    : `edge:${there}:${oppositeDirection(direction)}`;
}

/** The absent edge. Shared by reference so reciprocity holds for walls too. */
export const WALL_EDGE: EdgeDef = Object.freeze({
  kind: EdgeKind.Wall, apertureStart: 0, apertureEnd: -1,
});

/**
 * The world plane a generated layout actually occupies. The generator grows outward
 * from 0,0 in every direction, so both the negative and the positive extent are
 * discovered from the sectors rather than assumed from a count.
 */
export function worldBoundsRect(world: WorldMap): WorldRect {
  let minCol = 0;
  let minRow = 0;
  let maxCol = 0;
  let maxRow = 0;
  let seen = false;
  for (const sector of world.sectors.values()) {
    if (!seen) {
      minCol = maxCol = sector.sx;
      minRow = maxRow = sector.sy;
      seen = true;
      continue;
    }
    if (sector.sx < minCol) minCol = sector.sx;
    if (sector.sx > maxCol) maxCol = sector.sx;
    if (sector.sy < minRow) minRow = sector.sy;
    if (sector.sy > maxRow) maxRow = sector.sy;
  }
  return {
    minX: minCol * SECTOR_WIDTH,
    minY: minRow * SECTOR_HEIGHT,
    maxX: (maxCol + 1) * SECTOR_WIDTH,
    maxY: (maxRow + 1) * SECTOR_HEIGHT,
  };
}
