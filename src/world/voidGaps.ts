/**
 * voidGaps: where the Magno-Tether can reel the ship across a chasm.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS.
 */

import { TILE_SIZE, TileKind } from './worldTypes';
import type { WorldMap } from './worldTypes';
import { tileKindAt } from './staticCollision';

/** How far ahead of the ship the probe looks for the near rim. Collision stops the hull one
 *  radius short of a gap, so the rim is never further than the next tile but one. */
export const TETHER_PROBE_TILES = 2;
/** The widest run of gap tiles one reel spans. A cache ring is one tile thick on an axis
 *  and two through a corner, so three covers every generated gap with a tile to spare. */
export const TETHER_MAX_SPAN_TILES = 3;
/** How far a gap announces itself to a ship that cannot cross it, in tiles. */
export const VOID_GAP_NOTICE_TILES = 2;

export interface TetherCrossing {
  /** Centre of the tile the ship lands on. */
  x: number;
  y: number;
  /** Centre of the first gap tile: where the tether bites. */
  anchorX: number;
  anchorY: number;
  spanTiles: number;
}

function isFloor(kind: number): boolean {
  return kind === TileKind.Open || kind === TileKind.HazardFloor;
}

function tileCentre(globalTile: number): number {
  return globalTile * TILE_SIZE + TILE_SIZE / 2;
}

/**
 * The landing point for a reel starting at (x, y) heading (dirX, dirY), or null when there
 * is nothing crossable there. The direction is snapped to its dominant axis: a generated
 * gap ring is axis-aligned, so a diagonal probe would have to pick a corner arbitrarily.
 *
 * A landing tile centre is 20 px from every edge and the hull radius is 16, so a landing
 * can never be embedded in the rock next door.
 */
export function findTetherCrossing(
  world: WorldMap, x: number, y: number, dirX: number, dirY: number,
): TetherCrossing | null {
  const stepX = Math.abs(dirX) >= Math.abs(dirY) ? Math.sign(dirX) : 0;
  const stepY = stepX === 0 ? Math.sign(dirY) : 0;
  if (stepX === 0 && stepY === 0) return null;

  const startTileX = Math.floor(x / TILE_SIZE);
  const startTileY = Math.floor(y / TILE_SIZE);

  let offset = 1;
  for (; offset <= TETHER_PROBE_TILES; offset++) {
    const kind = tileKindAt(world, startTileX + stepX * offset, startTileY + stepY * offset);
    if (kind === TileKind.VoidGap) break;
    // Rock before the rim: the tether has nothing to bite that this heading reaches.
    if (!isFloor(kind)) return null;
  }
  if (offset > TETHER_PROBE_TILES) return null;

  const anchorTileX = startTileX + stepX * offset;
  const anchorTileY = startTileY + stepY * offset;

  let spanTiles = 0;
  while (spanTiles < TETHER_MAX_SPAN_TILES
    && tileKindAt(world, anchorTileX + stepX * spanTiles, anchorTileY + stepY * spanTiles)
      === TileKind.VoidGap) {
    spanTiles++;
  }

  const landingTileX = anchorTileX + stepX * spanTiles;
  const landingTileY = anchorTileY + stepY * spanTiles;
  if (!isFloor(tileKindAt(world, landingTileX, landingTileY))) return null;

  return {
    x: tileCentre(landingTileX),
    y: tileCentre(landingTileY),
    anchorX: tileCentre(anchorTileX),
    anchorY: tileCentre(anchorTileY),
    spanTiles,
  };
}

/** Whether any gap tile sits within VOID_GAP_NOTICE_TILES of a point. */
export function voidGapNearWorld(world: WorldMap, x: number, y: number): boolean {
  const centreTileX = Math.floor(x / TILE_SIZE);
  const centreTileY = Math.floor(y / TILE_SIZE);
  for (let offsetY = -VOID_GAP_NOTICE_TILES; offsetY <= VOID_GAP_NOTICE_TILES; offsetY++) {
    for (let offsetX = -VOID_GAP_NOTICE_TILES; offsetX <= VOID_GAP_NOTICE_TILES; offsetX++) {
      if (tileKindAt(world, centreTileX + offsetX, centreTileY + offsetY)
        === TileKind.VoidGap) {
        return true;
      }
    }
  }
  return false;
}
