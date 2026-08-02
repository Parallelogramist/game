/**
 * flowField: one BFS per refresh over the tile block around the player, output as
 * one 8-direction code per tile. Every chasing enemy then costs one array read instead of
 * a path search, which is the cost shape a 100+ enemy survivors game needs.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS.
 */

import { TILE_SIZE, TileKind } from './worldTypes';
import type { WorldMap } from './worldTypes';
import { readTileKindRun } from './staticCollision';

/**
 * Sized from the enemy leash, not from sectors. A 3x3 sector block snapped to the sector grid
 * left a player standing near a sector corner with as little as one sector of field on the short
 * side, so an enemy well inside its 1600px leash could sit outside the block entirely and fall
 * through to the raw direct vector. Centred on the player's own tile, 48 tiles reaches 1920px in
 * every direction, which covers the leash with room to spare.
 */
export const FLOW_BLOCK_COLS = 96;
export const FLOW_BLOCK_ROWS = 96;
export const FLOW_BLOCK_TILE_COUNT = FLOW_BLOCK_COLS * FLOW_BLOCK_ROWS;

const FLOW_BLOCK_HALF_COLS = FLOW_BLOCK_COLS >> 1;
const FLOW_BLOCK_HALF_ROWS = FLOW_BLOCK_ROWS >> 1;

/** No route from this tile to the target (walled off, outside the block, or the target itself). */
export const FLOW_UNREACHABLE = 255;

/** Direction codes 0-7, clockwise from east. */
export const FLOW_STEP_X: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1];
export const FLOW_STEP_Y: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];

export interface FlowField {
  /** Global tile coord of the block's top-left tile. */
  originTileX: number;
  originTileY: number;
  /** FLOW_BLOCK_TILE_COUNT direction codes, FLOW_UNREACHABLE where no route exists. */
  directions: Uint8Array;
}

export function createFlowField(): FlowField {
  return {
    originTileX: 0,
    originTileY: 0,
    directions: new Uint8Array(FLOW_BLOCK_TILE_COUNT).fill(FLOW_UNREACHABLE),
  };
}

const UNVISITED = 0xffff;

// Scratch reused across refreshes, cleared at the top of every computeFlowField call. Like
// staticCollision's BFS buffers these carry nothing between calls, so unlike the systems in
// CLAUDE.md's reset rule they need no reset function.
const distances = new Uint16Array(FLOW_BLOCK_TILE_COUNT);
const walkable = new Uint8Array(FLOW_BLOCK_TILE_COUNT);
const queue = new Int32Array(FLOW_BLOCK_TILE_COUNT);
const kinds = new Uint8Array(FLOW_BLOCK_TILE_COUNT);

function globalTileOf(worldCoord: number): number {
  return Math.floor(worldCoord / TILE_SIZE);
}

/**
 * BFS from the player's tile over enemy-walkable tiles, then one descent pass writing the
 * neighbour that most reduces the distance. Open and HazardFloor are the walkable kinds,
 * which mirrors staticCollision's MoverKind.Enemy branch: an enemy is stopped by Solid,
 * Breakable and every closed gate including a one-way membrane.
 */
