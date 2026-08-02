/**
 * phaseBleed: which wall tiles a phased mover is standing inside.
 *
 * Doc 02 section 5.3's ghost rule made a phased Wraith able to stand in rock; this answers
 * the question that leaves for the renderer, "which rock". Pure and Phaser-free: it returns
 * world-pixel tile corners and never a colour, a sprite or a scene.
 */

import { TILE_SIZE, TileKind } from './worldTypes';
import type { WorldMap } from './worldTypes';
import { tileKindAt } from './staticCollision';

/** World-pixel top-left corner of one wall tile a phased mover overlaps. */
export interface PhaseBleedTile {
  x: number;
  y: number;
}

/**
 * How far past the body the bleed reaches, so the tile a wraith is about to step out of
 * lights before its centre has cleared the rock.
 */
export const PHASE_BLEED_MARGIN = 10;

/**
 * Wall, not floor: deliberately narrower than isSolidAtWorld, which also calls a void gap and
 * a security-grid fence solid for an enemy. Those are floor washes the player can already see
 * through, and bleeding them would claim cover where there is none. This is the same set
 * WorldGeometryRenderer.styleOf draws as wall.
 */
function isWallKind(kind: number): boolean {
  return kind === TileKind.Solid || kind === TileKind.Breakable || kind === TileKind.GateClosed;
}

/** Packs a signed global tile coordinate pair into one number for the dedupe set. The
 *  offset keeps a negative-sector tile positive; 32768 tiles is 1.3 million world pixels
 *  in each direction, far past any generated world. */
function tileDedupeKey(globalTileX: number, globalTileY: number): number {
  return (globalTileY + 32768) * 65536 + (globalTileX + 32768);
}

/**
 * Appends every wall tile the mover's circle (expanded by PHASE_BLEED_MARGIN) overlaps to
 * `out`, starting at `outCount`, and returns the new count. `out` is a pooled array owned by
 * the caller: entries past the returned count are stale and must not be read.
 *
 * `seenTileKeys` is cleared by the caller once per frame, not here: two wraiths inside one
 * wall must light that wall once, not twice as deep.
 */
export function collectPhaseBleedTiles(
  world: WorldMap,
  moverX: number,
  moverY: number,
  moverRadius: number,
  seenTileKeys: Set<number>,
  out: PhaseBleedTile[],
  outCount: number,
): number {
  const reach = moverRadius + PHASE_BLEED_MARGIN;
  const reachSquared = reach * reach;
  const minTileX = Math.floor((moverX - reach) / TILE_SIZE);
  const maxTileX = Math.floor((moverX + reach) / TILE_SIZE);
  const minTileY = Math.floor((moverY - reach) / TILE_SIZE);
  const maxTileY = Math.floor((moverY + reach) / TILE_SIZE);
  let count = outCount;

  for (let globalTileY = minTileY; globalTileY <= maxTileY; globalTileY++) {
    for (let globalTileX = minTileX; globalTileX <= maxTileX; globalTileX++) {
      const key = tileDedupeKey(globalTileX, globalTileY);
      if (seenTileKeys.has(key)) continue;
      if (!isWallKind(tileKindAt(world, globalTileX, globalTileY))) continue;

      const left = globalTileX * TILE_SIZE;
      const top = globalTileY * TILE_SIZE;
      const nearestX = Math.min(Math.max(moverX, left), left + TILE_SIZE);
      const nearestY = Math.min(Math.max(moverY, top), top + TILE_SIZE);
      const offsetX = moverX - nearestX;
      const offsetY = moverY - nearestY;
      if (offsetX * offsetX + offsetY * offsetY > reachSquared) continue;

      seenTileKeys.add(key);
      const slot = out[count];
      if (slot) {
        slot.x = left;
        slot.y = top;
      } else {
        out[count] = { x: left, y: top };
      }
      count++;
    }
  }
  return count;
}
