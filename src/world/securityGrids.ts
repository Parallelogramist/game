/**
 * securityGrids: where the Phase Cloak carries the ship through a laser fence, and what
 * tripping that fence's kill-switch does to the tile grid.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS. Persistence is the caller's job, the same split barrierState
 * keeps: this module changes tiles, GameScene records that it happened.
 */

import { SECTOR_TILE_COLS, SECTOR_TILE_ROWS, TILE_SIZE, TileKind } from './worldTypes';
import type { PoiSlot, SectorDef, WorldMap } from './worldTypes';
import { tileKindAt } from './staticCollision';
import { secretShellRingIndices } from './sectorInterior';

/** How far ahead of the ship the probe looks for the fence. Collision stops the hull one
 *  radius short, so the fence is never further than the next tile but one. */
export const GRID_PROBE_TILES = 2;
/** The widest run of fence tiles one pass crosses: a ring is one tile thick on an axis and
 *  two through a corner. */
export const GRID_MAX_SPAN_TILES = 2;
/** How far a fence announces itself to a ship that cannot pass it, in tiles. */
export const SECURITY_GRID_NOTICE_TILES = 2;

const GRID_POI_ID = /^poi:(-?\d+),(-?\d+):\d+$/;

export interface GridBreach {
  /** Centre of the tile the ship lands on, inside the fenced pocket. */
  x: number;
  y: number;
  /** Centre of the first fence tile: where the cloak bites. */
  fenceX: number;
  fenceY: number;
  /** PoiSlot.id of the altar this fence rings: the id the profile remembers. */
  poiId: string;
}

function isFloor(kind: number): boolean {
  return kind === TileKind.Open || kind === TileKind.HazardFloor;
}

function tileCentre(globalTile: number): number {
  return globalTile * TILE_SIZE + TILE_SIZE / 2;
}

/** The fenced slot whose pocket contains a global tile, or null. A landing tile is always
 *  one step inside the ring, so Chebyshev distance 1 from the slot is the whole test. */
function fencedSlotAt(
  world: WorldMap, globalTileX: number, globalTileY: number,
): PoiSlot | null {
  const sx = Math.floor(globalTileX / SECTOR_TILE_COLS);
  const sy = Math.floor(globalTileY / SECTOR_TILE_ROWS);
  const sector = world.sectors.get(`${sx},${sy}`);
  if (sector === undefined) return null;
  const localTileX = globalTileX - sx * SECTOR_TILE_COLS;
  const localTileY = globalTileY - sy * SECTOR_TILE_ROWS;
  for (const slot of sector.poiSlots) {
    if (slot.fenced !== true) continue;
    const chebyshev = Math.max(
      Math.abs(slot.tileX - localTileX), Math.abs(slot.tileY - localTileY),
    );
    if (chebyshev <= 1) return slot;
  }
  return null;
}

/**
 * Where a cloaked ship at (x, y) heading (dirX, dirY) comes out, or null when there is no
 * fence there to pass. The direction is snapped to its dominant axis for the same reason
 * the tether's is: a generated ring is axis-aligned and a diagonal probe would have to
 * pick a corner arbitrarily.
 *
 * A landing with no fenced slot owning it answers null rather than a breach: the id is
 * what the profile remembers, so a fence nothing can name must not go down.
 */
export function findGridBreach(
  world: WorldMap, x: number, y: number, dirX: number, dirY: number,
): GridBreach | null {
  const stepX = Math.abs(dirX) >= Math.abs(dirY) ? Math.sign(dirX) : 0;
  const stepY = stepX === 0 ? Math.sign(dirY) : 0;
  if (stepX === 0 && stepY === 0) return null;

  const startTileX = Math.floor(x / TILE_SIZE);
  const startTileY = Math.floor(y / TILE_SIZE);

  let offset = 1;
  for (; offset <= GRID_PROBE_TILES; offset++) {
    const kind = tileKindAt(world, startTileX + stepX * offset, startTileY + stepY * offset);
    if (kind === TileKind.SecurityGrid) break;
    if (!isFloor(kind)) return null;
  }
  if (offset > GRID_PROBE_TILES) return null;

  const fenceTileX = startTileX + stepX * offset;
  const fenceTileY = startTileY + stepY * offset;

  let spanTiles = 0;
  while (spanTiles < GRID_MAX_SPAN_TILES
    && tileKindAt(world, fenceTileX + stepX * spanTiles, fenceTileY + stepY * spanTiles)
      === TileKind.SecurityGrid) {
    spanTiles++;
  }

  const landingTileX = fenceTileX + stepX * spanTiles;
  const landingTileY = fenceTileY + stepY * spanTiles;
  if (!isFloor(tileKindAt(world, landingTileX, landingTileY))) return null;

  const slot = fencedSlotAt(world, landingTileX, landingTileY);
  if (slot === null) return null;

  return {
    x: tileCentre(landingTileX),
    y: tileCentre(landingTileY),
    fenceX: tileCentre(fenceTileX),
    fenceY: tileCentre(fenceTileY),
    poiId: slot.id,
  };
}

/** Whether any fence tile sits within SECURITY_GRID_NOTICE_TILES of a point. */
export function securityGridNearWorld(world: WorldMap, x: number, y: number): boolean {
  const centreTileX = Math.floor(x / TILE_SIZE);
  const centreTileY = Math.floor(y / TILE_SIZE);
  for (let offsetY = -SECURITY_GRID_NOTICE_TILES; offsetY <= SECURITY_GRID_NOTICE_TILES; offsetY++) {
    for (let offsetX = -SECURITY_GRID_NOTICE_TILES; offsetX <= SECURITY_GRID_NOTICE_TILES; offsetX++) {
      if (tileKindAt(world, centreTileX + offsetX, centreTileY + offsetY)
        === TileKind.SecurityGrid) {
        return true;
      }
    }
  }
  return false;
}

/** True while any cell of a fenced altar's ring is still lit. */
export function isGridFenceIntact(sector: SectorDef, slot: PoiSlot): boolean {
  if (slot.fenced !== true) return false;
  return secretShellRingIndices(slot.tileX, slot.tileY)
    .some(index => sector.tiles[index] === TileKind.SecurityGrid);
}

/** Trips one fence's kill-switch for good. False for an unknown, foreign or already dark
 *  fence, which is what stops a caller from recording the same id twice. */
export function clearSecurityGrid(world: WorldMap, poiId: string): boolean {
  const match = GRID_POI_ID.exec(poiId);
  if (match === null) return false;
  const sector = world.sectors.get(`${Number(match[1])},${Number(match[2])}`);
  if (sector === undefined) return false;
  const slot = sector.poiSlots.find(candidate => candidate.id === poiId);
  if (slot === undefined || slot.fenced !== true) return false;
  let cleared = false;
  for (const index of secretShellRingIndices(slot.tileX, slot.tileY)) {
    if (sector.tiles[index] !== TileKind.SecurityGrid) continue;
    sector.tiles[index] = TileKind.Open;
    cleared = true;
  }
  return cleared;
}

/** Replays a profile's tripped kill-switches onto a freshly generated world. */
export function applyDownedSecurityGrids(
  world: WorldMap, poiIds: readonly string[],
): number {
  let applied = 0;
  for (const poiId of poiIds) {
    if (clearSecurityGrid(world, poiId)) applied++;
  }
  return applied;
}