export function computeFlowField(
  world: WorldMap, targetWorldX: number, targetWorldY: number, field: FlowField,
): void {
  const targetTileX = globalTileOf(targetWorldX);
  const targetTileY = globalTileOf(targetWorldY);
  const originTileX = targetTileX - FLOW_BLOCK_HALF_COLS;
  const originTileY = targetTileY - FLOW_BLOCK_HALF_ROWS;
  field.originTileX = originTileX;
  field.originTileY = originTileY;

  const directions = field.directions;
  distances.fill(UNVISITED);
  directions.fill(FLOW_UNREACHABLE);

  for (let localY = 0; localY < FLOW_BLOCK_ROWS; localY++) {
    readTileKindRun(
      world, originTileX, originTileY + localY, FLOW_BLOCK_COLS, kinds, localY * FLOW_BLOCK_COLS,
    );
  }
  for (let index = 0; index < FLOW_BLOCK_TILE_COUNT; index++) {
    const kind = kinds[index];
    walkable[index] = (kind === TileKind.Open || kind === TileKind.HazardFloor) ? 1 : 0;
  }

  const targetLocalX = targetTileX - originTileX;
  const targetLocalY = targetTileY - originTileY;
  if (targetLocalX < 0 || targetLocalX >= FLOW_BLOCK_COLS) return;
  if (targetLocalY < 0 || targetLocalY >= FLOW_BLOCK_ROWS) return;

  // Seeded whether or not it is walkable: the player standing in a doorway tile must still
  // be reachable, and only walkable tiles are ever expanded from.
  const targetIndex = targetLocalY * FLOW_BLOCK_COLS + targetLocalX;
  distances[targetIndex] = 0;
  let head = 0;
  let tail = 0;
  queue[tail++] = targetIndex;

  while (head < tail) {
    const index = queue[head++];
    const localX = index % FLOW_BLOCK_COLS;
    const localY = (index - localX) / FLOW_BLOCK_COLS;
    const nextDistance = distances[index] + 1;
    for (let neighbour = 0; neighbour < 4; neighbour++) {
      const stepX = neighbour === 0 ? 1 : neighbour === 1 ? -1 : 0;
      const stepY = neighbour === 2 ? 1 : neighbour === 3 ? -1 : 0;
      const nx = localX + stepX;
      const ny = localY + stepY;
      if (nx < 0 || nx >= FLOW_BLOCK_COLS || ny < 0 || ny >= FLOW_BLOCK_ROWS) continue;
      const nextIndex = ny * FLOW_BLOCK_COLS + nx;
      if (walkable[nextIndex] === 0) continue;
      if (distances[nextIndex] !== UNVISITED) continue;
      distances[nextIndex] = nextDistance;
      queue[tail++] = nextIndex;
    }
  }

  for (let localY = 0; localY < FLOW_BLOCK_ROWS; localY++) {
    for (let localX = 0; localX < FLOW_BLOCK_COLS; localX++) {
      const index = localY * FLOW_BLOCK_COLS + localX;
      const distance = distances[index];
      if (distance === UNVISITED || distance === 0) continue;
      let bestCode = FLOW_UNREACHABLE;
      let bestDistance = distance;
      for (let code = 0; code < 8; code++) {
        const stepX = FLOW_STEP_X[code];
        const stepY = FLOW_STEP_Y[code];
        const nx = localX + stepX;
        const ny = localY + stepY;
        if (nx < 0 || nx >= FLOW_BLOCK_COLS || ny < 0 || ny >= FLOW_BLOCK_ROWS) continue;
        const nextIndex = ny * FLOW_BLOCK_COLS + nx;
        const nextDistance = distances[nextIndex];
        if (nextDistance === UNVISITED || nextDistance >= bestDistance) continue;
        // A diagonal is only legal when both of its orthogonal components are open, or the
        // step clips the corner of a wall and the circle resolver shears it into a stall.
        if (stepX !== 0 && stepY !== 0) {
          if (walkable[localY * FLOW_BLOCK_COLS + nx] === 0) continue;
          if (walkable[ny * FLOW_BLOCK_COLS + localX] === 0) continue;
        }
        bestDistance = nextDistance;
        bestCode = code;
      }
      directions[index] = bestCode;
    }
  }
}

/**
 * True when the tile under a world point holds a route to the field's target. The target
 * tile itself reads false (distance 0 never gets a direction code), which is fine for the
 * two callers: spawn candidates sit on the off-camera ring and aperture mouths, never on
 * the player.
 */
export function flowReachable(field: FlowField, x: number, y: number): boolean {
  const localX = globalTileOf(x) - field.originTileX;
  const localY = globalTileOf(y) - field.originTileY;
  if (localX < 0 || localX >= FLOW_BLOCK_COLS) return false;
  if (localY < 0 || localY >= FLOW_BLOCK_ROWS) return false;
  return field.directions[localY * FLOW_BLOCK_COLS + localX] !== FLOW_UNREACHABLE;
}

/**
 * The centre of the next tile along the route, or false when the point is outside the block
 * or its tile cannot reach the target. `out` is left untouched on false so a caller can
 * pre-load it with its own fallback.
 */
export function flowStepPoint(
  field: FlowField, x: number, y: number, out: { x: number; y: number },
): boolean {
  const localX = globalTileOf(x) - field.originTileX;
  const localY = globalTileOf(y) - field.originTileY;
  if (localX < 0 || localX >= FLOW_BLOCK_COLS) return false;
  if (localY < 0 || localY >= FLOW_BLOCK_ROWS) return false;
  const code = field.directions[localY * FLOW_BLOCK_COLS + localX];
  if (code === FLOW_UNREACHABLE) return false;
  const nextTileX = field.originTileX + localX + FLOW_STEP_X[code];
  const nextTileY = field.originTileY + localY + FLOW_STEP_Y[code];
  out.x = nextTileX * TILE_SIZE + TILE_SIZE / 2;
  out.y = nextTileY * TILE_SIZE + TILE_SIZE / 2;
  return true;
}
