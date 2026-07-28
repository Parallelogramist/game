/**
 * barrierState: which breakable barrier occupies a world point, how much punishment it has
 * taken, and what clearing it does to the tile grid.
 *
 * A barrier is tile state, not an entity. The crate Destructible pattern cannot reach one:
 * a travelling projectile is removed by the wall test on the frame it enters the tile, one
 * frame before any 20 px entity hit test could fire, and an edge plug is up to five tiles
 * wide while that test is a fixed radius around a single Transform. So the impact is
 * reported from the same choke point that already stops the projectile, and the barrier
 * carries a count of impacts rather than a Health component.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS. Persistence is the caller's job for the same reason (the store
 * lives in src/expedition/), which is what the event sink is for.
 */

import {
  SECTOR_TILE_COLS,
  SECTOR_TILE_ROWS,
  TILE_SIZE,
  EdgeKind,
  TileKind,
  directionDelta,
  edgeIdFor,
  oppositeDirection,
  tileIndex,
} from './worldTypes';
import type { EdgeDirection, SectorDef, TileCoord, WorldMap } from './worldTypes';

/** Player projectile impacts a structural barrier absorbs before it collapses. */
export const BARRIER_IMPACTS_TO_BREAK = 10;

export interface BarrierEventSink {
  onBarrierChipped(x: number, y: number, barrierId: string): void;
  onBarrierBroken(x: number, y: number, barrierId: string): void;
}

const EDGE_BARRIER_ID = /^edge:(-?\d+),(-?\d+):(north|east|south|west)$/;
const POCKET_BARRIER_ID = /^breakable:(-?\d+),(-?\d+):(\d+)$/;

// Keyed by WorldMap identity, so a new run's world simply gets a new entry and a half
// chipped wall never carries into it. Same reason staticCollision keys its sector index
// this way: there is no reset function to forget to call.
const impactsByWorld = new WeakMap<WorldMap, Map<string, number>>();

let eventSink: BarrierEventSink | null = null;

export function setBarrierEventSink(sink: BarrierEventSink | null): void {
  eventSink = sink;
}

function sectorAt(world: WorldMap, sx: number, sy: number): SectorDef | undefined {
  return world.sectors.get(`${sx},${sy}`);
}

/** Which border ring a local tile sits on, or null for an interior tile. Order matches
 *  staticCollision's ringEdgeAt so a corner resolves the same way in both. */
function ringDirectionAt(localTileX: number, localTileY: number): EdgeDirection | null {
  if (localTileY === 0) return 'north';
  if (localTileY === SECTOR_TILE_ROWS - 1) return 'south';
  if (localTileX === 0) return 'west';
  if (localTileX === SECTOR_TILE_COLS - 1) return 'east';
  return null;
}

/** The depth-0 mouth tile of an aperture: the only depth stampApertures paints breakable. */
function mouthTileAt(direction: EdgeDirection, axisIndex: number): TileCoord {
  switch (direction) {
    case 'north': return { tileX: axisIndex, tileY: 0 };
    case 'south': return { tileX: axisIndex, tileY: SECTOR_TILE_ROWS - 1 };
    case 'west': return { tileX: 0, tileY: axisIndex };
    case 'east': return { tileX: SECTOR_TILE_COLS - 1, tileY: axisIndex };
  }
}

/**
 * Id of the breakable barrier covering a world point, or null. An edge plug answers with
 * the canonical edge id, identical from either sector, which is what stops the two mouth
 * bands of one plug from being two barriers with two independent impact counts.
 */
export function barrierIdAtWorld(world: WorldMap, x: number, y: number): string | null {
  const globalTileX = Math.floor(x / TILE_SIZE);
  const globalTileY = Math.floor(y / TILE_SIZE);
  const sx = Math.floor(globalTileX / SECTOR_TILE_COLS);
  const sy = Math.floor(globalTileY / SECTOR_TILE_ROWS);
  const sector = sectorAt(world, sx, sy);
  if (sector === undefined) return null;
  const localTileX = globalTileX - sx * SECTOR_TILE_COLS;
  const localTileY = globalTileY - sy * SECTOR_TILE_ROWS;
  if (sector.tiles[tileIndex(localTileX, localTileY)] !== TileKind.Breakable) return null;

  const direction = ringDirectionAt(localTileX, localTileY);
  if (direction !== null) {
    const edge = sector.edges[direction];
    const axisIndex = direction === 'north' || direction === 'south' ? localTileX : localTileY;
    if (edge.kind === EdgeKind.Breakable
      && axisIndex >= edge.apertureStart && axisIndex <= edge.apertureEnd) {
      return edgeIdFor(sector.sx, sector.sy, direction);
    }
  }

  for (const rect of sector.breakables) {
    if (localTileX >= rect.tileX && localTileX < rect.tileX + rect.tileW
      && localTileY >= rect.tileY && localTileY < rect.tileY + rect.tileH) {
      return rect.id;
    }
  }
  return null;
}

