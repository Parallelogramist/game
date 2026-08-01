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
 * Ability doors live here too: they are the same shape (tile state on the shared grid, an
 * edge id for identity, both mouths cleared at once) with a different key, and doc 02
 * section 4 files them under the same barrier taxonomy.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS. Persistence is the caller's job for the same reason (the store
 * lives in src/expedition/), which is what the event sink is for.
 */

import {
  EDGE_DIRECTIONS,
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
import type {
  BreakableRect, EdgeDef, EdgeDirection, SectorDef, TileCoord, WorldMap,
} from './worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from './worldSpace';

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

/**
 * Seconds a barrier ignores further CONTACT impacts after taking one. A swept beam is a
 * per-frame state query and a ricochet can rattle, so an ungated contact would break a wall in
 * a fifth of a second; a traveller reports one impact per projectile and needs no gate. The
 * value is Energy Darts' base cooldown, so BARRIER_IMPACTS_TO_BREAK contacts cost the same 5.0 s
 * of sustained fire a starting projectile build pays. It is per barrier rather than per weapon:
 * how long a wall takes to fall is a property of the wall, not of the loadout.
 */
export const BARRIER_CONTACT_INTERVAL_SECONDS = 0.5;

// Same WeakMap-by-world keying as impactsByWorld, for the same reason: a new run's world gets a
// new entry and there is no reset function to forget to call.
const contactAtByWorld = new WeakMap<WorldMap, Map<string, number>>();

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

/** Doc 02 section 4.3: a door the profile can pass opens when the ship gets this close. */
export const ABILITY_DOOR_OPEN_RADIUS = 60;

export interface ClosedGatedDoor {
  edgeId: string;
  /** The ability id or quest key id the profile must hold. Never undefined: a gated edge
   *  without one is not a candidate, because nothing could ever satisfy it. */
  requiredId: string;
  /** Centre of the door's mouth band in world px, for the caller's effects. */
  x: number;
  y: number;
}

/** The mouth band of one aperture in world px: one tile deep, the aperture span wide. */
function mouthBandRect(
  sector: SectorDef, direction: EdgeDirection, edge: EdgeDef,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const originX = sector.sx * SECTOR_WIDTH;
  const originY = sector.sy * SECTOR_HEIGHT;
  const spanStart = edge.apertureStart * TILE_SIZE;
  const spanEnd = (edge.apertureEnd + 1) * TILE_SIZE;
  switch (direction) {
    case 'north':
      return { minX: originX + spanStart, minY: originY,
        maxX: originX + spanEnd, maxY: originY + TILE_SIZE };
    case 'south':
      return { minX: originX + spanStart, minY: originY + SECTOR_HEIGHT - TILE_SIZE,
        maxX: originX + spanEnd, maxY: originY + SECTOR_HEIGHT };
    case 'west':
      return { minX: originX, minY: originY + spanStart,
        maxX: originX + TILE_SIZE, maxY: originY + spanEnd };
    case 'east':
      return { minX: originX + SECTOR_WIDTH - TILE_SIZE, minY: originY + spanStart,
        maxX: originX + SECTOR_WIDTH, maxY: originY + spanEnd };
  }
}

function distanceToRect(
  x: number, y: number,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dy = Math.max(rect.minY - y, 0, y - rect.maxY);
  return Math.hypot(dx, dy);
}

/** True while any of this sector's own mouth tiles for the aperture is still GateClosed. */
function gateStillClosed(sector: SectorDef, direction: EdgeDirection): boolean {
  const edge = sector.edges[direction];
  for (let axisIndex = edge.apertureStart; axisIndex <= edge.apertureEnd; axisIndex++) {
    const { tileX, tileY } = mouthTileAt(direction, axisIndex);
    if (sector.tiles[tileIndex(tileX, tileY)] === TileKind.GateClosed) return true;
  }
  return false;
}

/**
 * The nearest still-closed gated door within radius of a point, searched in the point's own
 * sector only: both sectors stamp their own mouth band, so a player near a shared door is
 * always near the band on their side of it. Ownership is the caller's test, not this one's.
 */
export function gatedDoorNearWorld(
  world: WorldMap, x: number, y: number, radius: number, kind: EdgeKind,
): ClosedGatedDoor | null {
  const sx = Math.floor(x / SECTOR_WIDTH);
  const sy = Math.floor(y / SECTOR_HEIGHT);
  const sector = sectorAt(world, sx, sy);
  if (sector === undefined) return null;

  let best: ClosedGatedDoor | null = null;
  let bestDistance = radius;
  for (const direction of EDGE_DIRECTIONS) {
    const edge = sector.edges[direction];
    if (edge.kind !== kind || edge.requiredId === undefined) continue;
    if (!gateStillClosed(sector, direction)) continue;
    const band = mouthBandRect(sector, direction, edge);
    const distance = distanceToRect(x, y, band);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = {
      edgeId: edgeIdFor(sector.sx, sector.sy, direction),
      requiredId: edge.requiredId,
      x: (band.minX + band.maxX) / 2,
      y: (band.minY + band.maxY) / 2,
    };
  }
  return best;
}

/** True while any mouth tile of a breakable plug is still standing. */
function plugStillIntact(sector: SectorDef, direction: EdgeDirection): boolean {
  const edge = sector.edges[direction];
  for (let axisIndex = edge.apertureStart; axisIndex <= edge.apertureEnd; axisIndex++) {
    const { tileX, tileY } = mouthTileAt(direction, axisIndex);
    if (sector.tiles[tileIndex(tileX, tileY)] === TileKind.Breakable) return true;
  }
  return false;
}

function pocketRectWorld(
  sector: SectorDef, rect: BreakableRect,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const originX = sector.sx * SECTOR_WIDTH;
  const originY = sector.sy * SECTOR_HEIGHT;
  return {
    minX: originX + rect.tileX * TILE_SIZE,
    minY: originY + rect.tileY * TILE_SIZE,
    maxX: originX + (rect.tileX + rect.tileW) * TILE_SIZE,
    maxY: originY + (rect.tileY + rect.tileH) * TILE_SIZE,
  };
}

function pocketStillIntact(sector: SectorDef, rect: BreakableRect): boolean {
  for (let offsetY = 0; offsetY < rect.tileH; offsetY++) {
    for (let offsetX = 0; offsetX < rect.tileW; offsetX++) {
      const index = tileIndex(rect.tileX + offsetX, rect.tileY + offsetY);
      if (sector.tiles[index] === TileKind.Breakable) return true;
    }
  }
  return false;
}

export interface BreakableTarget {
  /** Canonical barrier id: the edge id for a plug, the rect id for a pocket. */
  barrierId: string;
  /** Centre of the barrier's rect in world px, for the caller's effects. */
  x: number;
  y: number;
}

/**
 * The nearest still-intact breakable barrier within radius, searched in the point's own
 * sector only for the same reason gatedDoorNearWorld is: both sides of a plug stamp their
 * own mouth band, so a ship near a shared seam is always near the band on its own side.
 * An already-cleared plug or pocket is never returned, which is what stops a caller from
 * re-arming forever on a hole it already opened.
 */
export function nearestBreakableBarrier(
  world: WorldMap, x: number, y: number, radius: number,
): BreakableTarget | null {
  const sx = Math.floor(x / SECTOR_WIDTH);
  const sy = Math.floor(y / SECTOR_HEIGHT);
  const sector = sectorAt(world, sx, sy);
  if (sector === undefined) return null;

  let best: BreakableTarget | null = null;
  let bestDistance = radius;

  for (const direction of EDGE_DIRECTIONS) {
    const edge = sector.edges[direction];
    if (edge.kind !== EdgeKind.Breakable) continue;
    if (!plugStillIntact(sector, direction)) continue;
    const band = mouthBandRect(sector, direction, edge);
    const distance = distanceToRect(x, y, band);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = {
      barrierId: edgeIdFor(sector.sx, sector.sy, direction),
      x: (band.minX + band.maxX) / 2,
      y: (band.minY + band.maxY) / 2,
    };
  }

  for (const rect of sector.breakables) {
    if (!pocketStillIntact(sector, rect)) continue;
    const box = pocketRectWorld(sector, rect);
    const distance = distanceToRect(x, y, box);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = {
      barrierId: rect.id,
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
    };
  }

  return best;
}

/**
 * Clears one side's mouth band. Guarded on the gated kinds rather than on the tile kind,
 * because a one-way membrane stamps GateClosed tiles too (sectorInterior's apertureMouthTile),
 * and dissolving one would delete the escape rule the whole membrane exists for.
 */
function clearGateMouth(sector: SectorDef, direction: EdgeDirection): boolean {
  const edge = sector.edges[direction];
  if (edge.kind !== EdgeKind.AbilityDoor && edge.kind !== EdgeKind.KeyDoor) return false;
  let cleared = false;
  for (let axisIndex = edge.apertureStart; axisIndex <= edge.apertureEnd; axisIndex++) {
    const { tileX, tileY } = mouthTileAt(direction, axisIndex);
    const index = tileIndex(tileX, tileY);
    if (sector.tiles[index] !== TileKind.GateClosed) continue;
    sector.tiles[index] = TileKind.Open;
    cleared = true;
  }
  return cleared;
}

/** Opens both mouths of an ability door. False for an unknown, foreign or already-open one. */
export function openAbilityGate(world: WorldMap, edgeId: string): boolean {
  const match = EDGE_BARRIER_ID.exec(edgeId);
  if (match === null) return false;
  const sx = Number(match[1]);
  const sy = Number(match[2]);
  const direction = match[3] as EdgeDirection;
  const near = sectorAt(world, sx, sy);
  if (near === undefined) return false;
  const { dsx, dsy } = directionDelta(direction);
  const far = sectorAt(world, sx + dsx, sy + dsy);
  const nearCleared = clearGateMouth(near, direction);
  const farCleared = far !== undefined && clearGateMouth(far, oppositeDirection(direction));
  return nearCleared || farCleared;
}

/**
 * Replays ownership onto a freshly generated world: every door keyed to an ability the profile
 * already holds is open before anything reads the grid. This is why no per-edge open state is
 * persisted, and it is the whole of "already open on the next run".
 */
export function applyOwnedAbilityGates(
  world: WorldMap, ownedAbilityIds: readonly string[],
): number {
  return applyGateKeys(world, EdgeKind.AbilityDoor, ownedAbilityIds);
}

/** The quest-key half of applyOwnedAbilityGates: a door keyed to a chain this profile already
 *  finished is open before the renderer, the collision index or the flow field look. */
export function applyEarnedQuestKeys(
  world: WorldMap, earnedKeyIds: readonly string[],
): number {
  return applyGateKeys(world, EdgeKind.KeyDoor, earnedKeyIds);
}

function applyGateKeys(
  world: WorldMap, kind: EdgeKind, heldIds: readonly string[],
): number {
  if (heldIds.length === 0) return 0;
  const held = new Set(heldIds);
  const edgeIds = new Set<string>();
  for (const sector of world.sectors.values()) {
    for (const direction of EDGE_DIRECTIONS) {
      const edge = sector.edges[direction];
      if (edge.kind !== kind || edge.requiredId === undefined) continue;
      if (!held.has(edge.requiredId)) continue;
      edgeIds.add(edgeIdFor(sector.sx, sector.sy, direction));
    }
  }
  let opened = 0;
  for (const edgeId of edgeIds) {
    if (openAbilityGate(world, edgeId)) opened++;
  }
  return opened;
}

function landImpact(world: WorldMap, barrierId: string, x: number, y: number): void {
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
  contactAtByWorld.get(world)?.delete(barrierId);
  clearBarrier(world, barrierId);
  eventSink?.onBarrierBroken(x, y, barrierId);
}

/**
 * One player projectile impact at a world point. A point in open floor or in permanent rock
 * is not an error, it is the common case: the caller reports every blocked projectile and
 * this decides whether anything there can be broken.
 */
export function reportPlayerImpact(world: WorldMap, x: number, y: number): void {
  const barrierId = barrierIdAtWorld(world, x, y);
  if (barrierId === null) return;
  landImpact(world, barrierId, x, y);
}

/**
 * The same impact from a source that can touch the same barrier many times a second: a swept
 * beam, a clipped hitscan line, a bouncing ball. Rate limited per barrier by
 * BARRIER_CONTACT_INTERVAL_SECONDS, so sustained contact costs what a traveller costs.
 */
export function reportPlayerContactImpact(
  world: WorldMap, x: number, y: number, nowSeconds: number,
): void {
  const barrierId = barrierIdAtWorld(world, x, y);
  if (barrierId === null) return;
  let contactAt = contactAtByWorld.get(world);
  if (contactAt === undefined) {
    contactAt = new Map<string, number>();
    contactAtByWorld.set(world, contactAt);
  }
  const previous = contactAt.get(barrierId);
  // nowSeconds is the run's gameTime, which restarts at 0: a timestamp from the future is a
  // new run against a reused world, and must not mute contact until the clock catches up.
  const muted = previous !== undefined
    && nowSeconds >= previous
    && nowSeconds - previous < BARRIER_CONTACT_INTERVAL_SECONDS;
  if (muted) return;
  contactAt.set(barrierId, nowSeconds);
  landImpact(world, barrierId, x, y);
}
