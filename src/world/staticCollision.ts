/**
 * staticCollision — circle-vs-tile-grid physics for the expedition world.
 *
 * The only truth about what blocks a mover is the per-sector tile grid; there is
 * no second representation and nothing here consults SpatialHash, which stays the
 * home of dynamic entities. Motion is integrated axis-separately and substepped
 * so a dash can never step over a one-tile wall, and every entry point writes
 * through a caller-owned out-param: this runs for ~120 movers a frame and must
 * not allocate.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser,
 * src/game/, src/systems/ or the ECS.
 *
 * A tile only ever blocks motion toward it: the per-axis clamp is skipped when the mover's
 * centre is already on the tile's far side, or inside it. Without that check a ship resting on
 * a doorway jamb was clamped to the jamb's opposite face, which read as a teleport through rock.
 */

import {
  SECTOR_TILE_COLS,
  SECTOR_TILE_ROWS,
  SECTOR_TILE_COUNT,
  TILE_SIZE,
  TileKind,
  EdgeKind,
  directionDelta,
  tileIndex,
} from './worldTypes';
import type { EdgeDef, SectorDef, WorldMap } from './worldTypes';

/** How the membrane and void rules apply to whatever is moving. */
export enum MoverKind {
  Player = 0,
  Enemy = 1,
  Projectile = 2,
}

export interface CollisionResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

export function createCollisionResult(): CollisionResult {
  return { x: 0, y: 0, hitX: false, hitY: false };
}

const COLLISION_EPSILON = 0.001;
const MAX_SUBSTEP_DISTANCE = TILE_SIZE / 2;
const MAX_SUBSTEPS = 64;

const SECTOR_INDEX_BIAS = 1024;
const SECTOR_INDEX_SPAN = 2048;

interface SectorIndexEntry {
  sectorCount: number;
  bySectorCoord: Map<number, SectorDef>;
}

// Keyed by WorldMap identity so a new run's world simply gets a new entry and the
// old one is collectable; sectorCount catches a world whose sector set grew.
const sectorIndexCache = new WeakMap<WorldMap, SectorIndexEntry>();

function packSectorCoord(sx: number, sy: number): number {
  return (sx + SECTOR_INDEX_BIAS) * SECTOR_INDEX_SPAN + (sy + SECTOR_INDEX_BIAS);
}

function sectorAt(world: WorldMap, sx: number, sy: number): SectorDef | undefined {
  if (sx <= -SECTOR_INDEX_BIAS || sx >= SECTOR_INDEX_BIAS) return undefined;
  if (sy <= -SECTOR_INDEX_BIAS || sy >= SECTOR_INDEX_BIAS) return undefined;
  let entry = sectorIndexCache.get(world);
  if (entry === undefined || entry.sectorCount !== world.sectors.size) {
    const bySectorCoord = new Map<number, SectorDef>();
    for (const sector of world.sectors.values()) {
      bySectorCoord.set(packSectorCoord(sector.sx, sector.sy), sector);
    }
    entry = { sectorCount: world.sectors.size, bySectorCoord };
    sectorIndexCache.set(world, entry);
  }
  return entry.bySectorCoord.get(packSectorCoord(sx, sy));
}

function globalTileOf(worldCoord: number): number {
  return Math.floor(worldCoord / TILE_SIZE);
}

/** TileKind at a global tile coord, or -1 where no sector is generated. */
export function tileKindAt(world: WorldMap, globalTileX: number, globalTileY: number): number {
  const sx = Math.floor(globalTileX / SECTOR_TILE_COLS);
  const sy = Math.floor(globalTileY / SECTOR_TILE_ROWS);
  const sector = sectorAt(world, sx, sy);
  if (sector === undefined) return -1;
  const localTileX = globalTileX - sx * SECTOR_TILE_COLS;
  const localTileY = globalTileY - sy * SECTOR_TILE_ROWS;
  return sector.tiles[tileIndex(localTileX, localTileY)];
}

/**
 * A tile coordinate with no generated sector under it. tileKindAt reports -1; this is that same
 * absence narrowed to a byte, which is safe because TileKind's largest member is 6.
 */
export const TILE_KIND_OUTSIDE = 255;

/**
 * tileKindAt across a horizontal run of tiles, resolving each sector once per run instead of
 * once per tile. computeFlowField reads 9,216 tiles per refresh and paid the sector lookup on
 * every one of them; a run never spans more than one sector, and a sector is 32 tiles wide, so
 * a 96-tile row costs 3 or 4 lookups.
 */