function clearMouth(sector: SectorDef, direction: EdgeDirection): boolean {
  const edge = sector.edges[direction];
  if (edge.kind !== EdgeKind.Breakable) return false;
  let cleared = false;
  for (let axisIndex = edge.apertureStart; axisIndex <= edge.apertureEnd; axisIndex++) {
    const { tileX, tileY } = mouthTileAt(direction, axisIndex);
    const index = tileIndex(tileX, tileY);
    if (sector.tiles[index] !== TileKind.Breakable) continue;
    sector.tiles[index] = TileKind.Open;
    cleared = true;
  }
  return cleared;
}

function clearEdgePlug(world: WorldMap, barrierId: string): boolean {
  const match = EDGE_BARRIER_ID.exec(barrierId);
  if (match === null) return false;
  const sx = Number(match[1]);
  const sy = Number(match[2]);
  const direction = match[3] as EdgeDirection;
  const near = sectorAt(world, sx, sy);
  if (near === undefined) return false;
  const { dsx, dsy } = directionDelta(direction);
  const far = sectorAt(world, sx + dsx, sy + dsy);
  // Both mouths or the plug is still a wall from one side: each sector stamped its own.
  const nearCleared = clearMouth(near, direction);
  const farCleared = far !== undefined && clearMouth(far, oppositeDirection(direction));
  return nearCleared || farCleared;
}

function clearPocket(world: WorldMap, barrierId: string): boolean {
  const match = POCKET_BARRIER_ID.exec(barrierId);
  if (match === null) return false;
  const sector = sectorAt(world, Number(match[1]), Number(match[2]));
  if (sector === undefined) return false;
  const rect = sector.breakables.find(candidate => candidate.id === barrierId);
  if (rect === undefined) return false;
  let cleared = false;
  for (let offsetY = 0; offsetY < rect.tileH; offsetY++) {
    for (let offsetX = 0; offsetX < rect.tileW; offsetX++) {
      const index = tileIndex(rect.tileX + offsetX, rect.tileY + offsetY);
      if (sector.tiles[index] !== TileKind.Breakable) continue;
      sector.tiles[index] = TileKind.Open;
      cleared = true;
    }
  }
  return cleared;
}

/** Opens a barrier's tiles. False for an unknown, foreign or already open barrier. */
export function clearBarrier(world: WorldMap, barrierId: string): boolean {
  return barrierId.startsWith('edge:')
    ? clearEdgePlug(world, barrierId)
    : clearPocket(world, barrierId);
}

/** Replays a profile's remembered breaks onto a freshly generated world. */
export function applyBrokenBarriers(world: WorldMap, barrierIds: readonly string[]): number {
  let applied = 0;
  for (const barrierId of barrierIds) {
    if (clearBarrier(world, barrierId)) applied++;
  }
  return applied;
}

/**
 * One player projectile impact at a world point. A point in open floor or in permanent rock
 * is not an error, it is the common case: the caller reports every blocked projectile and
 * this decides whether anything there can be broken.
 */
export function reportPlayerImpact(world: WorldMap, x: number, y: number): void {
  const barrierId = barrierIdAtWorld(world, x, y);
  if (barrierId === null) return;
  let counters = impactsByWorld.get(world);
  if (counters === undefined) {
    counters = new Map<string, number>();
    impactsByWorld.set(world, counters);
  }
  const landed = (counters.get(barrierId) ?? 0) + 1;
  if (landed < BARRIER_IMPACTS_TO_BREAK) {
    counters.set(barrierId, landed);
    eventSink?.onBarrierChipped(x, y, barrierId);
    return;
  }
  counters.delete(barrierId);
  clearBarrier(world, barrierId);
  eventSink?.onBarrierBroken(x, y, barrierId);
}