export function readTileKindRun(
  world: WorldMap,
  startGlobalTileX: number,
  globalTileY: number,
  count: number,
  out: Uint8Array,
  outOffset: number,
): void {
  const sy = Math.floor(globalTileY / SECTOR_TILE_ROWS);
  const localTileY = globalTileY - sy * SECTOR_TILE_ROWS;
  let written = 0;
  while (written < count) {
    const globalTileX = startGlobalTileX + written;
    const sx = Math.floor(globalTileX / SECTOR_TILE_COLS);
    const localTileX = globalTileX - sx * SECTOR_TILE_COLS;
    const runLength = Math.min(SECTOR_TILE_COLS - localTileX, count - written);
    const sector = sectorAt(world, sx, sy);
    const runStart = outOffset + written;
    if (sector === undefined) {
      out.fill(TILE_KIND_OUTSIDE, runStart, runStart + runLength);
    } else {
      const sectorRowBase = tileIndex(0, localTileY);
      for (let step = 0; step < runLength; step++) {
        out[runStart + step] = sector.tiles[sectorRowBase + localTileX + step];
      }
    }
    written += runLength;
  }
}

function ringEdgeAt(sector: SectorDef, localTileX: number, localTileY: number): EdgeDef | null {
  if (localTileY === 0) return sector.edges.north;
  if (localTileY === SECTOR_TILE_ROWS - 1) return sector.edges.south;
  if (localTileX === 0) return sector.edges.west;
  if (localTileX === SECTOR_TILE_COLS - 1) return sector.edges.east;
  return null;
}

function oneWayEdgeAt(world: WorldMap, globalTileX: number, globalTileY: number): EdgeDef | null {
  const sx = Math.floor(globalTileX / SECTOR_TILE_COLS);
  const sy = Math.floor(globalTileY / SECTOR_TILE_ROWS);
  const sector = sectorAt(world, sx, sy);
  if (sector === undefined) return null;
  const edge = ringEdgeAt(sector, globalTileX - sx * SECTOR_TILE_COLS, globalTileY - sy * SECTOR_TILE_ROWS);
  if (edge === null || edge.kind !== EdgeKind.OneWay || edge.passDirection === undefined) return null;
  return edge;
}

function isSolidForMotion(
  world: WorldMap, globalTileX: number, globalTileY: number,
  moverKind: MoverKind, motionX: number, motionY: number,
): boolean {
  const kind = tileKindAt(world, globalTileX, globalTileY);
  if (kind === -1) return true;
  if (kind === TileKind.Open || kind === TileKind.HazardFloor) return false;
  // A gap is a hole in the floor and a fence is a curtain of light: a shot passes either,
  // a hull passes neither.
  if (kind === TileKind.VoidGap || kind === TileKind.SecurityGrid) {
    return moverKind !== MoverKind.Projectile;
  }
  if (kind !== TileKind.GateClosed) return true;
  if (moverKind === MoverKind.Enemy) return true;
  const membrane = oneWayEdgeAt(world, globalTileX, globalTileY);
  if (membrane === null) return true;
  if (moverKind === MoverKind.Projectile) return false;
  const { dsx, dsy } = directionDelta(membrane.passDirection!);
  return motionX * dsx + motionY * dsy < 0;
}

/**
 * Motionless query, for spawn legality and point samples. A membrane has no
 * answer without a direction of travel, so it counts as solid for movers and
 * open for projectiles — deliberately stricter than the resolver, which knows
 * which way the mover is going.
 */
export function isSolidAtWorld(
  world: WorldMap, x: number, y: number, moverKind: MoverKind,
): boolean {
  const globalTileX = globalTileOf(x);
  const globalTileY = globalTileOf(y);
  const kind = tileKindAt(world, globalTileX, globalTileY);
  if (kind === -1) return true;
  if (kind === TileKind.Open || kind === TileKind.HazardFloor) return false;
  if (kind === TileKind.VoidGap || kind === TileKind.SecurityGrid) {
    return moverKind !== MoverKind.Projectile;
  }
  if (kind !== TileKind.GateClosed) return true;
  if (moverKind !== MoverKind.Projectile) return true;
  return oneWayEdgeAt(world, globalTileX, globalTileY) === null;
}

export function resolveCircleMove(
  world: WorldMap, prevX: number, prevY: number,
  nextX: number, nextY: number, radius: number,
  moverKind: MoverKind, out: CollisionResult,
): void {
  out.hitX = false;
  out.hitY = false;
  const totalDx = nextX - prevX;
  const totalDy = nextY - prevY;
  const longestAxis = Math.max(Math.abs(totalDx), Math.abs(totalDy));
  const substeps = Math.min(
    MAX_SUBSTEPS, Math.max(1, Math.ceil(longestAxis / MAX_SUBSTEP_DISTANCE)),
  );
  const stepDx = totalDx / substeps;
  const stepDy = totalDy / substeps;
  let x = prevX;
  let y = prevY;
  for (let step = 0; step < substeps; step++) {
    x = resolveAxisX(world, x, y, stepDx, stepDy, radius, moverKind, out);
    y = resolveAxisY(world, x, y, stepDx, stepDy, radius, moverKind, out);
  }
  out.x = x;
  out.y = y;
}

function resolveAxisX(
  world: WorldMap, x: number, y: number, stepDx: number, stepDy: number,
  radius: number, moverKind: MoverKind, out: CollisionResult,
): number {
  if (stepDx === 0) return x;
  let candidateX = x + stepDx;
  const minTileY = globalTileOf(y - radius);
  const maxTileY = globalTileOf(y + radius);
  const minTileX = globalTileOf(candidateX - radius);
  const maxTileX = globalTileOf(candidateX + radius);
  for (let globalTileY = minTileY; globalTileY <= maxTileY; globalTileY++) {
    for (let globalTileX = minTileX; globalTileX <= maxTileX; globalTileX++) {
      if (!isSolidForMotion(world, globalTileX, globalTileY, moverKind, stepDx, stepDy)) continue;
      const tileTop = globalTileY * TILE_SIZE;
      const tileBottom = tileTop + TILE_SIZE;
      let clearance = radius;
      if (y < tileTop) {
        const gap = tileTop - y;
        if (gap >= radius) continue;
        clearance = Math.sqrt(radius * radius - gap * gap);
      } else if (y > tileBottom) {
        const gap = y - tileBottom;
        if (gap >= radius) continue;
        clearance = Math.sqrt(radius * radius - gap * gap);
      }
      const tileLeft = globalTileX * TILE_SIZE;
      if (stepDx > 0) {
        if (x >= tileLeft) continue;
        const limit = tileLeft - clearance - COLLISION_EPSILON;
        if (candidateX > limit) {
          candidateX = limit;
          out.hitX = true;
        }
      } else {
        if (x <= tileLeft + TILE_SIZE) continue;
        const limit = tileLeft + TILE_SIZE + clearance + COLLISION_EPSILON;
        if (candidateX < limit) {
          candidateX = limit;
          out.hitX = true;
        }
      }
    }
  }
  return candidateX;
}

function resolveAxisY(
  world: WorldMap, x: number, y: number, stepDx: number, stepDy: number,
  radius: number, moverKind: MoverKind, out: CollisionResult,
): number {
  if (stepDy === 0) return y;
  let candidateY = y + stepDy;
  const minTileX = globalTileOf(x - radius);
  const maxTileX = globalTileOf(x + radius);
  const minTileY = globalTileOf(candidateY - radius);
  const maxTileY = globalTileOf(candidateY + radius);
  for (let globalTileX = minTileX; globalTileX <= maxTileX; globalTileX++) {
    for (let globalTileY = minTileY; globalTileY <= maxTileY; globalTileY++) {
      if (!isSolidForMotion(world, globalTileX, globalTileY, moverKind, stepDx, stepDy)) continue;
      const tileLeft = globalTileX * TILE_SIZE;
      const tileRight = tileLeft + TILE_SIZE;
      let clearance = radius;
      if (x < tileLeft) {
        const gap = tileLeft - x;
        if (gap >= radius) continue;
        clearance = Math.sqrt(radius * radius - gap * gap);
      } else if (x > tileRight) {
        const gap = x - tileRight;
        if (gap >= radius) continue;
        clearance = Math.sqrt(radius * radius - gap * gap);
      }
      const tileTop = globalTileY * TILE_SIZE;
      if (stepDy > 0) {
        if (y >= tileTop) continue;
        const limit = tileTop - clearance - COLLISION_EPSILON;
        if (candidateY > limit) {
          candidateY = limit;
          out.hitY = true;
        }
      } else {
        if (y <= tileTop + TILE_SIZE) continue;
        const limit = tileTop + TILE_SIZE + clearance + COLLISION_EPSILON;
        if (candidateY < limit) {
          candidateY = limit;
          out.hitY = true;
        }
      }
    }
  }
  return candidateY;
}

/** t in [0,1] of the first solid tile entered; 1 means the segment is clear. */
export function raycastSolid(
  world: WorldMap, x1: number, y1: number, x2: number, y2: number, moverKind: MoverKind,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let globalTileX = globalTileOf(x1);
  let globalTileY = globalTileOf(y1);
  if (isSolidForMotion(world, globalTileX, globalTileY, moverKind, dx, dy)) return 0;
  if (dx === 0 && dy === 0) return 1;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(TILE_SIZE / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(TILE_SIZE / dy) : Infinity;
  let tMaxX = dx !== 0
    ? (dx > 0 ? (globalTileX + 1) * TILE_SIZE - x1 : x1 - globalTileX * TILE_SIZE) / Math.abs(dx)
    : Infinity;
  let tMaxY = dy !== 0
    ? (dy > 0 ? (globalTileY + 1) * TILE_SIZE - y1 : y1 - globalTileY * TILE_SIZE) / Math.abs(dy)
    : Infinity;
  for (;;) {
    const t = Math.min(tMaxX, tMaxY);
    if (t > 1) return 1;
    if (tMaxX < tMaxY) {
      globalTileX += stepX;
      tMaxX += tDeltaX;
    } else {
      globalTileY += stepY;
      tMaxY += tDeltaY;
    }
    // t is the parameter at which the ray enters the new tile, so it is the hit distance.
    if (isSolidForMotion(world, globalTileX, globalTileY, moverKind, dx, dy)) return t;
  }
}

const spotQueue = new Int32Array(SECTOR_TILE_COUNT * 2);
const spotVisited = new Uint8Array(SECTOR_TILE_COUNT);

/**
 * BFS rather than a spiral: a spiral can hand back a tile on the far side of a
 * wall, and invariant 12 requires the result to be reachable from the query.
 * Walking through solids is allowed only until the search first reaches open
 * space, which is what lets an embedded mover escape the blob it is stuck in.
 */
export function findNearestFreeCircleSpot(
  world: WorldMap, x: number, y: number, radius: number,
  out: { x: number; y: number },
): boolean {
  const sx = Math.floor(globalTileOf(x) / SECTOR_TILE_COLS);
  const sy = Math.floor(globalTileOf(y) / SECTOR_TILE_ROWS);
  const sector = sectorAt(world, sx, sy);
  if (sector === undefined) return false;
  const originTileX = sx * SECTOR_TILE_COLS;
  const originTileY = sy * SECTOR_TILE_ROWS;
  spotVisited.fill(0);
  let head = 0;
  let tail = 0;
  const startLocalX = globalTileOf(x) - originTileX;
  const startLocalY = globalTileOf(y) - originTileY;
  spotQueue[tail++] = startLocalX;
  spotQueue[tail++] = startLocalY;
  spotVisited[tileIndex(startLocalX, startLocalY)] = 1;
  while (head < tail) {
    const localTileX = spotQueue[head++];
    const localTileY = spotQueue[head++];
    if (circleFitsAtTileCentre(world, originTileX + localTileX, originTileY + localTileY, radius)) {
      out.x = (originTileX + localTileX) * TILE_SIZE + TILE_SIZE / 2;
      out.y = (originTileY + localTileY) * TILE_SIZE + TILE_SIZE / 2;
      return true;
    }
    const cameFromOpen = sector.tiles[tileIndex(localTileX, localTileY)] === TileKind.Open;
    for (let neighbour = 0; neighbour < 4; neighbour++) {
      const nextX = localTileX + (neighbour === 0 ? 1 : neighbour === 1 ? -1 : 0);
      const nextY = localTileY + (neighbour === 2 ? 1 : neighbour === 3 ? -1 : 0);
      if (nextX < 0 || nextX >= SECTOR_TILE_COLS || nextY < 0 || nextY >= SECTOR_TILE_ROWS) continue;
      const index = tileIndex(nextX, nextY);
      if (spotVisited[index] === 1) continue;
      if (cameFromOpen && sector.tiles[index] !== TileKind.Open) continue;
      spotVisited[index] = 1;
      spotQueue[tail++] = nextX;
      spotQueue[tail++] = nextY;
    }
  }
  return false;
}

function circleFitsAtTileCentre(
  world: WorldMap, globalTileX: number, globalTileY: number, radius: number,
): boolean {
  const centreX = globalTileX * TILE_SIZE + TILE_SIZE / 2;
  const centreY = globalTileY * TILE_SIZE + TILE_SIZE / 2;
  const minTileX = globalTileOf(centreX - radius);
  const maxTileX = globalTileOf(centreX + radius);
  const minTileY = globalTileOf(centreY - radius);
  const maxTileY = globalTileOf(centreY + radius);
  for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
      if (tileKindAt(world, tileX, tileY) !== TileKind.Open) return false;
    }
  }
  return true;
}
